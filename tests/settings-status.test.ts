import { describe, expect, it } from "vitest";

import { DEFAULT_GLUCOSE_ALARM_CONFIGURATION } from "@/domain/glucoseAlarms";
import type { DataSourceStatus } from "@/domain/models";
import {
  alarmSummary,
  backupSummary,
  glucoseSourceSummary,
} from "@/screens/settings/settingsStatus";

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function live(overrides: Partial<DataSourceStatus> = {}): DataSourceStatus {
  return {
    id: "t1arc-live-glucose",
    label: "Live glucose",
    detail: "",
    freshness: "fresh",
    origin: "live",
    isLive: true,
    ...overrides,
  } as DataSourceStatus;
}

describe("Settings home: glucose source line", () => {
  it("asks the person to choose a source when none is set up", () => {
    const summary = glucoseSourceSummary({ sources: [], now: NOW });
    expect(summary).toMatchObject({
      tone: "off",
      title: "No glucose source yet",
      statusLabel: "Not set up",
    });
    expect(summary.page).toBeUndefined();
  });

  it("names the source in use and says it is working", () => {
    const summary = glucoseSourceSummary({
      readingSourceId: "aaps-local",
      readingTimestamp: NOW - 2 * 60_000,
      sources: [live()],
      now: NOW,
    });
    expect(summary.tone).toBe("ok");
    expect(summary.title).toBe("Glucose · AAPS on this phone");
    expect(summary.detail).toMatch(/^Working · last reading /);
    expect(summary.page).toBe("aaps");
    expect(summary.sourceLabel).toBe("AAPS on this phone");
  });

  it("asks for a check when readings are stale, missing or failing, and never by colour alone", () => {
    for (const status of [
      live({ freshness: "stale" }),
      live({ freshness: "missing" }),
      live({ errorCode: "network" }),
    ]) {
      const summary = glucoseSourceSummary({
        readingSourceId: "t1arc-librelinkup",
        readingTimestamp: NOW - 40 * 60_000,
        sources: [status],
        now: NOW,
      });
      expect(summary.tone).toBe("attention");
      expect(summary.detail).toMatch(/^Needs a check · last reading /);
      expect(summary.page).toBe("libre");
    }
  });

  it("says when readings are delayed", () => {
    const summary = glucoseSourceSummary({
      readingSourceId: "nightscout",
      readingTimestamp: NOW - 12 * 60_000,
      sources: [live({ freshness: "delayed" })],
      now: NOW,
    });
    expect(summary).toMatchObject({ tone: "attention", statusLabel: "Delayed" });
    expect(summary.detail).toMatch(/^Delayed · last reading /);
  });

  it("does not claim a reading it does not have", () => {
    const summary = glucoseSourceSummary({
      sources: [live({ freshness: "missing", errorCode: "auth" })],
      now: NOW,
    });
    expect(summary.detail).toBe("Needs a check · no recent reading");
  });
});

describe("Settings home: alarms line", () => {
  it("shows a neutral checking state before saved choices load", () => {
    expect(alarmSummary(undefined, undefined)).toMatchObject({ tone: "off", statusLabel: "Checking" });
  });

  it("says when T1 Arc alerts are off and that other alarms are separate", () => {
    const summary = alarmSummary({ ...DEFAULT_GLUCOSE_ALARM_CONFIGURATION, enabled: false }, undefined);
    expect(summary.tone).toBe("off");
    expect(summary.title).toBe("Alarms off");
    expect(summary.detail).toContain("separate");
  });

  it("lists the alerts that are on, in plain words", () => {
    const summary = alarmSummary(
      {
        ...DEFAULT_GLUCOSE_ALARM_CONFIGURATION,
        enabled: true,
        audioEnabled: true,
        urgentLowEnabled: true,
        lowEnabled: true,
        highEnabled: false,
        veryHighEnabled: false,
        staleEnabled: true,
      },
      { readinessIssues: [], configured: true },
    );
    expect(summary).toMatchObject({
      tone: "ok",
      title: "Alarms on",
      detail: "Urgent low, low and missing readings",
      statusLabel: "On",
    });
  });

  it("says when alarms are on without sound", () => {
    const summary = alarmSummary(
      { ...DEFAULT_GLUCOSE_ALARM_CONFIGURATION, enabled: true, audioEnabled: false },
      { readinessIssues: [], configured: true },
    );
    expect(summary.title).toBe("Alarms on, without sound");
  });

  it("shows the first readiness problem instead of a reassuring line", () => {
    const summary = alarmSummary(
      { ...DEFAULT_GLUCOSE_ALARM_CONFIGURATION, enabled: true },
      { readinessIssues: ["Notifications are blocked.", "Second issue"], configured: true },
    );
    expect(summary).toMatchObject({
      tone: "attention",
      title: "Alarms need a check",
      detail: "Notifications are blocked.",
    });
  });
});

describe("Settings home: backup line", () => {
  it("shows a neutral checking state before the backup record loads", () => {
    expect(backupSummary(undefined, false, NOW)).toMatchObject({ tone: "off", due: false });
  });

  it("offers a backup when none has been saved", () => {
    expect(backupSummary({}, true, NOW)).toMatchObject({
      tone: "attention",
      title: "No backup saved yet",
      due: true,
    });
  });

  it("says how long ago the last backup was", () => {
    const today = new Date(NOW - 60_000).toISOString();
    expect(backupSummary({ lastExportedAt: today }, false, NOW)).toMatchObject({
      tone: "ok",
      title: "Backed up",
      detail: "Last backup today",
      due: false,
    });
    const yesterday = new Date(NOW - DAY - 60_000).toISOString();
    expect(backupSummary({ lastExportedAt: yesterday }, false, NOW).detail).toBe("Last backup 1 day ago");
  });

  it("follows the existing reminder rule for when a backup is due", () => {
    const old = new Date(NOW - 9 * DAY).toISOString();
    expect(backupSummary({ lastExportedAt: old }, true, NOW)).toMatchObject({
      tone: "attention",
      title: "Backup due",
      detail: "Last backup 9 days ago",
      due: true,
    });
  });
});

describe("Settings home: review follow-ups", () => {
  it("does not call imported history a working live connection", () => {
    const summary = glucoseSourceSummary({
      readingTimestamp: NOW - 2 * 60 * 1000,
      sources: [live({ isLive: false, origin: "imported" } as Partial<DataSourceStatus>)],
      now: NOW,
    });
    expect(summary.tone).toBe("attention");
    expect(summary.statusLabel).toBe("No live connection");
    expect(summary.detail).not.toContain("Working");
  });

  it("makes no sound claim for earlier alert choices that are not saved as alarms yet", () => {
    const summary = alarmSummary(
      { ...DEFAULT_GLUCOSE_ALARM_CONFIGURATION, enabled: true, audioEnabled: false },
      { readinessIssues: [], configured: false },
    );
    expect(summary).toMatchObject({ tone: "attention", statusLabel: "Not saved yet" });
    expect(summary.title).not.toContain("without sound");
  });
});
