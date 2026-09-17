import { formatRegionalNumber } from "@/domain/regionalFormat";
import { getRuntimeLocale } from "@/domain/regionalProfileRuntime";
export type ManualUrineKetoneLevel =
  "negative" | "trace" | "+" | "++" | "+++" | "++++";

export type ManualKetoneReading =
  | { ketoneType: "blood"; value: number }
  | { ketoneType: "urine"; value: ManualUrineKetoneLevel };

export type ManualKetoneSafetyLevel =
  | "routine"
  | "urgent"
  | "emergency"
  | "unclassified";

const DETAIL_PREFIX = "t1arc:ketone:v1:";
const URINE_LEVELS: readonly ManualUrineKetoneLevel[] = [
  "negative",
  "trace",
  "+",
  "++",
  "+++",
  "++++",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactReadingKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === 2 && keys.includes("ketoneType") && keys.includes("value")
  );
}

function isUrineLevel(value: unknown): value is ManualUrineKetoneLevel {
  return (
    typeof value === "string" &&
    URINE_LEVELS.includes(value as ManualUrineKetoneLevel)
  );
}

function isManualKetoneReading(value: unknown): value is ManualKetoneReading {
  if (!isRecord(value) || !hasExactReadingKeys(value)) {
    return false;
  }

  if (value.ketoneType === "blood") {
    return (
      typeof value.value === "number" &&
      Number.isFinite(value.value) &&
      value.value >= 0 &&
      value.value <= 20
    );
  }

  return value.ketoneType === "urine" && isUrineLevel(value.value);
}

function assertManualKetoneReading(
  reading: ManualKetoneReading,
): asserts reading is ManualKetoneReading {
  if (!isManualKetoneReading(reading)) {
    throw new RangeError("Invalid manual ketone reading.");
  }
}

export function encodeManualKetoneDetail(reading: ManualKetoneReading): string {
  assertManualKetoneReading(reading);
  return `${DETAIL_PREFIX}${JSON.stringify({
    ketoneType: reading.ketoneType,
    value: reading.value,
  })}`;
}

export function decodeManualKetoneDetail(
  detail?: string,
): ManualKetoneReading | undefined {
  if (typeof detail !== "string" || !detail.startsWith(DETAIL_PREFIX)) {
    return undefined;
  }

  const payload = detail.slice(DETAIL_PREFIX.length);
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }

  if (!isManualKetoneReading(parsed)) {
    return undefined;
  }

  // Only accept our canonical encoding. This rejects whitespace, reordered or
  // duplicate keys, and prefix lookalikes rather than loosely interpreting them.
  return encodeManualKetoneDetail(parsed) === detail ? parsed : undefined;
}

export function usesManualKetoneDetailNamespace(detail?: string): boolean {
  return typeof detail === "string" && detail.startsWith(DETAIL_PREFIX);
}

export function formatManualKetoneTitle(
  reading: ManualKetoneReading,
  locale = getRuntimeLocale(),
): string {
  assertManualKetoneReading(reading);

  if (reading.ketoneType === "blood") {
    return `Blood ketones · ${formatRegionalNumber(reading.value, locale)} mmol/L`;
  }

  const label =
    reading.value === "negative"
      ? "Negative"
      : reading.value === "trace"
        ? "Trace"
        : reading.value;
  return `Urine ketones · ${label}`;
}

export function manualKetoneSafetyLevel(
  reading: ManualKetoneReading,
  clinicalJurisdiction: string,
): ManualKetoneSafetyLevel {
  assertManualKetoneReading(reading);

  // These thresholds are the reviewed GB pathway. Other jurisdictions keep
  // the canonical reading but receive only generic care-plan/local-service
  // guidance until a qualified local clinical pack exists.
  if (clinicalJurisdiction !== "GB") return "unclassified";

  if (reading.ketoneType === "blood") {
    if (reading.value > 3) {
      return "emergency";
    }
    return reading.value >= 1.6 ? "urgent" : "routine";
  }

  if (reading.value === "+++" || reading.value === "++++") {
    return "emergency";
  }
  return reading.value === "++" ? "urgent" : "routine";
}
