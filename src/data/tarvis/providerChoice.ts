import type { ChatGptConnectionState } from "./chatGptConnection";
import { TARVIS_PROVIDERS, type TarvisProvider } from "./providers";

/**
 * Which AI connection the Tarv1s settings screen shows, and when to offer a
 * one-tap switch. Pure, so the rules can be tested without the screen.
 */
export interface TarvisProviderChoiceInput {
  /** The provider saved for AI answers. */
  provider: TarvisProvider;
  /** True when the saved provider can be used now. */
  hasApiKey: boolean;
  configuredProviders: Record<TarvisProvider, boolean>;
  chatGpt?: Pick<ChatGptConnectionState, "available" | "connected" | "models" | "selectedModel">;
}

/** ChatGPT first, because it needs no API key; then the key providers in list order. */
const PREFERENCE: readonly TarvisProvider[] = ["chatgpt", "openai", "claude", "gemini"];

/** True when this provider could answer now: a key is saved, or ChatGPT is signed in with an available model. */
export function isTarvisProviderReady(id: TarvisProvider, input: TarvisProviderChoiceInput) {
  if (!input.configuredProviders[id]) return false;
  if (id !== "chatgpt") return true;
  const chatGpt = input.chatGpt;
  return Boolean(
    chatGpt?.available &&
      chatGpt.connected &&
      chatGpt.selectedModel &&
      chatGpt.models.some((model) => model.slug === chatGpt.selectedModel),
  );
}

/**
 * Another connection that is ready while the saved one is not, for example
 * after its key was removed. Undefined when the saved connection works or
 * nothing else is ready.
 */
export function tarvisProviderSwitchOffer(input: TarvisProviderChoiceInput): TarvisProvider | undefined {
  if (input.hasApiKey) return undefined;
  return PREFERENCE.find((id) => id !== input.provider && isTarvisProviderReady(id, input));
}

/**
 * The connection shown as selected when settings open. A saved provider with
 * no key is never shown as the choice while another connection is set up.
 */
export function tarvisSettingsViewProvider(input: TarvisProviderChoiceInput): TarvisProvider {
  if (input.hasApiKey) return input.provider;
  const offer = tarvisProviderSwitchOffer(input);
  if (offer) return offer;
  if (input.chatGpt?.available && input.chatGpt.connected) return "chatgpt";
  const configured = PREFERENCE.find((id) => input.configuredProviders[id]);
  return configured ?? input.provider;
}

/** Plain wording for the switch offer. */
export function tarvisProviderSwitchCopy(input: TarvisProviderChoiceInput, offer: TarvisProvider) {
  const current = TARVIS_PROVIDERS[input.provider].label;
  const next = TARVIS_PROVIDERS[offer].label;
  return {
    title: `${current} is not set up`,
    detail: `${next} is ready on this phone. Use it for AI answers? Local answers keep working either way.`,
    action: `Use ${next}`,
  };
}
