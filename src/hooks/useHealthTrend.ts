import { useEffect, useState } from "react";

import {
  getHealthTrendSnapshot,
  HealthTrendDay,
} from "@/data/healthConnect/dailyHealthMetrics";
import { DateKey } from "@/domain/time";
import { useDataContext } from "@/providers/DataProvider";
import { KeyedAsyncSnapshot, snapshotValueForKey } from "./keyedAsyncSnapshot";

export type { HealthTrendDay };

interface HealthTrendSnapshot {
  data: HealthTrendDay[];
  error?: string;
}

export function useHealthTrend(endDate: DateKey, days = 7) {
  const { dataMode, revision } = useDataContext();
  const [snapshot, setSnapshot] =
    useState<KeyedAsyncSnapshot<DateKey, HealthTrendSnapshot>>();
  const visibleSnapshot =
    dataMode === "live" ? snapshotValueForKey(snapshot, endDate) : undefined;

  useEffect(() => {
    let active = true;
    if (dataMode !== "live") {
      return () => {
        active = false;
      };
    }

    const loadedAt = Date.now();
    getHealthTrendSnapshot(endDate, days, loadedAt)
      .then((next) => {
        if (!active) return;
        setSnapshot({
          key: endDate,
          value: { data: next, error: undefined },
        });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setSnapshot({
          key: endDate,
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
  }, [dataMode, days, endDate, revision]);

  return {
    data: visibleSnapshot?.data ?? [],
    error: visibleSnapshot?.error,
    loading: dataMode === "live" && visibleSnapshot === undefined,
  };
}
