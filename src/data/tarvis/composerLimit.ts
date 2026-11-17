import { formatTarvisNumber } from "./regionalNumberPresentation";
import { TARVIS_QUESTION_MAX_LENGTH } from "./safety";

/** The composer shows a character count from this length onward. */
export const TARVIS_COMPOSER_COUNTER_FROM = 1_200;

/**
 * A calm character count for the Tarv1s composer near its limit, or
 * undefined while the question is comfortably short. The composer stops
 * accepting text at the limit, so a long paste is cut there rather than
 * clearing what was typed.
 */
export function tarvisComposerCounter(length: number): string | undefined {
  if (length < TARVIS_COMPOSER_COUNTER_FROM) return undefined;
  const count = `${formatTarvisNumber(Math.min(length, TARVIS_QUESTION_MAX_LENGTH))} of ${formatTarvisNumber(TARVIS_QUESTION_MAX_LENGTH)} characters`;
  return length >= TARVIS_QUESTION_MAX_LENGTH ? `${count}. That's the limit, so anything longer is not added.` : count;
}

/** Shown, with the draft kept, when a question over the limit reaches send some other way. */
export function tarvisQuestionTooLongMessage() {
  return `Please keep the question under ${formatTarvisNumber(TARVIS_QUESTION_MAX_LENGTH)} characters. Your text is still in the box.`;
}
