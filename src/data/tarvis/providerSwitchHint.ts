import type { TarvisProvider } from "./providers";

export const CHATGPT_SWITCH_HINT =
  "You are also signed in with ChatGPT. You can switch to it in Tarv1s settings.";

/**
 * One extra line for a provider error that needs settings: when the failing
 * provider uses an API key and a ChatGPT sign-in is already connected, say
 * that ChatGPT is there. Tarv1s never switches provider or model by itself.
 */
export function providerSwitchHint(
  provider: TarvisProvider,
  errorNeedsSettings: boolean,
  chatGptConnected: boolean,
): string | undefined {
  if (!errorNeedsSettings || !chatGptConnected || provider === "chatgpt") {
    return undefined;
  }
  return CHATGPT_SWITCH_HINT;
}
