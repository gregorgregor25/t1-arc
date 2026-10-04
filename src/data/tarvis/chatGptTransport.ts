export class ChatGptTransportError extends Error {
  constructor(message: string, readonly settingsRequired = false, readonly manageUsage = false, readonly cooldownMs = 0) {
    super(message);
    this.name = "ChatGptTransportError";
  }
}

/** Explicit allowlist: ChatGPT plan requests have a narrower contract than API requests. */
export function buildChatGptRequestBody(original: Record<string, unknown>) {
  if (typeof original.model !== "string" || !original.model || !Array.isArray(original.input)) {
    throw new ChatGptTransportError("Choose an available ChatGPT model in Tarv1s settings.", true);
  }
  return JSON.stringify({
    model: original.model,
    instructions: original.instructions,
    input: original.input,
    reasoning: original.reasoning,
    text: original.text,
    store: false,
    stream: true,
  });
}

function connectionError(error: unknown): ChatGptTransportError {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  // Never surface raw native/provider text: an error body could echo private inputs.
  switch (code) {
    case "ERR_CHATGPT_QUOTA":
      return new ChatGptTransportError("Your ChatGPT plan allowance has been reached. Manage usage in ChatGPT settings before trying again.", false, true, 30_000);
    case "ERR_CHATGPT_AUTH":
      return new ChatGptTransportError("Your ChatGPT connection needs attention. Continue with ChatGPT again in Tarv1s settings.", true);
    case "ERR_CHATGPT_RESTRICTED":
      return new ChatGptTransportError("This ChatGPT account or workspace does not allow plan access for T1 Arc. Check your plan and connected-app permissions in ChatGPT settings.", false, true);
    case "ERR_CHATGPT_RETRY":
      return new ChatGptTransportError("ChatGPT plan usage is temporarily unavailable. Please try again later.", false, false, 30_000);
    case "ERR_CHATGPT_UNSUPPORTED":
      return new ChatGptTransportError("This ChatGPT model does not support the answer format Tarv1s needs. Choose another model in Tarv1s settings.", true);
    case "ERR_CHATGPT_ROUTE":
      return new ChatGptTransportError("ChatGPT cannot handle this request in T1 Arc yet. Choose another connection in Tarv1s settings.", true);
    case "ERR_CHATGPT_INCOMPLETE":
      return new ChatGptTransportError("ChatGPT did not finish the answer. Your question is still here; try again when ready.");
    case "ERR_CHATGPT_REQUEST_FORMAT":
      return new ChatGptTransportError("ChatGPT rejected T1 Arc's answer format (HTTP 400). Please report this error.");
    case "ERR_CHATGPT_REQUEST_MODEL":
      return new ChatGptTransportError("ChatGPT rejected the selected model (HTTP 400). Refresh the model list in Tarv1s settings.", true);
    case "ERR_CHATGPT_REQUEST_INPUT":
      return new ChatGptTransportError("ChatGPT rejected T1 Arc's question format (HTTP 400). Please report this error.");
    case "ERR_CHATGPT_REQUEST_REASONING":
      return new ChatGptTransportError("ChatGPT rejected T1 Arc's model setting (HTTP 400). Please report this error.");
    case "ERR_CHATGPT_REQUEST_OTHER":
      return new ChatGptTransportError("ChatGPT rejected T1 Arc's request (HTTP 400). Please report this error.");
    case "ERR_CHATGPT_REQUEST_HTTP_OTHER":
      return new ChatGptTransportError("ChatGPT rejected T1 Arc's request before answering. Please report this error.");
    case "ERR_CHATGPT_STREAM_FORMAT":
      return new ChatGptTransportError("ChatGPT returned an unexpected response stream. Please report this error.");
    case "ERR_CHATGPT_STREAM_MIME":
      return new ChatGptTransportError("ChatGPT did not return an event stream. Please report this error.");
    case "ERR_CHATGPT_STREAM_EMPTY":
      return new ChatGptTransportError("ChatGPT returned an empty event stream. Please report this error.");
    case "ERR_CHATGPT_STREAM_EVENT_JSON":
      return new ChatGptTransportError("ChatGPT sent an unreadable stream event. Please report this error.");
    case "ERR_CHATGPT_STREAM_COMPLETION_SHAPE":
      return new ChatGptTransportError("ChatGPT sent an incomplete completion event. Please report this error.");
    case "ERR_CHATGPT_STREAM_REJECTED":
      return new ChatGptTransportError("ChatGPT stopped the answer before completing it. Please report this error.");
    case "ERR_CHATGPT_NATIVE_PROTOCOL":
      return new ChatGptTransportError("T1 Arc could not read ChatGPT's response. Please report this error.");
    case "ERR_CHATGPT_CANCELLED":
      return new ChatGptTransportError("The ChatGPT request was cancelled.");
    case "ERR_CHATGPT_RESPONSE":
      return new ChatGptTransportError("ChatGPT returned an unreadable response. Please try again.");
    default:
      return new ChatGptTransportError("ChatGPT could not be reached. Check your connection and try again.");
  }
}

export async function fetchChatGptResponse(accessToken: string, original: Record<string, unknown>, signal?: AbortSignal | null) {
  if (signal?.aborted) throw new ChatGptTransportError("The ChatGPT request was cancelled.");
  const body = buildChatGptRequestBody(original);
  const { default: native, isAvailable } = await import("../../../modules/t1arc-chatgpt");
  if (!native || !isAvailable()) throw new ChatGptTransportError("ChatGPT is unavailable on this device build. Choose a connection in Tarv1s settings.", true);
  if (signal?.aborted) throw new ChatGptTransportError("The ChatGPT request was cancelled.");
  const Crypto = await import("expo-crypto");
  if (signal?.aborted) throw new ChatGptTransportError("The ChatGPT request was cancelled.");
  const requestId = Crypto.randomUUID();
  const cancel = () => { void native.cancelRequest(requestId).catch(() => undefined); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const raw = await native.request({ requestId, accessToken, body });
    if (signal?.aborted) throw new ChatGptTransportError("The ChatGPT request was cancelled.");
    let response: Record<string, unknown>;
    try { response = JSON.parse(raw) as Record<string, unknown>; }
    catch { throw new ChatGptTransportError("ChatGPT returned an unreadable response. Please try again."); }
    // Partial output is never accepted as an answer, even if it parses as JSON.
    if (!response || response.status !== "completed" || !Array.isArray(response.output)) {
      throw new ChatGptTransportError("ChatGPT did not finish the answer. Please try again.");
    }
    return response;
  } catch (error) {
    if (error instanceof ChatGptTransportError) throw error;
    throw connectionError(error);
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}
