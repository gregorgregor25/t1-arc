import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildInsightReport } from "@/domain/insights";
import type { TimelineData } from "@/domain/models";
import { DEFAULT_REGIONAL_PROFILE } from "@/domain/regionalProfile";
import { setRuntimeRegionalProfile } from "@/domain/regionalProfileRuntime";
import { addDays, zonedDateTimeToTimestamp, type DateKey } from "@/domain/time";
import { buildTarvisEvidencePacket, currentPeriodTarvisEvidence, selectTarvisEvidencePacket } from "@/data/tarvis/evidencePacket";
import { localTarvisEvidenceFallback, parseTarvisEvidenceSelectionResult } from "@/data/tarvis/evidenceAnswerGuardrail";
import { buildSelectedHealthEvidencePacket } from "@/data/tarvis/selectedHealthEvidence";

const SLEEP_AND_GLUCOSE = "What do my recorded sleep and glucose show together over the last seven completed days?";
const BASAL_AND_GLUCOSE = "Compare my daily basal totals and glucose patterns over the last seven days, and explain what the lack of basal timing prevents you from concluding.";

beforeEach(() => setRuntimeRegionalProfile({
  ...DEFAULT_REGIONAL_PROFILE, analysisTimeZone: "Europe/London", followDeviceTimeZone: false,
  languageTag: "en-GB", glucoseUnit: "mmolL",
}));
afterEach(() => setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE }));

function timeline(startDate: DateKey, count: number, glucoseValue = 6.4): TimelineData {
  const range = {
    start: zonedDateTimeToTimestamp(startDate),
    end: zonedDateTimeToTimestamp(addDays(startDate, count)),
  };
  const glucose: TimelineData["glucose"] = [];
  const dailyInsulinTotals: NonNullable<TimelineData["dailyInsulinTotals"]> = [];
  for (let index = 0; index < count; index += 1) {
    const dateKey = addDays(startDate, index);
    const start = zonedDateTimeToTimestamp(dateKey);
    const end = zonedDateTimeToTimestamp(addDays(dateKey, 1));
    for (let timestamp = start; timestamp < end; timestamp += 600_000) {
      glucose.push({ id: `g:${timestamp}`, timestamp, receivedAt: timestamp,
        mmolL: glucoseValue, sourceId: "cgm", quality: "measured", trend: "flat" });
    }
    dailyInsulinTotals.push({ id: `basal:${dateKey}`, timestamp: end - 1,
      dateKey, basalUnits: 14 + index, bolusUnits: 10,
      totalUnits: 24 + index, sourceId: "glooko" });
  }
  return { range, glucose, basal: [], boluses: [], context: [], sources: [], dailyInsulinTotals };
}

function addSleep(data: TimelineData, endDate: DateKey, extraNap = false) {
  const firstDay = data.range.start === zonedDateTimeToTimestamp(endDate);
  const start = firstDay
    ? zonedDateTimeToTimestamp(endDate, 12)
    : zonedDateTimeToTimestamp(addDays(endDate, -1), 23);
  const end = firstDay
    ? zonedDateTimeToTimestamp(endDate, 13)
    : zonedDateTimeToTimestamp(endDate, 7);
  data.context.push({ id: `sleep:${endDate}`, kind: "sleep", title: "Recorded sleep",
    start, end, durationMinutes: (end - start) / 60_000,
    sourceId: "health-connect", origin: "imported" });
  if (extraNap) {
    const napStart = zonedDateTimeToTimestamp(endDate, 13);
    data.context.push({ id: `nap:${endDate}`, kind: "sleep", title: "Nap",
      start: napStart, end: napStart + 3_600_000, durationMinutes: 60,
      sourceId: "health-connect", origin: "imported" });
  }
}

function currentOnly(current: TimelineData, previous: TimelineData, question: string, selectedSleep = false) {
  const report = buildInsightReport(current, previous, current.range.end);
  const base = selectedSleep
    ? buildSelectedHealthEvidencePacket(report, "sleep")
    : buildTarvisEvidencePacket(report, { question });
  const scoped = currentPeriodTarvisEvidence(base, report, question);
  return { report, lookup: scoped, packet: selectTarvisEvidencePacket(question, scoped.packet) };
}

describe("same-date current-period observations", () => {
  it("shows all seven sleep-ending dates with same-calendar-day CGM and summed sessions, without prior data", () => {
    const current = timeline("2026-09-29", 7);
    const previous = timeline("2026-09-22", 7, 17.3);
    for (let index = 0; index < 7; index += 1) addSleep(current, addDays("2026-09-29", index), index === 2);
    const { packet } = currentOnly(current, previous, SLEEP_AND_GLUCOSE);
    const finding = packet.findings.find(({ id }) => id === "current-sleep-glucose-day-pairs");
    expect(finding?.summary).toContain("Across 7 of 7 complete local calendar days");
    expect(finding?.summary).toContain("2026-10-01: 2 recorded sleep sessions ending that day");
    expect(finding?.summary).toContain("same-date CGM 100% in range");
    expect(packet.requiredFindingIds).toContain(finding?.id);
    for (const day of ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"])
      expect(finding?.summary).toContain(day);
    const hosted = parseTarvisEvidenceSelectionResult(JSON.stringify({ findingIds: [] }), packet);
    expect(hosted.acceptedHostedSelection).toBe(true);
    expect(hosted.answer.answer).toContain("2026-10-01: 2 recorded sleep sessions");
    expect(localTarvisEvidenceFallback(packet).answer).toContain("same-date CGM");
    expect(JSON.stringify(packet)).not.toContain("17.3");
    expect(JSON.stringify(packet)).not.toContain("2026-09-22");
    expect(finding?.caveat).toContain("not glucose during sleep");
  });

  it("pairs basal totals with adequately covered days and calls out missing CGM and conflicting source days", () => {
    const current = timeline("2026-09-29", 7);
    const previous = timeline("2026-09-22", 7, 17.3);
    current.glucose = current.glucose.filter(({ timestamp }) =>
      timestamp < zonedDateTimeToTimestamp("2026-10-03") || timestamp >= zonedDateTimeToTimestamp("2026-10-04"));
    current.dailyInsulinTotals!.push({ ...current.dailyInsulinTotals![5]!, id: "conflict", sourceId: "other", basalUnits: 93, totalUnits: 103 });
    const { packet } = currentOnly(current, previous, BASAL_AND_GLUCOSE);
    const finding = packet.findings.find(({ id }) => id === "current-basal-glucose-day-pairs");
    expect(finding?.summary).toContain("2026-09-29: source-reported basal 14 U");
    expect(finding?.summary).toContain("2026-10-03 (CGM coverage 0%");
    expect(finding?.summary).toContain("2026-10-04 (conflicting daily basal totals)");
    expect(finding?.summary).toContain("Across 5 of 7 complete local calendar days");
    expect(packet.requiredFindingIds).toContain(finding?.id);
    expect(localTarvisEvidenceFallback(packet).answer).toContain("2026-10-05: source-reported basal 20 U");
    expect(JSON.stringify(packet)).not.toContain("17.3");
    expect(JSON.stringify(packet)).not.toContain("2026-09-22");
    expect(JSON.stringify(packet)).not.toContain("93 U");
    expect(finding?.caveat).toContain("no delivery times");
  });

  it("does not send paired CGM evidence for a basal-only or sleep-only request", () => {
    const current = timeline("2026-09-29", 7);
    const previous = timeline("2026-09-22", 7);
    addSleep(current, "2026-10-01");
    for (const question of [
      "What do my daily basal totals show over the last seven completed days?",
      "What do my recorded sleep sessions show over the last seven completed days?",
    ]) {
      const { packet } = currentOnly(current, previous, question);
      expect(JSON.stringify(packet)).not.toContain("same-date CGM");
      expect(JSON.stringify(packet)).not.toContain("current-sleep-glucose-pairs");
      expect(JSON.stringify(packet)).not.toContain("current-basal-glucose-pairs");
    }
  });

  it("keeps selected Sleep context's explicitly requested glucose pair, but no unrelated basal data", () => {
    const current = timeline("2026-09-29", 7);
    const previous = timeline("2026-09-22", 7);
    addSleep(current, "2026-10-01");
    const { packet, lookup } = currentOnly(current, previous, SLEEP_AND_GLUCOSE, true);
    expect(packet.requiredFindingIds).toContain("current-sleep-glucose-day-pairs");
    expect(localTarvisEvidenceFallback(packet).answer).toContain("2026-10-01: 1 recorded sleep session");
    expect(packet.evidence.find(({ id }) => id === "current-sleep-glucose-pairs")?.label)
      .toBe(lookup.references.get("current-sleep-glucose-pairs")?.label);
    expect(JSON.stringify(packet)).not.toContain("source-reported basal 16 U");
    expect(JSON.stringify(packet)).not.toContain("current-basal-glucose-pairs");
  });

  it.each(["2026-03-29", "2026-10-25"] as DateKey[])(
    "uses the actual London calendar-day length on DST date %s and assigns midnight sleep to its actual end date",
    (day) => {
      const current = timeline(addDays(day, -1), 3);
      const previous = timeline(addDays(day, -4), 3);
      addSleep(current, day);
      const midnight = zonedDateTimeToTimestamp(addDays(day, 1));
      current.context.push({ id: `midnight:${day}`, kind: "sleep", title: "Recorded sleep",
        start: zonedDateTimeToTimestamp(day, 22), end: midnight, durationMinutes: 120,
        sourceId: "health-connect", origin: "imported" });
      const { report, packet } = currentOnly(current, previous, SLEEP_AND_GLUCOSE);
      const finding = packet.findings.find(({ id }) => id === "current-sleep-glucose-day-pairs");
      expect(report.currentOnlyPairFindings?.[0]?.evidence[0]?.recordIds.length).toBeGreaterThan(100);
      expect(finding?.summary).toContain(`${day}: 1 recorded sleep session ending that day`);
      expect(finding?.summary).toContain(`${addDays(day, 1)}: 1 recorded sleep session ending that day`);
      expect(finding?.summary).toContain("100% in range");
    },
  );

  it("treats a partial current day as no complete date and bounds long-window cited IDs", () => {
    const partial = timeline("2026-10-06", 1);
    partial.range.end = zonedDateTimeToTimestamp("2026-10-06", 15);
    addSleep(partial, "2026-10-06");
    const previous = timeline("2026-10-05", 1);
    const partialFinding = buildInsightReport(partial, previous).currentOnlyPairFindings?.find(({ category }) => category === "sleep");
    expect(partialFinding?.currentPeriodSummary).toContain("No complete local calendar day falls inside");
    expect(partialFinding?.currentPeriodSummary).not.toContain("All complete dates had a usable pair");

    const long = timeline("2026-08-01", 35);
    for (let index = 0; index < 35; index += 1) addSleep(long, addDays("2026-08-01", index));
    const longReport = buildInsightReport(long, timeline("2026-06-27", 35));
    const sleep = longReport.currentOnlyPairFindings?.find(({ category }) => category === "sleep");
    expect(sleep?.currentPeriodSummary).toContain("Latest 7 of 35 paired dates");
    expect(sleep?.evidence[0]?.recordIds.length).toBeLessThan(1_100);
  });
});
