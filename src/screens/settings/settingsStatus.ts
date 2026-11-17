import type { StatusTone } from "@/components/ui";
import type { GlucoseAlarmConfiguration, GlucoseAlarmStatus } from "@/domain/glucoseAlarms";
import type { DataSourceStatus } from "@/domain/models";
import { relativeAge } from "@/domain/time";
import {
  glucoseSourcePageForSourceId,
  settingsMenuItem,
  type SourceJump,
} from "@/navigation/sourceNavigation";

/** One line of the Settings home status card. */
export interface SettingsStatusSummary {
  tone: StatusTone;
  title: string;
  detail: string;
  /** Spoken in place of the tone's default word. */
  statusLabel?: string;
}

export interface GlucoseSourceSummary extends SettingsStatusSummary {
  /** The page of the source in use, when T1 Arc knows which one it is. */
  page?: SourceJump;
  /** Name of the source in use, for example "AAPS on this phone". */
  sourceLabel?: string;
}

/** The combined live glucose source, as reported by the data layer. */
const LIVE_GLUCOSE_SOURCE_IDS = new Set(["t1arc-live-glucose", "t1arc-librelinkup"]);

/**
 * "Is my glucose source working?" from records already on this phone. Uses the
 * freshness the data layer reports; it does not judge readings itself.
 */
export function glucoseSourceSummary({
  readingSourceId,
  readingTimestamp,
  sources,
  now,
}: {
  readingSourceId?: string;
  readingTimestamp?: number;
  sources: readonly DataSourceStatus[];
  now: number;
}): GlucoseSourceSummary {
  const live = sources.find((source) => LIVE_GLUCOSE_SOURCE_IDS.has(source.id));
  const page = glucoseSourcePageForSourceId(readingSourceId);
  const sourceLabel = page ? settingsMenuItem(page).label : undefined;
  const age =
    readingTimestamp !== undefined && Number.isFinite(readingTimestamp)
      ? `last reading ${relativeAge(readingTimestamp, now)}`
      : undefined;
  const title = sourceLabel ? `Glucose · ${sourceLabel}` : "Glucose source";

  if (!live || (!live.isLive && readingTimestamp === undefined && !live.errorCode)) {
    return {
      tone: "off",
      title: "No glucose source yet",
      detail: "Choose where your readings come from",
      statusLabel: "Not set up",
      page,
      sourceLabel,
    };
  }
  if (live.errorCode || live.freshness === "stale" || live.freshness === "missing") {
    return {
      tone: "attention",
      title,
      detail: age ? `Needs a check · ${age}` : "Needs a check · no recent reading",
      page,
      sourceLabel,
    };
  }
  if (live.freshness === "delayed") {
    return {
      tone: "attention",
      title,
      detail: age ? `Delayed · ${age}` : "Delayed",
      statusLabel: "Delayed",
      page,
      sourceLabel,
    };
  }
  return {
    tone: "ok",
    title,
    detail: age ? `Working · ${age}` : "Working",
    page,
    sourceLabel,
  };
}

const ALARM_KIND_NAMES: readonly [keyof GlucoseAlarmConfiguration, string][] = [
  ["urgentLowEnabled", "urgent low"],
  ["lowEnabled", "low"],
  ["highEnabled", "high"],
  ["veryHighEnabled", "very high"],
  ["staleEnabled", "missing readings"],
];

function sentenceList(items: readonly string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function capitalise(text: string) {
  return text ? `${text[0]!.toUpperCase()}${text.slice(1)}` : text;
}

/** Saved alarm choices in one line. Reads saved settings only. */
export function alarmSummary(
  configuration: GlucoseAlarmConfiguration | undefined,
  status: Pick<GlucoseAlarmStatus, "readinessIssues"> | undefined,
): SettingsStatusSummary {
  if (!configuration) {
    return { tone: "off", title: "Alarms", detail: "Checking saved alarm choices…", statusLabel: "Checking" };
  }
  if (!configuration.enabled) {
    return {
      tone: "off",
      title: "Alarms off",
      detail: "T1 Arc alerts are off. Your sensor or AAPS alarms are separate.",
    };
  }
  const on = ALARM_KIND_NAMES.filter(([key]) => configuration[key] === true).map(([, name]) => name);
  const kinds = on.length ? capitalise(sentenceList(on)) : "No alerts chosen";
  const issue = status?.readinessIssues[0];
  if (issue) {
    return { tone: "attention", title: "Alarms need a check", detail: issue };
  }
  return {
    tone: "ok",
    title: configuration.audioEnabled ? "Alarms on" : "Alarms on, without sound",
    detail: kinds,
    statusLabel: "On",
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Backup reminder state in one line, from the device-local backup record. */
export function backupSummary(
  status: { lastExportedAt?: string } | undefined,
  reminderDue: boolean,
  now: number,
): SettingsStatusSummary & { due: boolean } {
  if (!status) {
    return { tone: "off", title: "Backup", detail: "Checking backup status…", statusLabel: "Checking", due: false };
  }
  const last = status.lastExportedAt ? Date.parse(status.lastExportedAt) : Number.NaN;
  if (!Number.isFinite(last)) {
    return {
      tone: "attention",
      title: "No backup saved yet",
      detail: "A locked copy you keep lets you move phones or recover",
      statusLabel: "No backup",
      due: true,
    };
  }
  const days = Math.max(0, Math.floor((now - last) / DAY_MS));
  const ago = days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
  if (reminderDue) {
    return { tone: "attention", title: "Backup due", detail: `Last backup ${ago}`, due: true };
  }
  return { tone: "ok", title: "Backed up", detail: `Last backup ${ago}`, due: false };
}
