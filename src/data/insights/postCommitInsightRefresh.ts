import { generateInsightReviewIfDue } from '@/data/insights/insightReviewGenerator';
import { markInsightReviewDirty } from '@/data/insights/insightReportRepository';
import { createCoalescedPostCommitTask } from '@/data/postCommitTaskCoordinator';
import type { LocalDataWriteLease } from '@/data/privacy/localDataWriteEpoch';

const DEFAULT_POST_COMMIT_DELAY_MS = 500;

type ScheduleTask = (task: () => void, delayMs: number) => void;

export interface PostCommitInsightRefreshCoordinator {
  schedule(): void;
}

interface PostCommitInsightRefreshCoordinatorOptions {
  runRefresh: () => Promise<unknown>;
  delayMs?: number;
  scheduleTask?: ScheduleTask;
  onError?: (error: unknown) => void;
}

/**
 * Coalesces bursts of committed writes into one derived-review refresh. A
 * write arriving during generation requests exactly one follow-up pass.
 */
export function createPostCommitInsightRefreshCoordinator({
  runRefresh,
  delayMs = DEFAULT_POST_COMMIT_DELAY_MS,
  scheduleTask,
  onError = () => undefined,
}: PostCommitInsightRefreshCoordinatorOptions): PostCommitInsightRefreshCoordinator {
  const task = createCoalescedPostCommitTask<undefined>({
    run: runRefresh,
    delayMs,
    scheduleTask,
    onError,
  });

  return {
    schedule() {
      task.schedule(undefined);
    },
  };
}

interface PostCommitInsightRefreshRequestOptions {
  inputAlreadyInvalidated?: boolean;
}

interface PostCommitInsightRefreshRequestDependencies {
  markDirty: (writeLease: LocalDataWriteLease) => Promise<unknown>;
  coordinator: PostCommitInsightRefreshCoordinator;
}

/**
 * The durable dirty marker is part of save acknowledgement. Expensive review
 * generation is scheduled after commit and is deliberately not awaited.
 */
export function createPostCommitInsightRefreshRequest({
  markDirty,
  coordinator,
}: PostCommitInsightRefreshRequestDependencies) {
  return async (
    writeLease: LocalDataWriteLease,
    options: PostCommitInsightRefreshRequestOptions = {},
  ) => {
    if (!options.inputAlreadyInvalidated) {
      await markDirty(writeLease);
    }
    coordinator.schedule();
  };
}

const postCommitInsightRefreshCoordinator =
  createPostCommitInsightRefreshCoordinator({
    runRefresh: () => generateInsightReviewIfDue(),
  });

export const requestPostCommitInsightRefresh =
  createPostCommitInsightRefreshRequest({
    markDirty: markInsightReviewDirty,
    coordinator: postCommitInsightRefreshCoordinator,
  });

/** Replays a durable dirty marker after process restart or foreground setup. */
export function resumePendingInsightRefresh() {
  postCommitInsightRefreshCoordinator.schedule();
}
