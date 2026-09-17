import { useEffect, useState } from "react";

import type { HealthTrendDay } from "@/data/healthConnect/dailyHealthMetrics";
import { readHealthTrendSnapshot } from "@/data/healthMetricReader";
import { DateKey } from "@/domain/time";
import { useDataContext } from "@/providers/DataProvider";
import { KeyedAsyncSnapshot, snapshotValueForKey } from "./keyedAsyncSnapshot";

export type { HealthTrendDay };

interface HealthTrendSnapshot {
  data: HealthTrendDay[];
  error?: string;
}

export function useHealthTrend(endDate: DateKey, days = 7) {
  const { dataMode, revision, now } = useDataContext();
  const requestKey = `${dataMode}:${endDate}:${days}`;
  const refreshBucket = Math.floor(now / 300_000);
  const [snapshot, setSnapshot] =
    useState<KeyedAsyncSnapshot<string, HealthTrendSnapshot>>();
  const visibleSnapshot = snapshotValueForKey(snapshot, requestKey);

  useEffect(() => {
    let active = true;
    const loadedAt = Date.now();
    readHealthTrendSnapshot(dataMode, endDate, days, loadedAt)
      .then((next) => {
        if (!active) return;
        setSnapshot({
          key: requestKey,
          value: { data: next, error: undefined },
        });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setSnapshot({
          key: requestKey,
          value: {
            data: [],
            error:
              cause instanceof Error
                ? cause.message
                : "Health trends could not be loaded.",
          },
        });
      });

    return () => {
      active = false;
    };
  }, [dataMode, days, endDate, requestKey, refreshBucket, revision]);

  return {
    data: visibleSnapshot?.data ?? [],
    error: visibleSnapshot?.error,
    loading: visibleSnapshot === undefined,
  };
}
