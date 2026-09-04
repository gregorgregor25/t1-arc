import { useCallback, useEffect, useRef, useState } from "react";

import {
  getHealthConnectSourceRecordPage,
  StoredHealthConnectRecord,
} from "@/data/healthConnect/sourceRecords";
import type { TimeRange } from "@/domain/models";
import { useDataContext } from "@/providers/DataProvider";

const PAGE_SIZE = 80;

interface SourceRecordState {
  rangeKey: string;
  records: StoredHealthConnectRecord[];
  totalRecords: number;
  loading: boolean;
  loadingMore: boolean;
  error?: string;
}

export function healthConnectSourceRecordRangeKey(range: TimeRange) {
  return `${range.start}:${range.end}`;
}

export function healthConnectSourceRecordRequestKey(
  range: TimeRange,
  selectionKey?: string,
) {
  return selectionKey ?? healthConnectSourceRecordRangeKey(range);
}

export function sourceRecordStateForRange(
  state: SourceRecordState,
  rangeKey: string,
  enabled: boolean,
): SourceRecordState {
  if (!enabled) {
    return {
      rangeKey,
      records: [],
      totalRecords: 0,
      loading: false,
      loadingMore: false,
    };
  }
  return state.rangeKey === rangeKey
    ? state
    : {
        rangeKey,
        records: [],
        totalRecords: 0,
        loading: enabled,
        loadingMore: false,
      };
}

export function useHealthConnectSourceRecords(
  range: TimeRange,
  enabled: boolean,
  selectionKey?: string,
) {
  const { dataMode, revision } = useDataContext();
  const rangeKey = healthConnectSourceRecordRequestKey(range, selectionKey);
  const canLoad = enabled && dataMode === "live";
  const [state, setState] = useState<SourceRecordState>(() => ({
    rangeKey,
    records: [],
    totalRecords: 0,
    loading: canLoad,
    loadingMore: false,
  }));
  const visibleState = sourceRecordStateForRange(state, rangeKey, canLoad);
  const generation = useRef(0);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    if (!canLoad) {
      return () => {
        if (generation.current === currentGeneration) generation.current += 1;
      };
    }
    void getHealthConnectSourceRecordPage(
      { start: range.start, end: range.end },
      PAGE_SIZE,
    )
      .then((page) => {
        if (generation.current !== currentGeneration) return;
        setState({
          rangeKey,
          records: page.records,
          totalRecords: page.totalRecords,
          loading: false,
          loadingMore: false,
        });
      })
      .catch((cause: unknown) => {
        if (generation.current !== currentGeneration) return;
        setState({
          rangeKey,
          records: [],
          totalRecords: 0,
          loading: false,
          loadingMore: false,
          error:
            cause instanceof Error
              ? cause.message
              : "Exact Health Connect records could not be loaded.",
        });
      });
    return () => {
      if (generation.current === currentGeneration) generation.current += 1;
    };
  }, [canLoad, range.end, range.start, rangeKey, revision]);

  const loadMore = useCallback(async () => {
    if (
      !enabled ||
      dataMode !== "live" ||
      visibleState.loading ||
      visibleState.loadingMore ||
      visibleState.records.length >= visibleState.totalRecords
    ) {
      return;
    }
    const currentGeneration = generation.current;
    setState((current) =>
      current.rangeKey === rangeKey
        ? { ...current, loadingMore: true, error: undefined }
        : current,
    );
    try {
      const page = await getHealthConnectSourceRecordPage(
        { start: range.start, end: range.end },
        PAGE_SIZE,
        visibleState.records.length,
      );
      if (generation.current !== currentGeneration) return;
      setState((current) =>
        current.rangeKey === rangeKey
          ? {
              ...current,
              records: [
                ...current.records,
                ...page.records.filter(
                  (record) =>
                    !current.records.some((item) => item.id === record.id),
                ),
              ],
              totalRecords: page.totalRecords,
              loadingMore: false,
            }
          : current,
      );
    } catch (cause) {
      if (generation.current !== currentGeneration) return;
      setState((current) =>
        current.rangeKey === rangeKey
          ? {
              ...current,
              loadingMore: false,
              error:
                cause instanceof Error
                  ? cause.message
                  : "More Health Connect records could not be loaded.",
            }
          : current,
      );
    }
  }, [
    dataMode,
    enabled,
    range.end,
    range.start,
    rangeKey,
    visibleState.loading,
    visibleState.loadingMore,
    visibleState.records.length,
    visibleState.totalRecords,
  ]);

  return {
    error: visibleState.error,
    loadMore,
    loading: visibleState.loading,
    loadingMore: visibleState.loadingMore,
    records: visibleState.records,
    totalRecords: visibleState.totalRecords,
  };
}
