import type { DiabetesRepository, GlucoseRefreshOptions } from '@/data/contracts';
import type {
  DataSourceStatus,
  GlucoseReading,
  TimeRange,
  TimelineData,
} from '@/domain/models';

/**
 * Gives the first foreground render a stable, cache-only repository while the
 * slower source/worker configuration finishes. It is used for initial startup
 * only: later owner/privacy reconfiguration still publishes a new repository
 * object so mounted hooks fail closed instead of retaining old-owner data.
 */
export class StartupLocalFirstRepository implements DiabetesRepository {
  constructor(private delegate: DiabetesRepository) {}

  upgrade(delegate: DiabetesRepository) {
    this.delegate = delegate;
  }

  refresh(options?: GlucoseRefreshOptions): Promise<void> {
    return this.delegate.refresh(options);
  }

  refreshGlucose(options?: GlucoseRefreshOptions): Promise<void> {
    return this.delegate.refreshGlucose?.(options) ?? this.delegate.refresh(options);
  }

  getTimeline(range: TimeRange): Promise<TimelineData> {
    return this.delegate.getTimeline(range);
  }

  getLatestGlucose(): Promise<GlucoseReading | undefined> {
    return this.delegate.getLatestGlucose();
  }

  getSourceStatuses(now?: number): Promise<DataSourceStatus[]> {
    return this.delegate.getSourceStatuses(now);
  }
}
