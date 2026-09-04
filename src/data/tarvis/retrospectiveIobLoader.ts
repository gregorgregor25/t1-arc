import type { TimestampedIobQueryResult } from "@/data/notification/NotificationEventStore";
import type { TimeRange } from "@/domain/models";

export type RetrospectiveIobLoader = (
  range: TimeRange,
) => Promise<TimestampedIobQueryResult>;

export function createRetrospectiveIobLoader(
  dataMode: string,
  query: RetrospectiveIobLoader = async (range) => {
    const { NotificationEventStore } =
      await import("@/data/notification/NotificationEventStore");
    return new NotificationEventStore().getTimestampedIob(range);
  },
): RetrospectiveIobLoader | undefined {
  return dataMode === "live" ? query : undefined;
}
