import { getCachedDateTimeFormat } from "@/domain/intlFormatterCache";
import { getRuntimeRegionalDefaults } from "@/domain/regionalProfileRuntime";
import { formatTarvisNumber } from "./regionalNumberPresentation";
import type { TarvisEvidencePacket } from "./types";

const CONTEXT_AREAS = [
  { label: "food", terms: /\b(?:food|meals?|carbs?|carbohydrates?|nutrition)\b/i, ids: ["food-context", "post-meal-pattern"] },
  { label: "insulin", terms: /\b(?:insulin|bolus|basal)\b/i, ids: ["insulin-total-reconciliation", "insulin-change", "basal-data-completeness"] },
  { label: "activity", terms: /\b(?:activity|exercise|workouts?|steps?)\b/i, ids: ["activity-context", "health-connect-activity"] },
  { label: "sleep", terms: /\bsleep\b/i, ids: ["sleep-context"] },
] as const;

/** Keep the requested episode count and context ahead of generic glucose stats.
 * Inputs are locally computed report values, never model prose or previews.
 * This is period-level context, not an event-by-event causal analysis.
 */
export function focusTarvisEpisodeReviewPacket(
  question: string,
  packet: TarvisEvidencePacket,
  kind: "low" | "high",
): TarvisEvidencePacket {
  const { current, previous } = packet.comparison;
  // Retain the established missing/sparse-history path, including its evidence.
  if ([current, previous].some((summary) => summary.glucoseReadings < 100 || summary.coveragePercent < 70)) {
    return packet;
  }
  const glucoseIds = ["current-glucose", "previous-glucose"];
  if (!glucoseIds.every((id) => packet.evidence.some((item) => item.id === id))) return packet;
  const metric = kind === "low" ? "lowGlucoseRuns" : "highGlucoseRuns";
  if (current[metric] === null || previous[metric] === null) return packet;
  const count = (value: number) => formatTarvisNumber(value, { maximumFractionDigits: 0 });
  const format = getCachedDateTimeFormat(getRuntimeRegionalDefaults().locale, {
    timeZone: packet.timezone, day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  const rangeLabel = (range: { start: number; end: number }) =>
    `${format.format(range.start)} to ${format.format(range.end)}`;
  const recentRange = rangeLabel(packet.comparison.currentRange);
  const priorRange = rangeLabel(packet.comparison.previousRange);
  const requested = CONTEXT_AREAS.filter(({ terms }) => terms.test(question));
  const context = requested.flatMap(({ ids }) => {
    const finding = ids.map((id) => packet.findings.find((item) => item.id === id))
      .find((item) => item && item.evidenceIds.length <= 2);
    if (!finding) return [];
    if (finding.id === "insulin-change" &&
      (current.basalUnitsPerDay === 0 || previous.basalUnitsPerDay === 0)) {
      const amount = (value: number | undefined) => value === undefined ? "unavailable" : formatTarvisNumber(value, { maximumFractionDigits: 1 });
      return [{ ...finding,
        title: "Recorded bolus history",
        summary: `Recorded bolus delivery averaged ${amount(current.bolusUnitsPerDay)} U/day recently versus ${amount(previous.bolusUnitsPerDay)} U/day previously. No basal amount appears in at least one period of this report, so this is not a comparison of complete insulin delivery.`,
        caveat: "Missing or zero imported basal amounts do not prove that no basal insulin was delivered. These are historical records, not dosing guidance.",
      }];
    }
    return [finding];
  });
  const missing = requested.filter(({ ids }) => !context.some(({ id }) => (ids as readonly string[]).includes(id)));
  const missingCopy = missing.length
    ? ` A comparable ${missing.map(({ label }) => label).join(", ")} summary is not available for both periods; that does not mean nothing was recorded.`
    : "";
  const observation = `${count(current[metric])} sustained ${kind} episodes were observed in the recent window, versus ${count(previous[metric])} in the previous window.`;
  const focus = {
    id: `requested-${kind}-episode-review`,
    kind: "observation",
    category: "glucose" as const,
    title: "Your recorded episodes",
    summary: observation,
    evidenceIds: glucoseIds,
    caveat: `An episode requires at least 15 minutes across the threshold and 15 minutes back across it to confirm recovery. Gaps over 12 minutes break continuity; a reporting boundary does not prove recovery.${missingCopy}`,
  };
  const required = [focus, ...context];
  const requiredIds = required.map(({ id }) => id);
  return {
    ...packet,
    requiredFindingIds: requiredIds,
    comparison: {
      ...packet.comparison,
      headline: `${count(current[metric])} observed ${kind} episodes versus ${count(previous[metric])} previously`,
      summary: `Recent: ${recentRange}. Previous: ${priorRange}. These are local-time windows (${packet.timezone}); the end time is excluded. The recent window may include only part of today. The context below compares whole periods, not records around each episode, so it cannot establish what caused the ${kind}s.`,
    },
    findings: [...required, ...packet.findings.filter(({ id, category }) => category === "data-quality" && !requiredIds.includes(id))],
    evidence: packet.evidence.map((item) => item.id === "current-glucose"
      ? { ...item, label: "Recent glucose window" }
      : item.id === "previous-glucose" ? { ...item, label: "Previous glucose window" } : item),
  };
}
