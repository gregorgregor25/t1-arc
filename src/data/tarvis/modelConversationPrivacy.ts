import type { TarvisConversationTurn } from "./types";

const LOCAL_ONLY_USER_PLACEHOLDER =
  "A previous user question belonged to a local private-data review and is not shared with the hosted model.";
const LOCAL_ONLY_ASSISTANT_PLACEHOLDER =
  "A previous answer was calculated locally from private health records and is not shared with the hosted model.";

export function tarvisConversationTurnsForExchange({
  answer,
  answerSource,
  headline,
  modelSharing,
  question,
}: {
  answer: string;
  answerSource: "hosted" | "local";
  headline: string;
  modelSharing?: "local-only";
  question: string;
}): TarvisConversationTurn[] {
  // Request accounting does not establish that the displayed prose came from
  // the model. A rejected hosted answer may have metrics while the verified
  // local fallback must remain on this phone.
  const localOnly = modelSharing === "local-only" || answerSource !== "hosted";
  const sharing = localOnly ? { modelSharing: "local-only" as const } : {};
  return [
    { role: "user", text: question, ...sharing },
    { role: "assistant", text: `${headline}\n${answer}`, ...sharing },
  ];
}

export function modelSafeTarvisHistory(
  history: readonly TarvisConversationTurn[],
): TarvisConversationTurn[] {
  return history.map((turn) => {
    if (turn.modelSharing !== "local-only") {
      return { role: turn.role, text: turn.text };
    }
    return {
      role: turn.role,
      text:
        turn.role === "user"
          ? LOCAL_ONLY_USER_PLACEHOLDER
          : LOCAL_ONLY_ASSISTANT_PLACEHOLDER,
    };
  });
}
