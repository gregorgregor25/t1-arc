import { describe, expect, it, vi } from "vitest";

import {
  createManualContextEvent,
  isManualKetoneEvent,
  manualContextDraftFromEvent,
  manualKetoneDraftFromEvent,
  reviseManualContextEvent,
} from "@/data/manualContext";
import { decodeManualKetoneDetail } from "@/data/manualKetones";

describe("manual context normalisation", () => {
  it("creates a traceable meal event", () => {
    const timestamp = Date.parse("2026-07-26T12:30:00+01:00");
    expect(
      createManualContextEvent(
        {
          kind: "meal",
          timestamp,
          mealType: "lunch",
          carbsGrams: 56,
        },
        { id: "manual-1", recordedAt: timestamp + 1000 },
      ),
    ).toEqual({
      id: "manual-1",
      kind: "meal",
      start: timestamp,
      title: "Lunch",
      mealType: "lunch",
      carbsGrams: 56,
      sourceId: "t1arc-manual",
      origin: "manual",
      recordedAt: timestamp + 1000,
    });
  });

  it("stores sleep as the interval ending at the selected wake time", () => {
    const wake = Date.parse("2026-07-26T07:00:00+01:00");
    const event = createManualContextEvent(
      {
        kind: "sleep",
        timestamp: wake,
        durationMinutes: 450,
        qualityPercent: 82,
      },
      { id: "manual-sleep" },
    );

    expect(event.kind).toBe("sleep");
    expect(event.start).toBe(wake - 450 * 60_000);
    expect(event.end).toBe(wake);
  });

  it("rejects implausible values instead of silently storing them", () => {
    expect(() =>
      createManualContextEvent(
        {
          kind: "weight",
          timestamp: Date.now(),
          kilograms: 5,
        },
        { id: "bad-weight" },
      ),
    ).toThrow(/between 20 and 400/);
  });

  it("creates a factual context note without implying causation", () => {
    const timestamp = Date.parse("2026-07-26T19:15:00+01:00");
    expect(
      createManualContextEvent(
        {
          kind: "note",
          timestamp,
          category: "pump",
          detail: "Changed pod after a suspected site issue",
        },
        { id: "manual-note", recordedAt: timestamp + 2_000 },
      ),
    ).toEqual({
      id: "manual-note",
      kind: "note",
      start: timestamp,
      title: "Pod / site",
      category: "pump",
      detail: "Changed pod after a suspected site issue",
      sourceId: "t1arc-manual",
      origin: "manual",
      recordedAt: timestamp + 2_000,
    });
  });

  it("rejects oversized note detail", () => {
    expect(() =>
      createManualContextEvent({
        kind: "note",
        timestamp: Date.now(),
        category: "other",
        detail: "x".repeat(1_001),
      }),
    ).toThrow(/1,000 characters or fewer/i);
  });

  it("stores and round-trips a blood ketone reading as a protected manual note", () => {
    const timestamp = Date.now() - 60_000;
    const event = createManualContextEvent(
      {
        kind: "ketone",
        ketoneType: "blood",
        timestamp,
        value: 1.7,
      },
      { id: "manual-blood-ketone", recordedAt: timestamp + 500 },
    );

    expect(event).toMatchObject({
      id: "manual-blood-ketone",
      kind: "note",
      title: "Blood ketones · 1.7 mmol/L",
      category: "other",
      sourceId: "t1arc-manual",
      origin: "manual",
      start: timestamp,
      recordedAt: timestamp + 500,
    });
    expect(event.kind).toBe("note");
    if (event.kind !== "note") throw new Error("Expected stored note.");
    expect(decodeManualKetoneDetail(event.detail)).toEqual({
      ketoneType: "blood",
      value: 1.7,
    });
    expect(manualKetoneDraftFromEvent(event)).toEqual({
      kind: "ketone",
      ketoneType: "blood",
      timestamp,
      value: 1.7,
    });
    expect(manualContextDraftFromEvent(event)).toEqual({
      kind: "ketone",
      ketoneType: "blood",
      timestamp,
      value: 1.7,
    });
    expect(isManualKetoneEvent(event)).toBe(true);
  });

  it("stores, edits and identifies a urine ketone reading without changing its identity", () => {
    const timestamp = Date.now() - 60_000;
    const existing = createManualContextEvent(
      {
        kind: "ketone",
        ketoneType: "urine",
        timestamp,
        value: "trace",
      },
      { id: "manual-urine-ketone", recordedAt: timestamp + 500 },
    );
    const correctedTimestamp = timestamp + 60_000;
    const corrected = reviseManualContextEvent(existing, {
      kind: "ketone",
      ketoneType: "urine",
      timestamp: correctedTimestamp,
      value: "+++",
    });

    expect(corrected).toMatchObject({
      id: "manual-urine-ketone",
      kind: "note",
      title: "Urine ketones · +++",
      category: "other",
      start: correctedTimestamp,
      recordedAt: timestamp + 500,
    });
    expect(manualKetoneDraftFromEvent(corrected)).toEqual({
      kind: "ketone",
      ketoneType: "urine",
      timestamp: correctedTimestamp,
      value: "+++",
    });
  });

  it("does not infer a ketone reading from an ordinary note title", () => {
    const event = createManualContextEvent({
      kind: "note",
      timestamp: Date.parse("2026-08-26T11:00:00+01:00"),
      title: "Blood ketones · 4 mmol/L",
      category: "other",
      detail: "A reminder to buy strips",
    });

    expect(isManualKetoneEvent(event)).toBe(false);
  });

  it("does not let an ordinary note enter the reserved ketone namespace", () => {
    expect(() =>
      createManualContextEvent({
        kind: "note",
        timestamp: Date.now(),
        category: "other",
        detail: 't1arc:ketone:v1:{"ketoneType":"urine","value":"trace"}',
      }),
    ).toThrow(/reserved for saved ketone readings/i);
  });

  it("rejects invalid manual ketone results", () => {
    expect(() =>
      createManualContextEvent({
        kind: "ketone",
        ketoneType: "blood",
        timestamp: Date.now(),
        value: 20.1,
      }),
    ).toThrow(/between 0 and 20/i);
    expect(() =>
      createManualContextEvent({
        kind: "ketone",
        ketoneType: "urine",
        timestamp: Date.now(),
        value: "large" as never,
      }),
    ).toThrow(/valid urine ketone result/i);
    expect(() =>
      createManualContextEvent({
        kind: "ketone",
        ketoneType: "capillary",
        timestamp: Date.now(),
        value: "trace",
      } as never),
    ).toThrow(/choose blood or urine/i);
  });

  it("rejects future ketone timestamps in both creation and revision paths", () => {
    vi.useFakeTimers();
    const now = Date.parse("2026-08-26T12:00:00+01:00");
    vi.setSystemTime(now);
    try {
      expect(() =>
        createManualContextEvent({
          kind: "ketone",
          ketoneType: "blood",
          timestamp: now + 60_001,
          value: 1.2,
        }),
      ).toThrow(/cannot be dated in the future/i);

      expect(() =>
        createManualContextEvent({
          kind: "ketone",
          ketoneType: "urine",
          timestamp: now + 60_000,
          value: "trace",
        }),
      ).not.toThrow();

      const existing = createManualContextEvent(
        {
          kind: "ketone",
          ketoneType: "urine",
          timestamp: now,
          value: "trace",
        },
        { id: "manual-future-ketone", recordedAt: now },
      );
      expect(() =>
        reviseManualContextEvent(existing, {
          kind: "ketone",
          ketoneType: "urine",
          timestamp: now + 60_001,
          value: "+",
        }),
      ).toThrow(/cannot be dated in the future/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("revises a manual entry without changing its identity or entered time", () => {
    const originalTime = Date.parse("2026-07-26T18:00:00+01:00");
    const correctedTime = Date.parse("2026-07-26T18:30:00+01:00");
    const existing = createManualContextEvent(
      {
        kind: "note",
        timestamp: originalTime,
        category: "stress",
        detail: "Busy afternoon",
      },
      { id: "manual-note-edit", recordedAt: originalTime + 5_000 },
    );

    expect(
      reviseManualContextEvent(existing, {
        kind: "note",
        timestamp: correctedTime,
        category: "illness",
        detail: "Actually felt unwell",
        title: "Feeling unwell",
      }),
    ).toEqual({
      id: "manual-note-edit",
      kind: "note",
      start: correctedTime,
      title: "Feeling unwell",
      category: "illness",
      detail: "Actually felt unwell",
      sourceId: "t1arc-manual",
      origin: "manual",
      recordedAt: originalTime + 5_000,
    });
  });

  it("does not let an edit silently change the record type or source owner", () => {
    const timestamp = Date.parse("2026-07-26T18:00:00+01:00");
    const existing = createManualContextEvent(
      {
        kind: "weight",
        timestamp,
        kilograms: 78,
      },
      { id: "manual-weight-edit" },
    );

    expect(() =>
      reviseManualContextEvent(existing, {
        kind: "activity",
        timestamp,
        activityType: "walk",
        durationMinutes: 30,
        intensity: "light",
      }),
    ).toThrow(/type .* cannot be changed/i);

    expect(() =>
      reviseManualContextEvent(
        { ...existing, sourceId: "t1arc-food" },
        {
          kind: "weight",
          timestamp,
          kilograms: 79,
        },
      ),
    ).toThrow(/created in T1 Arc/i);

    const ketone = createManualContextEvent(
      {
        kind: "ketone",
        ketoneType: "blood",
        timestamp,
        value: 1.2,
      },
      { id: "manual-ketone-edit" },
    );
    expect(() =>
      reviseManualContextEvent(ketone, {
        kind: "note",
        timestamp,
        category: "other",
        detail: "Not a ketone after all",
      }),
    ).toThrow(/type .* cannot be changed/i);
  });

  it("prefills an edit without turning an automatic label into a custom one", () => {
    const timestamp = Date.parse("2026-07-26T08:00:00+01:00");
    const automatic = createManualContextEvent(
      {
        kind: "activity",
        timestamp,
        activityType: "walk",
        durationMinutes: 25,
        intensity: "moderate",
      },
      { id: "manual-walk-edit" },
    );
    const custom = { ...automatic, title: "Walk to work" };

    expect(manualContextDraftFromEvent(automatic)).toEqual({
      kind: "activity",
      timestamp,
      activityType: "walk",
      durationMinutes: 25,
      intensity: "moderate",
    });
    expect(manualContextDraftFromEvent(custom)).toEqual({
      kind: "activity",
      timestamp,
      activityType: "walk",
      durationMinutes: 25,
      intensity: "moderate",
      title: "Walk to work",
    });

    const stress = createManualContextEvent(
      {
        kind: "note",
        timestamp,
        category: "stress",
        detail: "Busy day",
      },
      { id: "manual-stress-edit" },
    );
    const stressDraft = manualContextDraftFromEvent(stress);
    if (stressDraft.kind !== "note") throw new Error("Expected note draft.");
    expect(stressDraft.title).toBeUndefined();
    expect(
      reviseManualContextEvent(stress, {
        ...stressDraft,
        kind: "note",
        category: "illness",
      }),
    ).toMatchObject({
      id: "manual-stress-edit",
      title: "Illness",
      category: "illness",
    });
  });
});
