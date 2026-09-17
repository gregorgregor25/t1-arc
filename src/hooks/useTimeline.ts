import { useEffect, useMemo, useRef, useState } from "react";

import type { DiabetesRepository } from "@/data/contracts";
import { glucoseFreshness } from "@/domain/freshness";
import {
  DataSourceStatus,
  GlucoseReading,
  TimeRange,
  TimelineData,
} from "@/domain/models";
import { useDataContext } from "@/providers/DataProvider";

export interface TimelineState {
  data?: TimelineData;
  loading: boolean;
  error?: string;
}

export interface RangeTimelineState extends TimelineState {
  rangeKey: string;
  owner?: object;
}

export function timelineRangeKey(range: TimeRange) {
  return `${range.start}:${range.end}`;
}

export function timelineRequestKey(range: TimeRange, selectionKey?: string) {
  return selectionKey ?? timelineRangeKey(range);
}

export function beginTimelineRangeLoad(
  previous: RangeTimelineState,
  rangeKey: string,
  owner?: object,
): RangeTimelineState {
  if (previous.rangeKey !== rangeKey || previous.owner !== owner) {
    return { rangeKey, loading: true, owner };
  }
  return {
    ...previous,
    loading: previous.data === undefined,
    error: undefined,
  };
}

export function timelineStateForRange(
  state: RangeTimelineState,
  rangeKey: string,
  owner?: object,
): TimelineState {
  return state.rangeKey === rangeKey && state.owner === owner
    ? state
    : { loading: true };
}

export function useTimeline(range: TimeRange, selectionKey?: string) {
  const { repository, revision } = useDataContext();
  // A live range's numeric end moves with the foreground clock. A stable
  // selection key keeps that clock-only render from repeating an identical
  // encrypted query; repository revisions still revalidate with the newest
  // range, while date/range-choice changes continue to fail closed.
  const rangeKey = timelineRequestKey(range, selectionKey);
  const latestRange = useRef(range);
  useEffect(() => {
    latestRange.current = range;
  }, [range]);
  const [state, setState] = useState<RangeTimelineState>(() => ({
    rangeKey,
    loading: true,
    owner: repository,
  }));

  useEffect(() => {
    let active = true;
    if (!repository) {
      return () => {
        active = false;
      };
    }
    // Keep the current page visible while fresh data is revalidated. Replacing
    // it with a loading card made every silent glucose poll look like a full
    // screen refresh.
    const requestedRange = latestRange.current;
    repository
      .getTimeline({
        start: requestedRange.start,
        end: requestedRange.end,
      })
      .then((data) => {
        if (active) {
          setState({ data, loading: false, rangeKey, owner: repository });
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState((previous) =>
          previous.rangeKey === rangeKey && previous.owner === repository
            ? {
                ...previous,
                loading: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "Unable to load timeline.",
              }
            : previous,
        );
      });
    return () => {
      active = false;
    };
  }, [rangeKey, repository, revision]);

  return timelineStateForRange(state, rangeKey, repository);
}

export interface LatestState {
  reading?: GlucoseReading;
  sources: DataSourceStatus[];
  loading: boolean;
  error?: string;
  owner?: object;
}

export function latestStateForRepository(
  state: LatestState,
  repository?: object,
): LatestState {
  return state.owner === repository
    ? state
    : { sources: [], loading: true, owner: repository };
}

interface LatestSnapshotRequest {
  revision: number;
  epoch: number;
  reading: Promise<GlucoseReading | undefined>;
  sources: Promise<DataSourceStatus[]>;
}

const latestSnapshotRequests = new WeakMap<
  DiabetesRepository,
  LatestSnapshotRequest
>();

/**
 * Today and the hidden Settings tab remain mounted together. Share their
 * identical latest/status read for a repository revision and foreground clock
 * tick instead of running the same encrypted queries twice.
 */
export function loadLatestSnapshot(
  repository: DiabetesRepository,
  revision: number,
  epoch: number,
): LatestSnapshotRequest {
  const current = latestSnapshotRequests.get(repository);
  if (current?.revision === revision && current.epoch === epoch) return current;

  let request!: LatestSnapshotRequest;
  const evictOnRejection = <T,>(promise: Promise<T>): Promise<T> =>
    promise.catch((error: unknown) => {
      // A transient SQLite/source failure must not poison this repository
      // revision forever. Keep successful reads coalesced, but let the next
      // foreground clock tick retry a failed snapshot at the same revision.
      if (latestSnapshotRequests.get(repository) === request) {
        latestSnapshotRequests.delete(repository);
      }
      throw error;
    });
  request = {
    revision,
    epoch,
    reading: evictOnRejection(repository.getLatestGlucose()),
    sources: evictOnRejection(repository.getSourceStatuses(epoch)),
  };
  latestSnapshotRequests.set(repository, request);
  return request;
}

function latestLoadError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Unable to refresh current data.";
}

/** Re-age glucose status from its timestamp without another repository read. */
export function latestStateAtNow(
  state: LatestState,
  now: number,
): LatestState {
  let changed = false;
  const sources = state.sources.map((source) => {
    if (source.label !== "Glucose") return source;
    // Latest glucose and source metadata settle independently so the saved
    // value can paint immediately. Once the value is available, keep its
    // timestamp authoritative for the paired display status as well.
    const dataThrough = state.reading?.timestamp ?? source.dataThrough;
    const freshness = glucoseFreshness(dataThrough, now);
    if (
      freshness === source.freshness &&
      dataThrough === source.dataThrough
    ) {
      return source;
    }
    changed = true;
    return { ...source, dataThrough, freshness };
  });
  return changed ? { ...state, sources } : state;
}

export function useLatestData() {
  const { repository, now, revision } = useDataContext();
  const [state, setState] = useState<LatestState>({
    sources: [],
    loading: true,
    owner: repository,
  });

  useEffect(() => {
    let active = true;
    if (!repository) {
      return () => {
        active = false;
      };
    }
    const request = loadLatestSnapshot(repository, revision, now);
    request.reading.then(
      (reading) => {
        if (!active) return;
        setState((previous) => ({
          ...latestStateForRepository(previous, repository),
          reading,
          loading: false,
        }));
      },
      (error: unknown) => {
        if (!active) return;
        setState((previous) => ({
          ...latestStateForRepository(previous, repository),
          // A transient database/source read must not erase the last glucose
          // value that was already safely rendered for this repository.
          loading: false,
          error: latestLoadError(error),
        }));
      },
    );
    request.sources.then(
      (sources) => {
        if (!active) return;
        setState((previous) => ({
          ...latestStateForRepository(previous, repository),
          sources,
        }));
      },
      (error: unknown) => {
        if (!active) return;
        setState((previous) => {
          const current = latestStateForRepository(previous, repository);
          return {
            ...current,
            // Retain the last source metadata as well; its timestamps are
            // re-aged locally by latestStateAtNow.
            error: current.error ?? latestLoadError(error),
          };
        });
      },
    );
    return () => {
      active = false;
    };
  }, [now, repository, revision]);

  return useMemo(
    () => latestStateAtNow(latestStateForRepository(state, repository), now),
    [now, repository, state],
  );
}
