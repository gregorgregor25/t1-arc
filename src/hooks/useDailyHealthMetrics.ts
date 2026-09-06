import { useEffect, useRef, useState } from "react";

import { readHealthMetricSnapshot } from "@/data/healthMetricReader";
import {
  DailyHealthMetrics,
  DailyMetricRecord,
} from "@/domain/dailyHealthMetrics";
import type { HealthConnectContextCategory } from "@/data/healthConnect/healthConnectContextSelection";
import { TimeRange } from "@/domain/models";
import { useDataContext } from "@/providers/DataProvider";
import { KeyedAsyncSnapshot, snapshotValueForKey } from "./keyedAsyncSnapshot";

interface DailyHealthSnapshot {
  metrics?: DailyHealthMetrics;
  records: DailyMetricRecord[];
  contextNeedsSource: HealthConnectContextCategory[];
  error?: string;
}

export function useDailyHealthMetrics(range: TimeRange) {
  const { dataMode, revision } = useDataContext();
  const requestKey = `${dataMode}:${range.start}`;
  const refreshBucket = Math.floor(range.end / 300_000);
  const latestRange = useRef(range);
  const [snapshot, setSnapshot] =
    useState<KeyedAsyncSnapshot<string, DailyHealthSnapshot>>();
  const visibleSnapshot = snapshotValueForKey(snapshot, requestKey);

  useEffect(() => {
    latestRange.current = range;
  }, [range]);

  useEffect(() => {
    let active = true;
    const requestedRange = latestRange.current;
    readHealthMetricSnapshot(dataMode, {
      start: requestedRange.start,
      end: requestedRange.end,
    })
      .then((value) => {
        if (!active) return;
        setSnapshot({
          key: requestKey,
          value: { ...value, error: undefined },
        });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setSnapshot({
          key: requestKey,
          value: {
            metrics: undefined,
            records: [],
            contextNeedsSource: [],
            error:
              cause instanceof Error
                ? cause.message
                : "Health metrics could not be loaded.",
          },
        });
      });
    return () => {
      active = false;
    };
  }, [dataMode, requestKey, refreshBucket, revision]);

  return {
    metrics: visibleSnapshot?.metrics,
    records: visibleSnapshot?.records ?? [],
    contextNeedsSource: visibleSnapshot?.contextNeedsSource ?? [],
    error: visibleSnapshot?.error,
  };
}
