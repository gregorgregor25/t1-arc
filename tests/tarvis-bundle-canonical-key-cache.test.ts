import { describe, expect, it, vi } from "vitest";

import {
  assertGlucoseAnswerBundleV2,
  type GlucoseAnswerBundleV2,
} from "@/data/tarvis/glucoseAnswerBundleV2";
import { isReadyTarvisIntent, resolveTarvisIntent } from "@/data/tarvis/intent";
import { buildLocalGlucoseRangeAnswer } from "@/data/tarvis/localGlucoseRangeAnswer";
import type { GlucoseReading } from "@/domain/models";

const AS_OF = Date.parse("2026-09-08T18:20:50+01:00");

// Independent copy of the pre-cache canonicalization and digest. These checks
// protect saved identities, not merely consistency between two new-code calls.
function legacyCanonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(legacyCanonicalize);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, legacyCanonicalize(record[key])]));
  }
  return value;
}

function legacyDigest(value: unknown) {
  const input = JSON.stringify(legacyCanonicalize(value));
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1, h2, h3, h4]
    .map((part) => (part >>> 0).toString(16).padStart(8, "0")).join("");
}

function legacyIdentity(bundle: GlucoseAnswerBundleV2) {
  const { identity: _identity, ...body } = bundle;
  const base = {
    algorithm: "t1arc-canonical-cyrb128-v1" as const,
    queryId: `gav2-query:${legacyDigest({
      executor: body.executor,
      intent: body.intent.normalized,
      scope: {
        timezone: body.scope.timezone,
        asOf: body.scope.asOf,
        calculationRange: body.scope.calculationRange,
        evidenceContextRange: body.scope.evidenceContextRange,
        windows: body.scope.windows.map((window) => ({
          id: window.id,
          label: window.label,
          role: window.role,
          calculationRange: window.calculationRange,
          evidenceContextRange: window.evidenceContextRange,
        })),
      },
      thresholds: body.thresholds,
      algorithms: body.algorithms,
    })}`,
    dataRevisionId: `gav2-data:${legacyDigest(body.records)}`,
  };
  return { ...base, integrityId: `gav2-integrity:${legacyDigest({ ...body, identity: base })}` };
}

function reverseProperties(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseProperties);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).reverse()
      .map(([key, nested]) => [key, reverseProperties(nested)]));
  }
  return value;
}

function build(count: number) {
  const resolution = resolveTarvisIntent(
    "Compare my average glucose over the last 7 days with the previous 7 days.",
    { now: AS_OF, timezone: "Europe/London" },
  );
  if (!isReadyTarvisIntent(resolution)) throw new Error(resolution.outcome.code);
  const start = AS_OF - 14 * 86_400_000;
  const readings: GlucoseReading[] = Array.from({ length: count }, (_, index) => ({
    id: `synthetic:é:血糖:${index}`,
    timestamp: start + index * 5 * 60_000,
    receivedAt: start + index * 5 * 60_000 + 25_000,
    mmolL: 6 + index % 11 / 10,
    trend: "unknown",
    quality: "measured",
    sourceId: "synthetic-cgm",
    sourceFile: "été-血糖-😀.csv",
    sourceDeviceId: "é-e\u0301-İ-ı",
  }));
  return buildLocalGlucoseRangeAnswer({ asOf: AS_OF, intent: resolution.intent, readings });
}

describe("Glucose answer canonical key-order reuse", () => {
  it("preserves legacy query, data and integrity identities, including Unicode metadata", () => {
    const { answerBundle } = build(80);
    expect(answerBundle.identity).toEqual(legacyIdentity(answerBundle));
    const snapshot = JSON.parse(JSON.stringify(answerBundle)) as GlucoseAnswerBundleV2;
    const stored = { ...snapshot, identity: legacyIdentity(snapshot) };
    expect(() => assertGlucoseAnswerBundleV2(stored)).not.toThrow();
    expect(Object.isFrozen(answerBundle)).toBe(true);
    expect(Object.isFrozen(answerBundle.records[0])).toBe(true);
  });

  it("accepts legacy stored bundles with reversed insertion order and detects changed evidence", () => {
    const original = build(80).answerBundle;
    const reordered = reverseProperties(original) as GlucoseAnswerBundleV2;
    expect(legacyIdentity(reordered)).toEqual(original.identity);
    expect(() => assertGlucoseAnswerBundleV2(reordered)).not.toThrow();
    const changed = JSON.parse(JSON.stringify(reordered));
    changed.records[0].sourceFile = "different-血糖.csv";
    expect(() => assertGlucoseAnswerBundleV2(changed)).toThrow(/integrity|identity/i);
    changed.records[0].timestamp = AS_OF + 1;
    expect(() => assertGlucoseAnswerBundleV2(changed)).toThrow();
  });

  it("keeps collation calls bounded by shapes rather than thousands of glucose records", () => {
    const comparison = vi.spyOn(String.prototype, "localeCompare");
    try {
      build(80);
      const smallCount = comparison.mock.calls.length;
      comparison.mockClear();
      const large = build(4_032);
      const largeCount = comparison.mock.calls.length;
      expect(large.answerBundle.records.length).toBeGreaterThan(3_800);
      expect(largeCount).toBeLessThan(15_000);
      expect(largeCount).toBeLessThan(smallCount * 2 + 1_000);
      expect(large.answerBundle.claims).toHaveLength(2);
      expect(large.evidence.every((reference) => large.answer.evidenceIds.includes(reference.id))).toBe(true);
    } finally {
      comparison.mockRestore();
    }
  });

  it("does not carry a previous operation's key order into another locale comparison", () => {
    const original = build(80).answerBundle;
    const compare = String.prototype.localeCompare;
    const reversed = vi.spyOn(String.prototype, "localeCompare")
      .mockImplementation(function (this: string, ...args: Parameters<typeof compare>) {
        return -compare.apply(this, args);
      });
    try {
      const current = build(80).answerBundle;
      expect(current.identity).toEqual(legacyIdentity(current));
      expect(current.identity.dataRevisionId).not.toBe(original.identity.dataRevisionId);
      expect(() => assertGlucoseAnswerBundleV2(current)).not.toThrow();
    } finally {
      reversed.mockRestore();
    }
  });
});
