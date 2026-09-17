export const TARVIS_INPUT_USD_PER_MILLION_TOKENS = 0.2;
export const TARVIS_OUTPUT_USD_PER_MILLION_TOKENS = 1.2;

/** Display-only estimate using the configured model's current public rates. */
export function estimateTarvisCostUsd(
  inputTokens: number,
  outputTokens: number,
) {
  return (
    (Math.max(0, inputTokens) * TARVIS_INPUT_USD_PER_MILLION_TOKENS +
      Math.max(0, outputTokens) * TARVIS_OUTPUT_USD_PER_MILLION_TOKENS) /
    1_000_000
  );
}
