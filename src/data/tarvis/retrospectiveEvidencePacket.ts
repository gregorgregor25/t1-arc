import type { EvidenceReference } from "@/domain/insights";
import { getRuntimeRegionalDefaults } from "@/domain/regionalProfileRuntime";

import type { RetrospectiveEventReview } from "./retrospectiveEventReview";
import type {
  TarvisEvidenceItem,
  TarvisRetrospectiveEvidencePacket,
} from "./types";
import { NICE_TYPE_1_EXERCISE_KNOWLEDGE } from "./reviewedKnowledge";

const MAX_EXAMPLES_PER_EVIDENCE = 5;

function modelEvidenceId(index: number) {
  return `incident-evidence-${index + 1}`;
}

function evidenceItem(
  reference: EvidenceReference,
  index: number,
): TarvisEvidenceItem {
  const id = modelEvidenceId(index);
  return {
    id,
    label: reference.label,
    description: reference.description,
    range: reference.range,
    recordCount: reference.recordIds.length,
    examples: reference.examples
      .slice(0, MAX_EXAMPLES_PER_EVIDENCE)
      .map((example, exampleIndex) => ({
        ...example,
        id: `${id}:example-${exampleIndex + 1}`,
      })),
  };
}

/**
 * Keeps model-facing evidence handles request-local while preserving the
 * on-phone link to the complete local evidence inspector.
 */
export function mapTarvisRetrospectiveEvidenceReferences(
  references: readonly EvidenceReference[],
) {
  return new Map(
    references.map((reference, index) => {
      const id = modelEvidenceId(index);
      return [id, { ...reference, id }];
    }),
  );
}

/**
 * Converts the complete local incident review into a model-safe dossier. The
 * chronology is deterministic and every available category-level citation is
 * retained; the model is responsible only for interpretation and voice.
 */
export function buildTarvisRetrospectiveEvidencePacket(
  review: RetrospectiveEventReview,
  generatedAt: number,
): TarvisRetrospectiveEvidencePacket {
  const regional = getRuntimeRegionalDefaults();
  return {
    schemaVersion: 1,
    requestMode: "retrospective",
    timezone: regional.timeZone,
    units: {
      glucose: "mmol/L",
      insulin: "U",
      carbohydrates: "g",
    },
    generatedAt,
    verifiedReview: {
      headline: review.answer.headline,
      chronology: review.answer.answer,
      confidence: review.answer.confidence,
      limitations: [...review.answer.limitations],
      eventKind: review.event?.kind ?? "neutral",
      eventObserved: review.event?.observed ?? false,
      activityContributionSupported:
        review.event?.activityContributionSupported ?? false,
    },
    reviewedKnowledge:
      regional.clinicalJurisdiction === "GB"
        ? [{ ...NICE_TYPE_1_EXERCISE_KNOWLEDGE }]
        : [],
    evidence: review.evidence.map(evidenceItem),
  };
}
