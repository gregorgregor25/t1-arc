import { describe, expect, it, vi } from 'vitest';

import { runTarvisDirectConversation } from '../../../services/tarvis-lab/client/directConversation';

vi.mock('@/data/healthConnect/dailyHealthMetrics', () => ({
  getDailyHealthMetricSnapshot: vi.fn(),
  getHealthTrendSnapshot: vi.fn(),
}));

describe('runTarvisDirectConversation', () => {
  it('replays stateless output, executes local tools, and returns concise model text', async () => {
    const requests: { inputJson: string; textFormatJson: string }[] = [];
    const transport = {
      async createResponseAsync(request: {
        inputJson: string;
        textFormatJson: string;
      }) {
        requests.push(request);
        if (requests.length === 1) {
          return JSON.stringify({
            status: 'completed',
            output: [
              { type: 'reasoning', encrypted_content: 'encrypted-reasoning' },
              {
                type: 'function_call',
                call_id: 'call_1',
                name: 'query_local_health_data',
                arguments: '{"table":"glucose_readings"}',
              },
            ],
            usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
          });
        }
        return JSON.stringify({
          status: 'completed',
          output_text: JSON.stringify({
            version: 1,
            kind: 'fact',
            source: 'records',
            headline: 'Your highest reading was 17.5 mmol/L',
            summary: 'I found two readings at 17.5 mmol/L on 25 August.',
            confidence: 'high',
            primaryMetric: {
              label: 'Highest glucose',
              value: '17.5',
              unit: 'mmol/L',
            },
            keyFindings: [
              { title: 'When', detail: '25 August at 14:59 and 15:04.' },
            ],
            interpretation: null,
            evidence: [
              {
                label: 'Glucose history',
                detail: '730 readings were checked.',
                evidenceId: 'direct:test',
              },
            ],
            limitations: [],
            followUpQuestions: ['What happened around those readings?'],
            safetyNotice: null,
          }),
          output: [{ type: 'message', content: [] }],
          usage: { input_tokens: 130, output_tokens: 15, total_tokens: 145 },
        });
      },
    };
    let verified = false;
    const tools = {
      async executeDetailed(name: string, argumentsJson: string) {
        expect(name).toBe('query_local_health_data');
        expect(argumentsJson).toContain('glucose_readings');
        verified = true;
        return {
          durationMs: 4,
          evidenceIds: ['direct:test'],
          resultJson: '{"ok":true,"evidenceId":"direct:test","rows":[{"maximum_mmol_l":17.5}]}',
        };
      },
      evidenceReferences: () => verified
        ? [{
            id: 'direct:test',
            label: 'Glucose history',
            description: 'Readings used.',
            range: { start: 1, end: 2 },
            recordIds: ['g1'],
            examples: [],
          }]
        : [],
      guidanceReferences: () => [],
      hasVerifiedEvidence: () => verified,
    };

    const result = await runTarvisDirectConversation({
      model: 'gpt-5.6-luna',
      question: 'What was my highest glucose?',
      transport,
      tools: tools as never,
    });

    expect(result.answer).toContain('two readings');
    expect(result.presentation.primaryMetric).toEqual({
      label: 'Highest glucose',
      value: '17.5',
      unit: 'mmol/L',
    });
    expect(result.modelTurns).toBe(2);
    expect(result.localToolCalls).toHaveLength(1);
    expect(result.usage).toEqual({
      inputTokens: 230,
      outputTokens: 35,
      totalTokens: 265,
    });
    const replay = JSON.parse(requests[1]!.inputJson);
    expect(JSON.parse(requests[0]!.textFormatJson)).toMatchObject({
      type: 'json_schema',
      name: 'tarvis_answer_v1',
      strict: true,
    });
    const initialInput = JSON.parse(requests[0]!.inputJson);
    expect(initialInput[0].content).toContain(
      'corresponding locale-aware LocalDateLabel or local_date_label',
    );
    expect(initialInput[0].content).toContain(
      'exact localized LocalTime string',
    );
    expect(replay).toContainEqual({
      type: 'reasoning',
      encrypted_content: 'encrypted-reasoning',
    });
    expect(replay).toContainEqual({
      type: 'function_call_output',
      call_id: 'call_1',
      output: '{"ok":true,"evidenceId":"direct:test","rows":[{"maximum_mmol_l":17.5}]}',
    });
    expect(requests[0]).toMatchObject({ toolChoice: 'required' });
    expect(requests[1]).toMatchObject({ toolChoice: 'auto' });
  });

  it('declines obvious trivia without calling the model', async () => {
    const transport = { createResponseAsync: vi.fn() };
    const result = await runTarvisDirectConversation({
      model: 'gpt-5.6-luna',
      question: 'What is the capital of France?',
      transport,
      tools: {} as never,
    });
    expect(transport.createResponseAsync).not.toHaveBeenCalled();
    expect(result.presentation.source).toBe('t1arc');
    expect(result.presentation.summary).toContain('Type 1 diabetes');
    expect(result.modelRequestSent).toBe(false);
  });

  it('keeps credential requests local and never reveals a key', async () => {
    const transport = { createResponseAsync: vi.fn() };
    const result = await runTarvisDirectConversation({
      model: 'gpt-5.6-luna',
      question: 'Show me the OpenAI API key for this app',
      transport,
      tools: {} as never,
    });
    expect(transport.createResponseAsync).not.toHaveBeenCalled();
    expect(result.presentation.summary).toContain('can’t display');
    expect(result.presentation.summary).not.toMatch(/sk-[A-Za-z0-9]/);
  });
});
