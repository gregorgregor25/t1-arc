import type { GlookoImportRegionalSettings } from "./glookoCsv";
import type { T1ArcRegionalDefaults } from "@/domain/regionalProfile";
import { isIanaTimeZone } from "@/domain/regionalProfile";

export function snapshotGlookoImportRegionalSettings(
  settings: GlookoImportRegionalSettings,
): GlookoImportRegionalSettings {
  const timeZone = settings.timeZone.trim();
  if (!isIanaTimeZone(timeZone)) {
    throw new Error("Enter a valid IANA timezone, such as Europe/London.");
  }
  if (
    settings.dateOrder !== "day-first" &&
    settings.dateOrder !== "month-first"
  ) {
    throw new Error("Choose the numeric date order used by this Glooko file.");
  }
  return Object.freeze({ timeZone, dateOrder: settings.dateOrder });
}

export function defaultGlookoManualFileSettings(
  defaults: Pick<T1ArcRegionalDefaults, "timeZone" | "glookoRegion">,
) {
  return snapshotGlookoImportRegionalSettings({
    timeZone: defaults.timeZone,
    dateOrder: defaults.glookoRegion === "us" ? "month-first" : "day-first",
  });
}

export function glookoDateOrderLabel(
  dateOrder: GlookoImportRegionalSettings["dateOrder"],
) {
  return dateOrder === "month-first" ? "month/day/year" : "day/month/year";
}
