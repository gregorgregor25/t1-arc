import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getHealthConnectSourceRecordPage,
  StoredHealthConnectRecord,
} from '@/data/healthConnect/sourceRecords';
import type { TimeRange } from '@/domain/models';
import { useDataContext } from '@/providers/DataProvider';

const PAGE_SIZE = 80;

export function useHealthConnectSourceRecords(
  range: TimeRange,
  enabled: boolean,
) {
  const { dataMode, revision } = useDataContext();
  const [records, setRecords] = useState<StoredHealthConnectRecord[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    if (!enabled || dataMode !== 'live') {
      setRecords([]);
      setTotalRecords(0);
      setLoading(false);
      setLoadingMore(false);
      setError(undefined);
      return;
    }
    setLoading(records.length === 0);
    setError(undefined);
    void getHealthConnectSourceRecordPage(range, PAGE_SIZE)
      .then((page) => {
        if (generation.current !== currentGeneration) return;
        setRecords(page.records);
        setTotalRecords(page.totalRecords);
      })
      .catch((cause: unknown) => {
        if (generation.current !== currentGeneration) return;
        setRecords([]);
        setTotalRecords(0);
        setError(
          cause instanceof Error
            ? cause.message
            : 'Exact Health Connect records could not be loaded.',
        );
      })
      .finally(() => {
        if (generation.current === currentGeneration) setLoading(false);
      });
  }, [dataMode, enabled, range.end, range.start, revision]);

  const loadMore = useCallback(async () => {
    if (
      !enabled ||
      dataMode !== 'live' ||
      loading ||
      loadingMore ||
      records.length >= totalRecords
    ) {
      return;
    }
    const currentGeneration = generation.current;
    setLoadingMore(true);
    setError(undefined);
    try {
      const page = await getHealthConnectSourceRecordPage(
        range,
        PAGE_SIZE,
        records.length,
      );
      if (generation.current !== currentGeneration) return;
      setRecords((current) => [
        ...current,
        ...page.records.filter(
          (record) => !current.some((item) => item.id === record.id),
        ),
      ]);
      setTotalRecords(page.totalRecords);
    } catch (cause) {
      if (generation.current !== currentGeneration) return;
      setError(
        cause instanceof Error
          ? cause.message
          : 'More Health Connect records could not be loaded.',
      );
    } finally {
      if (generation.current === currentGeneration) setLoadingMore(false);
    }
  }, [
    dataMode,
    enabled,
    loading,
    loadingMore,
    range,
    records.length,
    totalRecords,
  ]);

  return {
    error,
    loadMore,
    loading,
    loadingMore,
    records,
    totalRecords,
  };
}
