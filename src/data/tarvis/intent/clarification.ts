import { resolveTarvisIntent } from "./resolve";
import type {
  ResolveTarvisIntentOptions,
  TarvisIntentResolution,
} from "./types";

export interface PendingTarvisClarification {
  question: string;
  resolution: TarvisIntentResolution;
}

function withoutAmbiguousClockWindow(pending: PendingTarvisClarification) {
  const spans = pending.resolution.literals.clockWindows
    .map(({ start, end }) => ({ start, end }))
    .sort((left, right) => right.start - left.start);
  return spans.reduce(
    (question, span) =>
      `${question.slice(0, span.start)} ${question.slice(span.end)}`,
    pending.question,
  );
}

/**
 * Resolves a short answer to Tarv1s's immediately preceding clarification.
 * The previous draft is a one-turn boundary; it is never searched past an
 * intervening safety, capability, or unrelated exchange.
 */
export function resolveTarvisClarificationReply(
  prompt: string,
  options: ResolveTarvisIntentOptions,
  pending?: PendingTarvisClarification,
) {
  const standalone = resolveTarvisIntent(prompt, options);
  if (
    !pending ||
    standalone.outcome.status !== "needs_clarification" ||
    pending.resolution.outcome.status !== "needs_clarification"
  ) {
    return standalone;
  }

  const pendingCode = pending.resolution.outcome.code;
  const priorQuestion =
    pendingCode === "ambiguous_clock_time" ||
    pendingCode === "invalid_clock_window"
      ? withoutAmbiguousClockWindow(pending)
      : pending.question;
  const combined =
    pendingCode === "ambiguous_clock_time" ||
    pendingCode === "invalid_clock_window"
      ? `${priorQuestion} between ${prompt}`
      : pendingCode === "missing_time_scope"
        ? `${priorQuestion} ${/^(?:over|during|in|for|on|from|between)\b/i.test(prompt) ? prompt : `over ${prompt}`}`
        : `${prompt}. For the earlier question: ${priorQuestion}`;
  const clarified = resolveTarvisIntent(combined, { ...options, history: [] });
  return clarified.outcome.status === "ready" ? clarified : standalone;
}
