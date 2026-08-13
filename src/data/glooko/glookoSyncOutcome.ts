import type { GlookoExportResult } from '../../../modules/daymark-glooko-export';

interface GlookoStepOutcome {
  status: string;
  reason?: string;
}

export function isBusyGlookoExportResult(result: GlookoExportResult) {
  return result.status === 'cancelled' && result.reason === 'busy';
}

export function glookoStepCountsAsSkipped(outcome: GlookoStepOutcome) {
  return outcome.status === 'skipped' ||
    (outcome.status === 'cancelled' && outcome.reason === 'busy');
}

export function glookoStepCountsAsFailure(outcome: GlookoStepOutcome) {
  return outcome.status === 'failed' ||
    (outcome.status === 'cancelled' && outcome.reason !== 'busy');
}

export function stateAfterBusyGlookoAttempt<
  State extends { lastAttemptAt?: number },
>(previous: State, current: State, startedAt: number) {
  return current.lastAttemptAt === startedAt
    ? { ...current, lastAttemptAt: previous.lastAttemptAt }
    : current;
}
