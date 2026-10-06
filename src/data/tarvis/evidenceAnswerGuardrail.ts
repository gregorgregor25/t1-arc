import type { TarvisAnswer, TarvisEvidencePacket } from "./types";
import { formatTarvisNumber } from "./regionalNumberPresentation";

export const MAX_TARVIS_EVIDENCE_FINDING_SELECTIONS = 6;
export const MAX_TARVIS_EVIDENCE_REFERENCES = 12;
const MIN_COMPLETE_COVERAGE_PERCENT = 70;

interface ApprovedEvidenceFinding {
  id: string;
  title: string;
  summary: string;
  caveat?: string;
  evidenceIds: string[];
}

function nonEmptyText(value: string | undefined) {
  const text = value?.trim();
  return text || undefined;
}

function approvedFindings(
  packet: TarvisEvidencePacket,
): ApprovedEvidenceFinding[] {
  const validEvidenceIds = new Set(packet.evidence.map(({ id }) => id));
  const seenFindingIds = new Set<string>();
  const approved: ApprovedEvidenceFinding[] = [];

  for (const finding of packet.findings) {
    const id = nonEmptyText(finding.id);
    const title = nonEmptyText(finding.title);
    const summary = nonEmptyText(finding.summary);
    if (!id || !title || !summary || seenFindingIds.has(id)) continue;
    if (
      finding.evidenceIds.length === 0 ||
      finding.evidenceIds.length > MAX_TARVIS_EVIDENCE_REFERENCES ||
      new Set(finding.evidenceIds).size !== finding.evidenceIds.length ||
      finding.evidenceIds.some(
        (evidenceId) => !validEvidenceIds.has(evidenceId),
      )
    ) {
      continue;
    }
    seenFindingIds.add(id);
    approved.push({
      id,
      title,
      summary,
      caveat: nonEmptyText(finding.caveat),
      evidenceIds: [...finding.evidenceIds],
    });
  }

  return approved;
}

function requiredFindings(
  packet: TarvisEvidencePacket,
  approved: readonly ApprovedEvidenceFinding[],
): ApprovedEvidenceFinding[] | undefined {
  const ids = packet.requiredFindingIds ?? [];
  if (
    !ids.every((id) => typeof id === "string") ||
    ids.length > MAX_TARVIS_EVIDENCE_FINDING_SELECTIONS ||
    new Set(ids).size !== ids.length
  ) {
    return undefined;
  }
  const byId = new Map(approved.map((finding) => [finding.id, finding]));
  const required = ids.flatMap((id) => {
    const finding = byId.get(id);
    return finding ? [finding] : [];
  });
  return required.length === ids.length ? required : undefined;
}

function withRequiredFindings(
  packet: TarvisEvidencePacket,
  requested: readonly ApprovedEvidenceFinding[],
  approved = approvedFindings(packet),
) {
  const required = requiredFindings(packet, approved);
  if (!required) return [];
  const selectedIds = new Set(required.map(({ id }) => id));
  const evidenceIds = new Set(
    required.flatMap(({ evidenceIds: ids }) => ids),
  );
  if (
    selectedIds.size > MAX_TARVIS_EVIDENCE_FINDING_SELECTIONS ||
    evidenceIds.size > MAX_TARVIS_EVIDENCE_REFERENCES
  ) {
    return [];
  }

  for (const finding of requested) {
    if (selectedIds.has(finding.id)) continue;
    if (selectedIds.size >= MAX_TARVIS_EVIDENCE_FINDING_SELECTIONS) break;
    const nextEvidenceIds = finding.evidenceIds.filter(
      (id) => !evidenceIds.has(id),
    );
    if (evidenceIds.size + nextEvidenceIds.length > MAX_TARVIS_EVIDENCE_REFERENCES) {
      continue;
    }
    selectedIds.add(finding.id);
    nextEvidenceIds.forEach((id) => evidenceIds.add(id));
  }

  return [...required, ...requested].filter(
    (finding, index, values) =>
      selectedIds.has(finding.id) &&
      values.findIndex(({ id }) => id === finding.id) === index,
  );
}

/**
 * The model receives a closed, request-specific menu. It may rank these
 * locally generated findings, but it cannot author any user-visible clinical
 * prose or assign evidence provenance.
 */
export function tarvisEvidenceFindingOptions(packet: TarvisEvidencePacket) {
  return approvedFindings(packet).map(
    ({ id, title, summary, caveat, evidenceIds }) => ({
      id,
      title,
      summary,
      ...(caveat ? { caveat } : {}),
      evidenceIds,
    }),
  );
}

function coverageLimitations(packet: TarvisEvidencePacket) {
  const windows = [
    { label: "Recent period", summary: packet.comparison.current },
    { label: "Previous period", summary: packet.comparison.previous },
  ];
  return windows.flatMap(({ label, summary }) => {
    if (summary.glucoseReadings === 0) {
      return [
        `${label} has no glucose readings, so its glucose results are unavailable.`,
      ];
    }
    if (summary.coveragePercent < MIN_COMPLETE_COVERAGE_PERCENT) {
      return [
        `${label} has ${formatTarvisNumber(summary.coveragePercent, { maximumFractionDigits: 2 })}% sensor coverage, so its glucose results describe observed sensor time only.`,
      ];
    }
    return [];
  });
}

function requestedSleepLimitation(
  packet: TarvisEvidencePacket,
  findings: readonly ApprovedEvidenceFinding[],
) {
  if (!packet.requestedSleep) return undefined;
  const selectedIds = new Set(findings.map(({ id }) => id));
  if (packet.findings.some(({ id, category }) => category === "sleep" && selectedIds.has(id))) {
    return undefined;
  }
  if (packet.findings.some(({ category }) => category === "sleep")) {
    return "A recorded sleep finding is available, but this answer could not include its supporting evidence.";
  }
  const recent = packet.comparison.current.sleepMinutesPerNight !== null;
  const previous = packet.comparison.previous.sleepMinutesPerNight !== null;
  if (!recent && !previous) {
    return "No recorded sleep summary is available for either period in the loaded data. This does not prove that no sleep occurred.";
  }
  if (!recent) {
    return "A sleep summary is available for the previous period, but none is available for the recent period, so sleep cannot be compared. This does not prove that no sleep occurred recently.";
  }
  if (!previous) {
    return "A sleep summary is available for the recent period, but none is available for the previous period, so sleep cannot be compared. This does not prove that no sleep occurred previously.";
  }
  return "Recorded sleep summaries exist for both periods, but this report has no evidence-backed sleep finding to compare them.";
}

function answerFromFindings(
  packet: TarvisEvidencePacket,
  findings: readonly ApprovedEvidenceFinding[],
): TarvisAnswer {
  const comparisonSummary = nonEmptyText(packet.comparison.summary);
  const findingCopy = findings.map(
    ({ title, summary }) => `${title}. ${summary}`,
  );
  const sleepLimitation = requestedSleepLimitation(packet, findings);
  const answer = [comparisonSummary, ...findingCopy, sleepLimitation]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
  const limitations = [
    ...(sleepLimitation ? [sleepLimitation] : []),
    ...coverageLimitations(packet),
    ...findings.flatMap(({ caveat }) => (caveat ? [caveat] : [])),
  ];
  const evidenceIds = [
    ...new Set(findings.flatMap(({ evidenceIds: ids }) => ids)),
  ];
  const coverageComplete = [
    packet.comparison.current,
    packet.comparison.previous,
  ].every(
    (summary) =>
      summary.glucoseReadings > 0 &&
      summary.coveragePercent >= MIN_COMPLETE_COVERAGE_PERCENT,
  );

  return {
    headline:
      nonEmptyText(packet.comparison.headline) ??
      findings[0]?.title ??
      "Your recorded comparison",
    answer:
      answer ||
      "I don’t have a supported recorded finding for that question yet.",
    confidence:
      coverageComplete && findings.length > 0 ? "moderate" : "limited",
    evidenceIds,
    limitations: [...new Set(limitations)].slice(0, 5),
  };
}

function fallbackFindings(packet: TarvisEvidencePacket) {
  const approved = approvedFindings(packet);
  const required = requiredFindings(packet, approved) ?? [];
  const candidates = [
    ...required,
    ...approved.filter(
      ({ id }) => !required.some((finding) => finding.id === id),
    ),
  ];
  const selected = withRequiredFindings(packet, candidates, approved);
  const minimumCount = Math.max(2, required.length);
  const retainedIds = new Set(
    selected.slice(0, minimumCount).map(({ id }) => id),
  );
  required.forEach(({ id }) => retainedIds.add(id));
  return approved.filter(({ id }) => retainedIds.has(id));
}

function fallbackAnswer(packet: TarvisEvidencePacket) {
  return answerFromFindings(packet, fallbackFindings(packet));
}

export function localTarvisEvidenceFallback(packet: TarvisEvidencePacket) {
  return fallbackAnswer(packet);
}

export interface TarvisEvidenceSelectionResult {
  answer: TarvisAnswer;
  acceptedHostedSelection: boolean;
}

/**
 * Parses only a list of known finding IDs. Any altered shape, duplicate,
 * unknown ID, or selection requiring more than twelve evidence references
 * fails closed to a completely local answer.
 */
export function parseTarvisEvidenceSelectionResult(
  value: string,
  packet: TarvisEvidencePacket,
): TarvisEvidenceSelectionResult {
  const locallyApproved = approvedFindings(packet);
  if (!requiredFindings(packet, locallyApproved)) {
    return { answer: fallbackAnswer(packet), acceptedHostedSelection: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return { answer: fallbackAnswer(packet), acceptedHostedSelection: false };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { answer: fallbackAnswer(packet), acceptedHostedSelection: false };
  }
  const keys = Object.keys(parsed);
  if (keys.length !== 1 || keys[0] !== "findingIds") {
    return { answer: fallbackAnswer(packet), acceptedHostedSelection: false };
  }
  const findingIds = (parsed as { findingIds?: unknown }).findingIds;
  if (
    !Array.isArray(findingIds) ||
    findingIds.length > MAX_TARVIS_EVIDENCE_FINDING_SELECTIONS ||
    !findingIds.every((id) => typeof id === "string") ||
    new Set(findingIds).size !== findingIds.length
  ) {
    return { answer: fallbackAnswer(packet), acceptedHostedSelection: false };
  }
  if (findingIds.length === 0) {
    return { answer: fallbackAnswer(packet), acceptedHostedSelection: true };
  }

  const options = new Map(locallyApproved.map((item) => [item.id, item]));
  const selected: ApprovedEvidenceFinding[] = [];
  const evidenceIds = new Set<string>();
  for (const findingId of findingIds) {
    const finding = options.get(findingId);
    if (!finding) {
      return { answer: fallbackAnswer(packet), acceptedHostedSelection: false };
    }
    finding.evidenceIds.forEach((id) => evidenceIds.add(id));
    if (evidenceIds.size > MAX_TARVIS_EVIDENCE_REFERENCES) {
      return { answer: fallbackAnswer(packet), acceptedHostedSelection: false };
    }
    selected.push(finding);
  }

  const merged = withRequiredFindings(
    packet,
    selected,
    [...options.values()],
  );
  if (!merged.length && (packet.requiredFindingIds?.length ?? 0) > 0) {
    return { answer: fallbackAnswer(packet), acceptedHostedSelection: false };
  }

  return {
    answer: answerFromFindings(packet, merged),
    acceptedHostedSelection: true,
  };
}
