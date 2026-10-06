import {
  classifyInsightQuestion,
  EvidenceReference,
  InsightReport,
  type InsightCategory,
} from "@/domain/insights";
import { getRuntimeAnalysisTimeZone } from "@/domain/regionalProfileRuntime";
import { HEALTH_METRIC_LABELS, type TarvisHealthMetric } from "@/domain/tarvisEntry";
import { formatTarvisNumber } from "./regionalNumberPresentation";
import {
  MAX_TARVIS_EVIDENCE_FINDING_SELECTIONS,
  MAX_TARVIS_EVIDENCE_REFERENCES,
} from "./evidenceAnswerGuardrail";

import {
  TarvisEvidenceLookup,
  TarvisEvidencePacket,
  TarvisInsightWindowSummary,
  TarvisModelEvidencePacket,
} from "./types";

const MAX_FINDINGS = 18;
const MAX_EXAMPLES_PER_EVIDENCE = 5;
const MIN_GLUCOSE_COVERAGE_PERCENT = 70;
const SELECTED_HEALTH_FIELDS: Partial<Record<TarvisHealthMetric, readonly (keyof TarvisInsightWindowSummary)[]>> = {
  sleep: ["sleepMinutesPerNight"], nutrition: ["mealCarbsPerDay"], weight: ["averageWeightKilograms", "weightRecords"],
  "blood-pressure": ["bloodPressureSystolic", "bloodPressureDiastolic"],
  "heart-rate": ["restingHeartRateBpm", "averageHeartRateBpm"],
  steps: ["stepsPerDay"], hydration: ["hydrationLitresPerDay"], distance: ["distanceKilometresPerDay"],
  energy: ["activeCaloriesPerDay"], workouts: ["activityMinutes"],
  "body-composition": ["bodyFatPercent", "leanBodyMassKilograms", "bodyWaterMassKilograms"],
  "health-glucose": ["healthConnectBloodGlucoseMmolL"], oxygen: ["oxygenSaturationPercent"],
  "respiratory-rate": ["respiratoryRatePerMinute"], hrv: ["heartRateVariabilityRmssdMs"],
  "vo2-max": ["vo2MaxMillilitresPerKilogramMinute"], temperature: ["bodyTemperatureCelsius"],
};
const SELECTED_HEALTH_FIELD_LABELS: Partial<Record<keyof TarvisInsightWindowSummary, { label: string; unit: string }>> = {
  averageWeightKilograms: { label: "average weight", unit: "kg" },
  weightRecords: { label: "weight records", unit: "" },
  bloodPressureSystolic: { label: "systolic blood pressure", unit: "mmHg" },
  bloodPressureDiastolic: { label: "diastolic blood pressure", unit: "mmHg" },
  restingHeartRateBpm: { label: "resting heart rate", unit: "bpm" },
  averageHeartRateBpm: { label: "average heart rate", unit: "bpm" },
  hydrationLitresPerDay: { label: "recorded hydration per day", unit: "L/day" },
  activityMinutes: { label: "recorded activity", unit: "minutes" },
  bodyFatPercent: { label: "body fat", unit: "%" },
  leanBodyMassKilograms: { label: "lean body mass", unit: "kg" },
  bodyWaterMassKilograms: { label: "body water mass", unit: "kg" },
  healthConnectBloodGlucoseMmolL: { label: "Health Connect glucose", unit: "mmol/L" },
  oxygenSaturationPercent: { label: "oxygen saturation", unit: "%" },
  respiratoryRatePerMinute: { label: "respiratory rate", unit: "breaths/min" },
  heartRateVariabilityRmssdMs: { label: "heart-rate variability", unit: "ms" },
  vo2MaxMillilitresPerKilogramMinute: { label: "VO₂ max", unit: "mL/kg/min" },
  bodyTemperatureCelsius: { label: "body temperature", unit: "°C" },
};

function selectedHealthCurrentSummary(metric: TarvisHealthMetric, current: Partial<TarvisInsightWindowSummary>) {
  const value = (number: number, digits = 1) => formatTarvisNumber(number, { maximumFractionDigits: digits });
  if (metric === "sleep" && current.sleepMinutesPerNight != null)
    return `Recorded sleep averaged ${value(Math.floor(current.sleepMinutesPerNight / 60), 0)} h ${value(current.sleepMinutesPerNight % 60, 0)} min in the selected period.`;
  if (metric === "nutrition" && current.mealCarbsPerDay != null)
    return `Recorded meal carbohydrates averaged ${value(current.mealCarbsPerDay)} g/day in the selected period.`;
  if (metric === "distance" && current.distanceKilometresPerDay != null)
    return `Recorded distance averaged ${value(current.distanceKilometresPerDay)} km/day in the selected period.`;
  if (metric === "energy" && current.activeCaloriesPerDay != null)
    return `Recorded active energy averaged ${value(current.activeCaloriesPerDay, 0)} kcal/day in the selected period.`;
  if (metric === "steps" && current.stepsPerDay != null)
    return `Recorded steps averaged ${value(current.stepsPerDay, 0)} per day in the selected period.`;
  if (metric === "heart-rate" && (current.restingHeartRateBpm ?? current.averageHeartRateBpm) != null)
    return `Recorded heart rate was ${value((current.restingHeartRateBpm ?? current.averageHeartRateBpm)!, 0)} bpm in the selected period.`;
  if (metric === "health-glucose" && current.healthConnectBloodGlucoseMmolL != null)
    return `Selected Health Connect glucose was ${value(current.healthConnectBloodGlucoseMmolL)} mmol/L in the selected period.`;
  const available = (SELECTED_HEALTH_FIELDS[metric] ?? []).flatMap((key) => {
    const recorded = current[key];
    const presentation = SELECTED_HEALTH_FIELD_LABELS[key];
    return typeof recorded === "number" && presentation
      ? [`${presentation.label}: ${value(recorded)}${presentation.unit ? ` ${presentation.unit}` : ""}`]
      : [];
  });
  return available.length ? `Selected ${HEALTH_METRIC_LABELS[metric]} records in this period: ${available.join("; ")}.` : undefined;
}

/** A named sleep request must not lose its evidence to the generic report cap. */
export function requestsSleepEvidence(question: string) {
  return /\b(?:sleep|slept|sleeping|bedtime)\b/i.test(question);
}

export function toTarvisInsightWindowSummary(
  summary: InsightReport["current"],
): TarvisInsightWindowSummary {
  if (summary.glucoseReadings > 0) return { ...summary };
  return {
    ...summary,
    glucoseAverage: null,
    glucoseStandardDeviation: null,
    glucoseCvPercent: null,
    timeBelowPercent: null,
    timeInRangePercent: null,
    timeAbovePercent: null,
    highGlucoseRuns: null,
    lowGlucoseRuns: null,
  };
}

function glucoseCoverageContext(report: InsightReport) {
  const windows = [
    { label: "Recent period", summary: report.current },
    { label: "Previous period", summary: report.previous },
  ];
  const details = windows.flatMap(({ label, summary }) => {
    if (summary.glucoseReadings === 0) {
      return [
        `${label} has no glucose readings, so its glucose metrics are unavailable`,
      ];
    }
    if (summary.coveragePercent < MIN_GLUCOSE_COVERAGE_PERCENT) {
      return [
        `${label} has ${formatTarvisNumber(summary.coveragePercent, { maximumFractionDigits: 2 })}% sensor coverage, so its glucose values describe observed sensor time only and are not complete-period estimates`,
      ];
    }
    return [];
  });
  return details.length ? `${details.join(". ")}.` : undefined;
}

export function buildTarvisEvidencePacket(
  report: InsightReport,
  options: { includeGlucoseCoverageContext?: boolean; question?: string } = {},
): TarvisEvidenceLookup {
  const references = new Map<string, EvidenceReference>();
  const coverageContext =
    options.includeGlucoseCoverageContext === false
      ? undefined
      : glucoseCoverageContext(report);
  const hasEmptyGlucoseWindow =
    report.current.glucoseReadings === 0 ||
    report.previous.glucoseReadings === 0;
  const eligibleFindings = report.findings.filter(
    (finding) =>
      !hasEmptyGlucoseWindow ||
      finding.category !== "glucose" ||
      finding.id === "glucose-overview",
  );
  // A manually recorded ketone value must not disappear merely because an
  // unusually rich report reached the model-packet cap. Keep this typed,
  // safety-relevant finding ahead of the otherwise stable report order.
  const prioritizeSleep = options.question && requestsSleepEvidence(options.question);
  const prioritizeBasal = options.question && /\bbasal\b/i.test(options.question);
  const requestedFinding = ({ category, id }: InsightReport["findings"][number]) =>
    (prioritizeSleep && category === "sleep") ||
    (prioritizeBasal && id === "basal-daily-totals");
  const sourceFindings = [
    ...eligibleFindings.filter(({ id }) => id === "recorded-ketone-readings"),
    ...eligibleFindings.filter((finding) =>
      finding.id !== "recorded-ketone-readings" && requestedFinding(finding)),
    ...eligibleFindings.filter((finding) =>
      finding.id !== "recorded-ketone-readings" && !requestedFinding(finding)),
  ].slice(0, MAX_FINDINGS);
  const findings = sourceFindings.map((finding) => {
    const evidenceIds: string[] = [];
    finding.evidence.forEach((reference) => {
      references.set(reference.id, reference);
      evidenceIds.push(reference.id);
    });
    return {
      id: finding.id,
      kind: finding.kind,
      category: finding.category,
      title:
        hasEmptyGlucoseWindow && finding.category === "glucose"
          ? "Glucose comparison has missing data"
          : finding.title,
      summary:
        finding.category === "glucose" && coverageContext
          ? hasEmptyGlucoseWindow
            ? coverageContext
            : `${coverageContext} ${finding.summary}`
          : finding.summary,
      caveat: finding.caveat,
      evidenceIds,
    };
  });

  const packet: TarvisEvidencePacket = {
    schemaVersion: 1,
    timezone: getRuntimeAnalysisTimeZone(),
    units: {
      glucose: "mmol/L",
      weight: "kg",
      distance: "km",
    },
    generatedAt: report.generatedAt,
    comparison: {
      currentRange: report.currentRange,
      previousRange: report.previousRange,
      headline: report.headline,
      summary:
        coverageContext && hasEmptyGlucoseWindow
          ? coverageContext
          : coverageContext
            ? `${coverageContext} ${report.summary}`
            : report.summary,
      current: toTarvisInsightWindowSummary(report.current),
      previous: toTarvisInsightWindowSummary(report.previous),
    },
    findings,
    evidence: [...references.values()].map((reference) => ({
      id: reference.id,
      label: reference.label,
      description: reference.description,
      range: reference.range,
      recordCount: reference.recordIds.length,
      examples: reference.examples
        .slice(0, MAX_EXAMPLES_PER_EVIDENCE)
        .map((example) => ({ ...example })),
    })),
  };
  return { packet, references };
}

function selectedCurrentWindowSummary(
  current: Partial<TarvisInsightWindowSummary>,
  categories: ReadonlySet<InsightCategory>,
  question: string,
  selectedHealthMetric?: TarvisHealthMetric,
): Partial<TarvisInsightWindowSummary> {
  const selected: Partial<TarvisInsightWindowSummary> = {};
  if (categories.has("glucose")) {
    Object.assign(selected, {
      glucoseAverage: current.glucoseAverage,
      glucoseStandardDeviation: current.glucoseStandardDeviation,
      glucoseCvPercent: current.glucoseCvPercent,
      timeInRangePercent: current.timeInRangePercent,
      timeAbovePercent: current.timeAbovePercent,
      timeBelowPercent: current.timeBelowPercent,
      coveragePercent: current.coveragePercent,
      glucoseReadings: current.glucoseReadings,
      highGlucoseRuns: current.highGlucoseRuns,
      lowGlucoseRuns: current.lowGlucoseRuns,
    });
  }
  if (selectedHealthMetric) {
    for (const key of SELECTED_HEALTH_FIELDS[selectedHealthMetric] ?? []) {
      const recorded = current[key];
      if (recorded !== undefined) Object.assign(selected, { [key]: recorded });
    }
    return selected;
  }
  if (categories.has("insulin")) {
    // A day-level source finding is authoritative for basal-only questions.
    // The aggregate breakdown can be zero when delivery timing is absent.
    const basalOnly = /\bbasal\b/i.test(question) &&
      !/\b(?:bolus|total insulin|all insulin)\b/i.test(question);
    if (!basalOnly && /\bbolus\b/i.test(question) && !/\b(?:basal|total insulin|all insulin)\b/i.test(question)) {
      selected.bolusUnitsPerDay = current.bolusUnitsPerDay;
    } else if (!basalOnly) Object.assign(selected, {
      insulinUnits: current.insulinUnits,
      insulinUnitsPerDay: current.insulinUnitsPerDay,
      basalUnitsPerDay: current.basalUnitsPerDay,
      bolusUnitsPerDay: current.bolusUnitsPerDay,
    });
  }
  if (categories.has("food")) Object.assign(selected, {
    mealCarbsPerDay: current.mealCarbsPerDay,
    lateMeals: current.lateMeals,
  });
  if (categories.has("sleep")) selected.sleepMinutesPerNight = current.sleepMinutesPerNight;
  if (categories.has("activity")) Object.assign(selected, {
    activityMinutes: current.activityMinutes,
    stepsPerDay: current.stepsPerDay,
    distanceKilometresPerDay: current.distanceKilometresPerDay,
    activeCaloriesPerDay: current.activeCaloriesPerDay,
  });
  if (categories.has("heart")) Object.assign(selected, {
    averageHeartRateBpm: current.averageHeartRateBpm,
    restingHeartRateBpm: current.restingHeartRateBpm,
    heartRateVariabilityRmssdMs: current.heartRateVariabilityRmssdMs,
  });
  if (categories.has("weight") || categories.has("body")) Object.assign(selected, {
    averageWeightKilograms: current.averageWeightKilograms,
    weightRecords: current.weightRecords,
    bodyFatPercent: current.bodyFatPercent,
    leanBodyMassKilograms: current.leanBodyMassKilograms,
    bodyWaterMassKilograms: current.bodyWaterMassKilograms,
  });
  if (categories.has("hydration")) selected.hydrationLitresPerDay = current.hydrationLitresPerDay;
  if (categories.has("vitals")) Object.assign(selected, {
    healthConnectBloodGlucoseMmolL: current.healthConnectBloodGlucoseMmolL,
    bloodPressureSystolic: current.bloodPressureSystolic,
    bloodPressureDiastolic: current.bloodPressureDiastolic,
    oxygenSaturationPercent: current.oxygenSaturationPercent,
    respiratoryRatePerMinute: current.respiratoryRatePerMinute,
    vo2MaxMillilitresPerKilogramMinute: current.vo2MaxMillilitresPerKilogramMinute,
    bodyTemperatureCelsius: current.bodyTemperatureCelsius,
  });
  return selected;
}

/**
 * The Insights report is comparative for its own UI, even when the user asked
 * Tarv1s about one period. This projection is applied before model selection
 * or transport, so prior-period values and records never enter that request.
 */
export function currentPeriodTarvisEvidence(
  lookup: TarvisEvidenceLookup,
  report: InsightReport,
  question: string,
): TarvisEvidenceLookup {
  if (lookup.packet.comparison.currentOnly) return lookup;
  const range = report.currentRange;
  const categories = new Set(classifyInsightQuestion(question));
  if (lookup.packet.selectedHealthCategory) categories.add(lookup.packet.selectedHealthCategory);
  const requestedGlucose = categories.has("glucose");
  const selectedHealthMetric = lookup.packet.selectedHealthMetric;
  const recordedCurrent = toTarvisInsightWindowSummary(report.current);
  const selectedMetricSummary = selectedHealthMetric
    ? selectedHealthCurrentSummary(selectedHealthMetric, recordedCurrent)
    : undefined;
  const currentItems = lookup.packet.evidence.filter((item) =>
    item.range.start >= range.start && item.range.end <= range.end &&
    item.range.end > item.range.start && !/^previous-/i.test(item.id),
  );
  const currentIds = new Set(currentItems.map(({ id }) => id));
  const originalFindings = new Map(report.findings.map((finding) => [finding.id, finding]));
  const findings = lookup.packet.findings.flatMap((finding) => {
    if (selectedHealthMetric && finding.category === lookup.packet.selectedHealthCategory &&
        !lookup.packet.requiredFindingIds?.includes(finding.id)) return [];
    if (!categories.has(finding.category) &&
        !(requestedGlucose && finding.category === "data-quality")) return [];
    const evidenceIds = finding.evidenceIds.filter((id) => currentIds.has(id));
    if (!evidenceIds.length) return [];
    const original = originalFindings.get(finding.id);
    const refs = currentItems.filter(({ id }) => evidenceIds.includes(id));
    const summary = (selectedHealthMetric && finding.category === lookup.packet.selectedHealthCategory
      ? selectedMetricSummary : undefined) || original?.currentPeriodSummary ||
      `The requested period has ${refs.map(({ description }) => description).join("; ")}.`;
    return [{
      ...finding,
      title: finding.id === "basal-daily-totals"
        ? "Recorded daily basal totals"
        : `${finding.category} records in the requested period`,
      summary,
      evidenceIds,
    }];
  });
  const missingSelectedHealthFinding = selectedHealthMetric && lookup.packet.selectedHealthCategory &&
    selectedMetricSummary && !findings.some(({ category }) => category === lookup.packet.selectedHealthCategory);
  const selectedHealthSummaryReference: EvidenceReference | undefined = missingSelectedHealthFinding
    ? {
        id: "current-selected-health-summary",
        label: `Selected ${HEALTH_METRIC_LABELS[selectedHealthMetric]} summary`,
        description: "Locally computed summary for the selected Health metric in the requested period; subject-specific record details are not represented here",
        range: { ...range }, recordIds: [], examples: [],
      }
    : undefined;
  if (selectedHealthSummaryReference) {
    currentItems.push({
      id: selectedHealthSummaryReference.id, label: selectedHealthSummaryReference.label,
      description: selectedHealthSummaryReference.description, range: selectedHealthSummaryReference.range,
      recordCount: undefined, examples: [],
    });
    findings.push({
      id: "selected-health-summary", kind: "observation", category: lookup.packet.selectedHealthCategory!,
      title: `Recorded ${HEALTH_METRIC_LABELS[selectedHealthMetric!]} summary`,
      summary: selectedMetricSummary!,
      caveat: "This is a period-level observation, not evidence that the selected metric caused a glucose change.",
      evidenceIds: [selectedHealthSummaryReference.id],
    });
  }
  // An empty basal source is an availability result, never a zero-dose result.
  // Keep that result local to a basal request rather than adding an empty
  // finding to every Insights report.
  const noCurrentBasal = /\bbasal\b/i.test(question) &&
    !findings.some(({ id }) => id === "basal-daily-totals");
  const unavailableBasalReference: EvidenceReference | undefined = noCurrentBasal
    ? {
        id: "current-basal-data-availability",
        label: "Daily basal data availability",
        description: "No usable source-reported daily basal totals were found in the loaded records for this requested period",
        range: { ...range },
        recordIds: [],
        examples: [],
      }
    : undefined;
  if (unavailableBasalReference) {
    currentItems.push({
      id: unavailableBasalReference.id,
      label: unavailableBasalReference.label,
      description: unavailableBasalReference.description,
      range: unavailableBasalReference.range,
      recordCount: 0,
      examples: [],
    });
    findings.push({
      id: "basal-data-unavailable",
      kind: "limitation",
      category: "insulin",
      title: "Daily basal totals unavailable in the loaded records",
      summary: "No usable source-reported daily basal totals are available for the requested period. This does not establish that no basal insulin was delivered, and timing or a day-level average cannot be inferred.",
      caveat: "Missing source data are not counted as zero.",
      evidenceIds: [unavailableBasalReference.id],
    });
  }
  const usedIds = new Set(findings.flatMap(({ evidenceIds }) => evidenceIds));
  const selectedHealthDescription = selectedHealthMetric
    ? `Selected ${HEALTH_METRIC_LABELS[selectedHealthMetric]} summary for this requested period; an exact subject-specific source-record count is not available in this packet`
    : undefined;
  const evidence = currentItems.filter(({ id }) => usedIds.has(id)).map((item) =>
    selectedHealthDescription && item.id !== "current-glucose"
      ? { ...item, label: `Selected ${HEALTH_METRIC_LABELS[selectedHealthMetric!]} summary`,
          description: selectedHealthDescription, recordCount: undefined, examples: [] }
      : item);
  const current = selectedCurrentWindowSummary(recordedCurrent, categories, question, selectedHealthMetric);
  const value = (number: number, digits = 1) =>
    formatTarvisNumber(number, { maximumFractionDigits: digits });
  const selectedSummary = [
    requestedGlucose
      ? recordedCurrent.glucoseReadings > 0
        ? `${value(recordedCurrent.glucoseReadings, 0)} recorded glucose readings with ${value(recordedCurrent.coveragePercent)}% sensor coverage; mean ${recordedCurrent.glucoseAverage === null ? "unavailable" : `${value(recordedCurrent.glucoseAverage)} mmol/L`}, time in range ${recordedCurrent.timeInRangePercent === null ? "unavailable" : `${value(recordedCurrent.timeInRangePercent)}%`}, ${recordedCurrent.lowGlucoseRuns === null ? "unknown" : value(recordedCurrent.lowGlucoseRuns, 0)} observed low episodes and ${recordedCurrent.highGlucoseRuns === null ? "unknown" : value(recordedCurrent.highGlucoseRuns, 0)} observed high episodes. These describe sensor-covered time only.`
        : "No recorded glucose readings; glucose results are unavailable, not zero."
      : undefined,
    !selectedHealthMetric && categories.has("sleep") && recordedCurrent.sleepMinutesPerNight !== null
      ? `Recorded sleep averaged ${value(recordedCurrent.sleepMinutesPerNight / 60)} hours per night in this period.`
      : undefined,
    !selectedHealthMetric && categories.has("food") && recordedCurrent.mealCarbsPerDay !== null
      ? `Recorded meal carbohydrates averaged ${value(recordedCurrent.mealCarbsPerDay)} g per day in this period.`
      : undefined,
    !selectedHealthMetric && categories.has("activity") && recordedCurrent.activityMinutes !== null
      ? `Recorded activity totalled ${value(recordedCurrent.activityMinutes, 0)} minutes in this period.`
      : undefined,
    !selectedHealthMetric && categories.has("heart") && recordedCurrent.averageHeartRateBpm !== undefined
      ? `Average recorded heart rate was ${value(recordedCurrent.averageHeartRateBpm, 0)} bpm in this period.`
      : undefined,
    !selectedHealthMetric && categories.has("weight") && recordedCurrent.averageWeightKilograms !== undefined
      ? `Average recorded weight was ${value(recordedCurrent.averageWeightKilograms)} kg in this period.`
      : undefined,
    selectedHealthMetric === "health"
      ? "No specific Health metric was identified for this selection. The available glucose context cannot establish a relationship with an unspecified Health measure."
      : selectedMetricSummary,
  ].filter((part): part is string => Boolean(part)).join(" ");
  const packet: TarvisEvidencePacket = {
    ...lookup.packet,
    comparison: {
      currentOnly: true,
      currentRange: { ...range },
      headline: selectedHealthMetric === "health"
        ? "No specific Health metric selected"
        : selectedHealthMetric
        ? `${HEALTH_METRIC_LABELS[selectedHealthMetric][0]!.toUpperCase()}${HEALTH_METRIC_LABELS[selectedHealthMetric].slice(1)} in the selected period`
        : "Your recorded data in the requested period",
      summary: selectedSummary || "This evidence covers only the requested period and the selected record categories.",
      current,
    },
    requestedGlucose,
    findings,
    evidence,
    requiredFindingIds: [
      ...(lookup.packet.requiredFindingIds?.filter((id) => findings.some((finding) => finding.id === id)) ?? []),
      ...(selectedHealthSummaryReference ? ["selected-health-summary"] : []),
    ],
  };
  return {
    packet,
    references: new Map([
      ...[...lookup.references].filter(([id]) => usedIds.has(id)).map(([id, reference]) => [
        id,
        selectedHealthDescription && id !== "current-glucose"
          ? { ...reference, label: `Selected ${HEALTH_METRIC_LABELS[selectedHealthMetric!]} summary`,
              description: selectedHealthDescription, recordIds: [], examples: [] }
          : reference,
      ] as const),
      ...(unavailableBasalReference ? [[unavailableBasalReference.id, unavailableBasalReference] as const] : []),
      ...(selectedHealthSummaryReference ? [[selectedHealthSummaryReference.id, selectedHealthSummaryReference] as const] : []),
    ]),
  };
}

export function evidenceIds(packet: TarvisModelEvidencePacket) {
  return new Set(packet.evidence.map((evidence) => evidence.id));
}

export function selectTarvisEvidencePacket(
  question: string,
  packet: TarvisEvidencePacket,
): TarvisEvidencePacket {
  const categories = new Set(classifyInsightQuestion(question));
  if (packet.selectedHealthCategory) categories.add(packet.selectedHealthCategory);
  const broadQuestion = categories.size > 5;
  const relevantFindings = packet.findings.filter(
    (finding) =>
      (categories.has(finding.category) &&
        !(packet.selectedHealthCategory === finding.category && packet.selectedHealthMetric &&
          !packet.requiredFindingIds?.includes(finding.id))) ||
      (categories.has("glucose") && finding.category === "data-quality"),
  );
  const requiredIds = new Set(packet.requiredFindingIds ?? []);
  const requestedSleep = requestsSleepEvidence(question);
  const sleepFinding = requestedSleep
    ? packet.findings.find(({ category }) => category === "sleep")
    : undefined;
  const basalFinding = /\bbasal\b/i.test(question)
    ? packet.findings.find(({ id }) => id === "basal-daily-totals")
    : undefined;
  // Named evidence must survive hosted ranking and the local
  // fallback. Keep the established six-finding/twelve-reference boundary.
  for (const finding of [sleepFinding, basalFinding]) {
    if (!finding || requiredIds.has(finding.id)) continue;
    const requiredEvidence = new Set(packet.findings
      .filter(({ id }) => requiredIds.has(id))
      .flatMap(({ evidenceIds }) => evidenceIds));
    finding.evidenceIds.forEach((id) => requiredEvidence.add(id));
    if (requiredIds.size < MAX_TARVIS_EVIDENCE_FINDING_SELECTIONS &&
      requiredEvidence.size <= MAX_TARVIS_EVIDENCE_REFERENCES) {
      requiredIds.add(finding.id);
    }
  }
  const candidates = relevantFindings;
  const findings = [
    ...packet.findings.filter(({ id }) => requiredIds.has(id)),
    ...candidates.filter(({ id }) => !requiredIds.has(id)),
  ].slice(0, broadQuestion ? MAX_FINDINGS : 10);
  const selectedEvidenceIds = new Set(
    findings.flatMap((finding) => finding.evidenceIds),
  );
  const evidence = packet.evidence
    .filter((item) => selectedEvidenceIds.has(item.id))
    .map((item) => ({
      ...item,
      examples: item.examples.slice(0, broadQuestion ? 0 : 1),
    }));

  const comparison = packet.comparison.currentOnly
    ? packet.comparison
    : {
        currentRange: packet.comparison.currentRange,
        previousRange: packet.comparison.previousRange,
        current: selectedCurrentWindowSummary(packet.comparison.current, categories, question, packet.selectedHealthMetric),
        previous: selectedCurrentWindowSummary(packet.comparison.previous, categories, question, packet.selectedHealthMetric),
        headline: packet.selectedHealthMetric
          ? `${HEALTH_METRIC_LABELS[packet.selectedHealthMetric][0]!.toUpperCase()}${HEALTH_METRIC_LABELS[packet.selectedHealthMetric].slice(1)} in the selected period`
          : packet.requiredFindingIds?.some((id) => /^requested-(?:low|high)-episode-review$/.test(id))
          ? packet.comparison.headline
          : "Your recorded data in the compared periods",
        summary: packet.selectedHealthMetric
          ? packet.comparison.summary
          : packet.requiredFindingIds?.some((id) => /^requested-(?:low|high)-episode-review$/.test(id))
          ? packet.comparison.summary
          : "The requested record categories were compared locally across the two stated periods; missing values are not treated as zero.",
      };
  return {
    ...packet,
    comparison,
    requestedGlucose: categories.has("glucose"),
    ...(requestedSleep ? { requestedSleep: true } : {}),
    ...(requiredIds.size ? { requiredFindingIds: [...requiredIds] } : {}),
    findings,
    evidence,
  };
}
