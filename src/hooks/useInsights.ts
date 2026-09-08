import { useEffect, useState } from "react";

import { InsightReport } from "@/domain/insights";
import { loadInsightReport } from "@/data/insights/loadInsightReport";
import { InsightPeriodDays } from "@/domain/insightRanges";
import { DateKey, dayRange, toDateKey } from "@/domain/time";
import { useDataContext } from "@/providers/DataProvider";

export interface InsightState {
  report?: InsightReport;
  loading: boolean;
  error?: string;
  requestKey?: string;
  owner?: object;
}

export function insightStateForRequest(
  state: InsightState,
  requestKey: string,
  owner?: object,
): InsightState {
  return state.requestKey === requestKey && state.owner === owner
    ? state
    : { loading: true, requestKey, owner };
}

export function insightRequestKey(
  periodDays: InsightPeriodDays,
  comparisonEndDate: DateKey,
  dataMode: string,
) {
  return `${comparisonEndDate}:${periodDays}:${dataMode}`;
}

export function insightRangeReferenceTime(
  comparisonEndDate: DateKey,
  now: number,
) {
  return comparisonEndDate === toDateKey(now)
    ? now
    : dayRange(comparisonEndDate, now).end;
}

export function useInsights(
  periodDays: InsightPeriodDays,
  comparisonEndDate: DateKey,
  enabled = true,
) {
  const { dataMode, now, repository, revision } = useDataContext();
  // Completed calendar ranges do not change as the 30-second UI clock moves.
  // A range ending today remains live and therefore follows that clock.
  const rangeReferenceTime = insightRangeReferenceTime(comparisonEndDate, now);
  const [state, setState] = useState<InsightState>({
    loading: true,
    owner: repository,
  });
  const requestKey = insightRequestKey(periodDays, comparisonEndDate, dataMode);

  useEffect(() => {
    let active = true;
    if (!enabled || !repository) {
      return () => {
        active = false;
      };
    }
    loadInsightReport({
      repository,
      dataMode,
      periodDays,
      comparisonEndDate,
      now: rangeReferenceTime,
    })
      .then((report) => {
        if (!active) return;
        setState({
          loading: false,
          requestKey,
          report,
          owner: repository,
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          loading: false,
          requestKey,
          owner: repository,
          error:
            error instanceof Error
              ? error.message
              : "Unable to build the comparison.",
        });
      });

    return () => {
      active = false;
    };
  }, [
    enabled,
    comparisonEndDate,
    dataMode,
    periodDays,
    rangeReferenceTime,
    repository,
    revision,
    requestKey,
  ]);

  return insightStateForRequest(state, requestKey, repository);
}
