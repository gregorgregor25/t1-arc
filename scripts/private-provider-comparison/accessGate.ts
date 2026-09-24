const GEMINI_MODEL = "gemini-3.8-flash";

interface GeminiApprovalEnvironment {
  T1ARC_PRIVATE_GEMINI_FREE_QUOTA_VERIFIED?: string;
  T1ARC_PRIVATE_GEMINI_PAID_QUOTA_VERIFIED?: string;
  T1ARC_PRIVATE_GEMINI_PAID_USER_AUTHORIZED?: string;
}

/** Fail closed unless the selected Gemini billing mode has explicit approval. */
export function assertGeminiDispatchApproval(
  models: ReadonlySet<string>,
  environment: GeminiApprovalEnvironment,
) {
  if (!models.has(GEMINI_MODEL)) return;

  const free = environment.T1ARC_PRIVATE_GEMINI_FREE_QUOTA_VERIFIED === "YES";
  const paidQuota = environment.T1ARC_PRIVATE_GEMINI_PAID_QUOTA_VERIFIED === "YES";
  const paidAuthorization = environment.T1ARC_PRIVATE_GEMINI_PAID_USER_AUTHORIZED === "YES";
  const anyPaidFlag = environment.T1ARC_PRIVATE_GEMINI_PAID_QUOTA_VERIFIED !== undefined ||
    environment.T1ARC_PRIVATE_GEMINI_PAID_USER_AUTHORIZED !== undefined;

  if (free && !anyPaidFlag) return;
  if (environment.T1ARC_PRIVATE_GEMINI_FREE_QUOTA_VERIFIED === undefined &&
      paidQuota && paidAuthorization) return;

  throw new Error("Gemini comparison requires verified free quota, or verified paid quota and explicit user authorization, with exactly one mode selected.");
}
