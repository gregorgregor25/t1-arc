const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash"] as const;

interface GeminiApprovalEnvironment {
  T1ARC_PRIVATE_GEMINI_FREE_QUOTA_VERIFIED?: string;
  T1ARC_PRIVATE_GEMINI_PAID_QUOTA_VERIFIED?: string;
  T1ARC_PRIVATE_GEMINI_PAID_USER_AUTHORIZED?: string;
  T1ARC_PRIVATE_GEMINI_37_ACCESS_VERIFIED?: string;
}

/** Fail closed unless the selected Gemini billing mode has explicit approval. */
export function assertGeminiDispatchApproval(
  models: ReadonlySet<string>,
  environment: GeminiApprovalEnvironment,
) {
  if (!GEMINI_MODELS.some(model => models.has(model))) return;
  if (models.has("gemini-3.7-flash") &&
      environment.T1ARC_PRIVATE_GEMINI_37_ACCESS_VERIFIED !== "YES") {
    throw new Error("Gemini 3.7 comparison requires verified model access for the selected account.");
  }

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
