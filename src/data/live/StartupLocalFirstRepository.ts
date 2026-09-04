import type { DiabetesRepository } from '@/data/contracts';
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

  refresh(): Promise<void> {
    return this.delegate.refresh();
  }

  refreshGlucose(): Promise<void> {
    return this.delegate.refreshGlucose?.() ?? this.delegate.refresh();
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
