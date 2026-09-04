import type { DateKey } from "@/domain/time";

/**
 * A Health screen that was showing the old "today" follows the clock into the
 * new day. A date chosen further back remains an intentional history view.
 */
export function healthDateAfterTodayChange(
  selectedDate: DateKey,
  previousToday: DateKey,
  today: DateKey,
) {
  return selectedDate === previousToday ? today : selectedDate;
}

export function presentHealthEmptyState(needsSourceChoice: boolean) {
  return needsSourceChoice
    ? {
        title: "Choose which health app to use",
        detail:
          "More than one Health Connect app supplied this type of data. Open Health Connect in Settings and choose one source.",
      }
    : {
        title: "No health records for this day",
        detail:
          "Open Health Connect from Settings to choose what T1 Arc can show here.",
      };
}
