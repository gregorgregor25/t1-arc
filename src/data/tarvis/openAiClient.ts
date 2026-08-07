import {
  checkTarvisRateLimit,
  parseTarvisAnswer,
} from './guardrails';
import { selectTarvisEvidencePacket } from './evidencePacket';
import {
  getTarvisSafetyIdentifier,
  loadTarvisApiKey,
  loadTarvisUsage,
  saveTarvisUsage,
} from './secureStore';
import { classifyTarvisQuestion } from './scope';
import {
  TarvisConversationTurn,
  TarvisEvidencePacket,
  TarvisResponse,
  TarvisUsage,
} from './types';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const MODEL = 'gpt-5.6-luna';
const INPUT_USD_PER_MILLION_TOKENS = 1;
const OUTPUT_USD_PER_MILLION_TOKENS = 6;
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_QUESTION_LENGTH = 1_500;
const MAX_CONTEXT_CHARACTERS = 70_000;
const MAX_OUTPUT_TOKENS = 800;

let requestInFlight = false;

export const TARVIS_SYSTEM_PROMPT = `You are TARV1S, the evidence-first personal diabetes data analyst inside T1 Arc.

OUTCOME
Answer the user's question clearly from the supplied T1 Arc evidence packet. Reduce cognitive load: lead with the useful answer, then the evidence and limitations.

SCOPE
- Only answer questions about Type 1 diabetes, the user's supplied health data, or health concepts needed to interpret that data.
- Refuse unrelated general-knowledge requests briefly. Do not answer them even when you know the answer.
- Never act as a general-purpose chatbot.

EVIDENCE RULES
- Use only the supplied evidence packet and explicit statements in the conversation.
- Never invent readings, events, causes, source details, or evidence IDs.
- Distinguish direct observation from correlation and inference.
- Every substantive claim about the user's data must be supported by one or more evidence_ids from the packet.
- If the packet cannot support an answer, say so plainly. Do not fill gaps with general assumptions.
- Treat missing, stale, sparse, or delayed source data as a limitation.

SAFETY BOUNDARY
- You may identify patterns worth reviewing and explain which records support that review.
- You may point out that a logged meal or snack overlaps a later rise and invite the user to review whether their carbohydrate or insulin record is complete.
- Do not prescribe an exact insulin dose, correction bolus, carb ratio, basal rate, glucose target, or pump-setting change.
- Do not imply that an association proves causation.
- This is not an emergency service. If the user describes severe symptoms or immediate danger, tell them to follow their trusted diabetes emergency plan and seek urgent medical help.

PRIVACY AND ACTIONS
- You cannot control devices, contact people, change settings, or run tools.
- Produce exactly one answer and stop. Do not initiate follow-up work.

OUTPUT
Return only the requested JSON object.
- Use plain text without Markdown markers.
- Give the conclusion first, then at most three short supporting points.
- Prefer 120 to 250 words for a normal question.
- Use additional detail when it materially changes the conclusion, the question covers several interacting patterns, or the user explicitly asks for a deeper explanation.
- Use no more than five evidence IDs: choose the smallest sufficient set.
- Put evidence IDs only in evidenceIds. Never print raw IDs in the headline, answer or limitations.
- Keep limitations brief and include only limitations that materially affect the answer.`;

interface OpenAiResponseBody {
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; code?: string };
}

function trimHistory(history: TarvisConversationTurn[]) {
  return history.slice(-4).map((turn) => ({
    role: turn.role,
    text: turn.text.slice(0, 1_200),
  }));
}

function extractOutputText(body: OpenAiResponseBody) {
  for (const item of body.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'refusal' && content.refusal) {
        throw new Error(content.refusal);
      }
      if (content.type === 'output_text' && content.text) {
        return content.text;
      }
    }
  }
  throw new Error('OpenAI returned no answer.');
}

function openAiError(status: number, body: OpenAiResponseBody) {
  if (status === 401) {
    return 'OpenAI rejected this key. Open TARV1S settings and replace it.';
  }
  if (status === 403) {
    return 'This key cannot use the Responses API. Allow model responses in the OpenAI project key permissions.';
  }
  if (status === 429) {
    return 'OpenAI is rate-limiting this project or its budget has been reached. No automatic retry was made.';
  }
  return (
    body.error?.message ||
    `OpenAI could not complete the request (HTTP ${status}).`
  );
}

export async function askTarvis(
  question: string,
  packet: TarvisEvidencePacket,
  history: TarvisConversationTurn[] = [],
): Promise<TarvisResponse> {
  const prompt = question.trim();
  if (!prompt) throw new Error('Ask TARV1S a question first.');
  if (prompt.length > MAX_QUESTION_LENGTH) {
    throw new Error(
      `Keep the question under ${MAX_QUESTION_LENGTH.toLocaleString()} characters.`,
    );
  }
  const scope = classifyTarvisQuestion(prompt, history);
  if (scope !== 'in_scope') {
    const usage = await loadTarvisUsage();
    return {
      answer: {
        headline:
          scope === 'sensitive_credentials'
            ? 'I can’t reveal private credentials'
            : 'That is outside TARV1S’s scope',
        answer:
          scope === 'sensitive_credentials'
            ? 'TARV1S cannot retrieve or display passwords, API keys, tokens or other secrets. No OpenAI request was made.'
            : 'TARV1S only answers questions about Type 1 diabetes and the health evidence available in T1 Arc. No OpenAI request was made.',
        confidence: 'high',
        evidenceIds: [],
        limitations: [],
      },
      usage,
    };
  }
  if (requestInFlight) {
    throw new Error('TARV1S is already answering a question.');
  }

  const key = await loadTarvisApiKey();
  if (!key) throw new Error('Add your OpenAI API key first.');
  const selectedPacket = selectTarvisEvidencePacket(prompt, packet);
  const encodedPacket = JSON.stringify(selectedPacket);
  if (encodedPacket.length > MAX_CONTEXT_CHARACTERS) {
    throw new Error(
      'This evidence window is too large to send safely. Choose a shorter comparison period.',
    );
  }

  requestInFlight = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const now = Date.now();
    const existingUsage = await loadTarvisUsage();
    const recent = checkTarvisRateLimit(existingUsage, now);
    const reservedUsage: TarvisUsage = {
      ...existingUsage,
      requestTimestamps: [...recent, now],
      lastRequestAt: now,
    };
    await saveTarvisUsage(reservedUsage);
    const safetyIdentifier = await getTarvisSafetyIdentifier();
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        store: false,
        safety_identifier: safetyIdentifier,
        instructions: TARVIS_SYSTEM_PROMPT,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: JSON.stringify({
                  evidencePacket: selectedPacket,
                  recentConversation: trimHistory(history),
                  question: prompt,
                }),
              },
            ],
          },
        ],
        reasoning: { effort: 'low' },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        text: {
          verbosity: 'low',
          format: {
            type: 'json_schema',
            name: 'tarvis_evidence_answer',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                headline: { type: 'string' },
                answer: { type: 'string' },
                confidence: {
                  type: 'string',
                  enum: ['high', 'moderate', 'limited'],
                },
                evidenceIds: {
                  type: 'array',
                  items: { type: 'string' },
                },
                limitations: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
              required: [
                'headline',
                'answer',
                'confidence',
                'evidenceIds',
                'limitations',
              ],
            },
          },
        },
      }),
    });
    const body = (await response.json()) as OpenAiResponseBody;
    if (!response.ok) throw new Error(openAiError(response.status, body));

    const tokens = body.usage ?? {};
    const usage: TarvisUsage = {
      ...reservedUsage,
      inputTokens:
        reservedUsage.inputTokens + (tokens.input_tokens ?? 0),
      outputTokens:
        reservedUsage.outputTokens + (tokens.output_tokens ?? 0),
      totalTokens:
        reservedUsage.totalTokens + (tokens.total_tokens ?? 0),
    };
    await saveTarvisUsage(usage);
    return {
      answer: parseTarvisAnswer(
        extractOutputText(body),
        selectedPacket,
      ),
      usage,
      requestMetrics: {
        model: MODEL,
        inputTokens: tokens.input_tokens ?? 0,
        outputTokens: tokens.output_tokens ?? 0,
        totalTokens: tokens.total_tokens ?? 0,
        estimatedCostUsd:
          ((tokens.input_tokens ?? 0) *
            INPUT_USD_PER_MILLION_TOKENS +
            (tokens.output_tokens ?? 0) *
              OUTPUT_USD_PER_MILLION_TOKENS) /
          1_000_000,
        evidenceCharacters: encodedPacket.length,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        'TARV1S stopped after 45 seconds. No automatic retry was made.',
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    requestInFlight = false;
  }
}
