import type { DiabetesRepository } from "@/data/contracts";
import type { TimeRange, TimelineData } from "@/domain/models";

export function paddedContextRange(
  range: TimeRange,
  paddingMs: number,
  currentTime = Date.now(),
): TimeRange {
  if (paddingMs <= 0) return range;
  return {
    start: Math.max(0, range.start - paddingMs),
    end: Math.max(range.end, Math.min(range.end + paddingMs, currentTime)),
  };
}

/** Keep chart readings and delivery strictly inside range while showing nearby context. */
export async function loadTimelineWithContext(
  repository: DiabetesRepository,
  range: TimeRange,
  contextPaddingMs = 0,
  currentTime = Date.now(),
): Promise<TimelineData> {
  if (contextPaddingMs <= 0) return repository.getTimeline(range);
  const contextRange = paddedContextRange(range, contextPaddingMs, currentTime);
  const [timeline, contextTimeline] = await Promise.all([
    repository.getTimeline(range),
    repository.getTimeline(contextRange),
  ]);
  return { ...timeline, context: contextTimeline.context };
}
