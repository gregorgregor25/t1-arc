import { useEffect, useRef, useState } from "react";

import { getFoodLogs } from "@/data/food/foodLogRepository";
import { FoodLog } from "@/data/food/types";
import { TimeRange } from "@/domain/models";
import { useDataContext } from "@/providers/DataProvider";
import { KeyedAsyncSnapshot, snapshotValueForKey } from "./keyedAsyncSnapshot";

interface FoodLogSnapshot {
  logs: FoodLog[];
  error?: string;
}

export function foodLogRangeKey(range: TimeRange) {
  return `${range.start}:${range.end}`;
}

export function foodLogRequestKey(range: TimeRange, selectionKey?: string) {
  return selectionKey ?? foodLogRangeKey(range);
}

export function failedFoodLogSnapshot(
  previous: KeyedAsyncSnapshot<string, FoodLogSnapshot> | undefined,
  requestKey: string,
  error: string,
): KeyedAsyncSnapshot<string, FoodLogSnapshot> {
  return {
    key: requestKey,
    value: {
      logs: previous?.key === requestKey ? previous.value.logs : [],
      error,
    },
  };
}

export function useFoodLogs(range: TimeRange, selectionKey?: string) {
  const { dataMode, revision } = useDataContext();
  const requestKey = foodLogRequestKey(range, selectionKey);
  const latestRange = useRef(range);
  useEffect(() => {
    latestRange.current = range;
  }, [range]);
  const [snapshot, setSnapshot] =
    useState<KeyedAsyncSnapshot<string, FoodLogSnapshot>>();
  const visibleSnapshot =
    dataMode === "live" ? snapshotValueForKey(snapshot, requestKey) : undefined;

  useEffect(() => {
    let active = true;
    if (dataMode !== "live") {
      return () => {
        active = false;
      };
    }
    const requestedRange = latestRange.current;
    getFoodLogs({ start: requestedRange.start, end: requestedRange.end })
      .then((next) => {
        if (!active) return;
        setSnapshot({ key: requestKey, value: { logs: next } });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setSnapshot((previous) =>
          failedFoodLogSnapshot(
            previous,
            requestKey,
            cause instanceof Error
              ? cause.message
              : "Food history could not be loaded.",
          ),
        );
      });
    return () => {
      active = false;
    };
  }, [dataMode, requestKey, revision]);

  return {
    logs: visibleSnapshot?.logs ?? [],
    loading: dataMode === "live" && visibleSnapshot === undefined,
    error: visibleSnapshot?.error,
  };
}
