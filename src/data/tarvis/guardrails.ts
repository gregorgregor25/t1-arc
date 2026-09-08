import { evidenceIds } from "./evidencePacket";
import { TarvisAnswer, TarvisModelEvidencePacket, TarvisUsage } from "./types";

export const MAX_TARVIS_REQUESTS_PER_HOUR = 10;
export const MAX_TARVIS_REQUESTS_PER_DAY = 30;
const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const MAX_EVIDENCE_REFERENCES = 5;
const PROHIBITED_TREATMENT_OUTPUT =
  /\b(?:take|inject|use|administer|bolus|correct with|give yourself|reduce|lower|increase|decrease|adjust|change|double|halve|skip|stop|set|have|eat|drink|consume)\b[\s\S]{0,60}\b(?:insulin|units?|dose|bolus|basal|ratio|factor|target|carbs?|carbohydrates?|grams?|juice|glucose tablets?)\b|\bconsider\s+(?:taking|injecting|using|reducing|lowering|increasing|decreasing|adjusting|changing|skipping|stopping)\b[\s\S]{0,50}\b(?:insulin|dose|bolus|basal|ratio|factor|target|carbs?|carbohydrates?)\b|\b(?:you (?:should|must|need to)|i (?:recommend|suggest|advise))\b[\s\S]{0,80}\b(?:take|inject|bolus|correct|change|adjust|increase|decrease|raise|lower|double|halve|skip|stop|set)\b[\s\S]{0,50}\b(?:insulin|dose|bolus|basal|ratio|factor|target|carbs?|carbohydrates?|glucose tablets?)\b/i;
const PROHIBITED_CAUSAL_OUTPUT =
  /\b(?:definitely|certainly|clearly)\b[\s\S]{0,50}\b(?:caused|cause|because|due to)\b|\b(?:caused (?:your|the)|was caused by|was the cause of your|is the reason your|explains why your|led to (?:your|the)|triggered (?:your|the)|(?:your|the) (?:meal|walk|exercise|workout|insulin|bolus) explains? (?:your|the))\b/i;
const PROHIBITED_DIAGNOSIS_OUTPUT =
  /\byou (?:have|definitely have|are developing|are suffering from)\s+(?:dka|diabetic ketoacidosis|gastroparesis|neuropathy|retinopathy|hypoglyc(?:aemia|emia) unawareness)\b|\b(?:this|that|it)\s+(?:is|looks like|appears to be|could be|may be)\s+(?:dka|diabetic ketoacidosis|gastroparesis|neuropathy|retinopathy|hypoglyc(?:aemia|emia) unawareness)\b/i;

// General physiology uses verbs such as "reduce insulin sensitivity" and
// "increase glucose absorption" descriptively. In no-record education, detect
// directives rather than treating every occurrence of those verbs as advice.
// Personal-evidence parsing retains its stricter, existing output filter.
const PROHIBITED_EDUCATION_TREATMENT_OUTPUT =
  /(?:^|[.!?;:\n,]\s*)(?:(?:please|then|for example)\s+)?(?:take|inject|use|administer|bolus|correct with|give yourself|reduce|lower|increase|decrease|adjust|change|double|halve|skip|stop|set|have|eat|drink|consume)\b[\s\S]{0,80}\b(?:insulin|units?|dose|bolus|basal|ratio|factor|target|carbs?|carbohydrates?|grams?|juice|glucose tablets?)\b|\b(?:you (?:should|must|need to|can)|(?:i |we )?(?:recommend|suggest|advise)|consider|try|best to|to treat|to correct)\b[\s\S]{0,100}\b(?:tak(?:e|ing)|inject(?:ing)?|us(?:e|ing)|administer(?:ing)?|bolus|giv(?:e|ing)|reduc(?:e|ing)|lower(?:ing)?|increas(?:e|ing)|decreas(?:e|ing)|adjust(?:ing)?|chang(?:e|ing)|doubl(?:e|ing)|halv(?:e|ing)|skip(?:ping)?|stop(?:ping)?|set(?:ting)?|hav(?:e|ing)|eat(?:ing)?|drink(?:ing)?|consum(?:e|ing))\b[\s\S]{0,60}\b(?:insulin|units?|dose|bolus|basal|ratio|factor|target|carbs?|carbohydrates?|grams?|juice|glucose tablets?)\b/i;

function cleanModelText(value: unknown, validEvidenceIds: Set<string>) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\[([^\]]+)\]/g, (match, contents: string) => {
      const referencesKnownEvidence = [...validEvidenceIds].some((id) =>
        contents.includes(id),
      );
      return referencesKnownEvidence ? "" : match;
    })
    .replace(/\*\*|__|`/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function checkTarvisRateLimit(
  usage: TarvisUsage,
  now = Date.now(),
  requiredRequests = 1,
) {
  if (!Number.isSafeInteger(requiredRequests) || requiredRequests < 1) {
    throw new RangeError("A positive local model-request reservation is required.");
  }
  const recent = usage.requestTimestamps.filter(
    (timestamp) => now - timestamp < DAY_MS,
  );
  const hourly = recent.filter((timestamp) => now - timestamp < HOUR_MS);
  if (hourly.length + requiredRequests > MAX_TARVIS_REQUESTS_PER_HOUR) {
    throw new Error(
      "Tarv1s has reached its hourly safety limit of 10 model requests on this device. Try again later.",
    );
  }
  if (recent.length + requiredRequests > MAX_TARVIS_REQUESTS_PER_DAY) {
    throw new Error(
      "Tarv1s has reached its daily safety limit of 30 model requests on this device. Try again tomorrow.",
    );
  }
  return recent;
}

export function parseTarvisAnswer(
  value: string,
  packet?: TarvisModelEvidencePacket,
  options: { generalEducation?: boolean } = {},
): TarvisAnswer {
  let parsed: Partial<TarvisAnswer>;
  try {
    parsed = JSON.parse(value) as Partial<TarvisAnswer>;
  } catch {
    throw new Error("TARV1S returned an unreadable answer. Please try again.");
  }
  const validEvidenceIds = packet ? evidenceIds(packet) : new Set<string>();
  const confidence =
    parsed.confidence === "high" ||
    parsed.confidence === "moderate" ||
    parsed.confidence === "limited"
      ? parsed.confidence
      : "limited";
  const answer = cleanModelText(parsed.answer, validEvidenceIds);
  if (!answer) {
    throw new Error("TARV1S returned an empty answer. Please try again.");
  }
  const headline = cleanModelText(parsed.headline, validEvidenceIds)
    ? cleanModelText(parsed.headline, validEvidenceIds)
    : "Evidence review";
  const limitations = Array.isArray(parsed.limitations)
    ? parsed.limitations
        .filter((item): item is string => typeof item === "string")
        .map((item) => cleanModelText(item, validEvidenceIds))
        .filter(Boolean)
        .slice(0, 5)
    : [];
  let selectedEvidenceIds: string[] = [];
  const visibleCopy = [headline, answer, ...limitations].join("\n");
  if (
    (options.generalEducation && !packet
      ? PROHIBITED_EDUCATION_TREATMENT_OUTPUT
      : PROHIBITED_TREATMENT_OUTPUT).test(visibleCopy) ||
    PROHIBITED_CAUSAL_OUTPUT.test(visibleCopy) ||
    PROHIBITED_DIAGNOSIS_OUTPUT.test(visibleCopy)
  ) {
    throw new Error(
      "TARV1S returned an answer outside its safe evidence boundary. Please try again.",
    );
  }
  if (packet) {
    if (
      !Array.isArray(parsed.evidenceIds) ||
      parsed.evidenceIds.length === 0 ||
      parsed.evidenceIds.length > MAX_EVIDENCE_REFERENCES ||
      !parsed.evidenceIds.every(
        (id): id is string =>
          typeof id === "string" && validEvidenceIds.has(id),
      ) ||
      new Set(parsed.evidenceIds).size !== parsed.evidenceIds.length
    ) {
      throw new Error(
        "TARV1S returned an answer without exact supporting evidence. Please try again.",
      );
    }
    selectedEvidenceIds = [...parsed.evidenceIds];
  }
  return {
    headline,
    answer,
    confidence,
    evidenceIds: selectedEvidenceIds,
    limitations,
  };
}
