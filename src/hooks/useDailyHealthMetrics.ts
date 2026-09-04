import { useEffect, useRef, useState } from "react";

import { getDailyHealthMetricSnapshot } from "@/data/healthConnect/dailyHealthMetrics";
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
  const requestKey = range.start;
  const latestRange = useRef(range);
  const [snapshot, setSnapshot] =
    useState<KeyedAsyncSnapshot<number, DailyHealthSnapshot>>();
  const visibleSnapshot =
    dataMode === "live" ? snapshotValueForKey(snapshot, requestKey) : undefined;

  useEffect(() => {
    latestRange.current = range;
  }, [range]);

  useEffect(() => {
    let active = true;
    if (dataMode !== "live") {
      return () => {
        active = false;
      };
    }
    const requestedRange = latestRange.current;
    getDailyHealthMetricSnapshot({
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
  }, [dataMode, requestKey, revision]);

  return {
    metrics: visibleSnapshot?.metrics,
    records: visibleSnapshot?.records ?? [],
    contextNeedsSource: visibleSnapshot?.contextNeedsSource ?? [],
    error: visibleSnapshot?.error,
  };
}
