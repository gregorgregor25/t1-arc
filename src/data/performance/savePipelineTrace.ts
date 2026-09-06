export type SavePipelineOperation =
  | 'glooko-import'
  | 'bounds-refresh'
  | 'manual-context-create'
  | 'manual-context-update'
  | 'manual-insulin-create'
  | 'manual-insulin-update'
  | 'food-log-create'
  | 'food-log-update'
  | 'food-portions-update'
  | 'manual-context-delete'
  | 'manual-insulin-delete';

export type SavePipelinePhase =
  | 'glucose-write'
  | 'write-lease'
  | 'primary-write'
  | 'insight-invalidation'
  | 'mode-transition'
  | 'ui-publication'
  | 'glucose-bounds'
  | 'insulin-bounds'
  | 'context-bounds'
  | 'health-connect-bounds'
  | 'lease-validation'
  | 'acknowledgement';

type SavePipelineStatus = 'ok' | 'error';

export interface SavePipelineTrace {
  measure<T>(phase: SavePipelinePhase, work: () => Promise<T>): Promise<T>;
  run<T>(work: () => Promise<T>): Promise<T>;
}

interface SavePipelineTraceOptions {
  enabled?: boolean;
  now?: () => number;
  log?: (message: string) => void;
}

export const SAVE_PIPELINE_TRACE_PREFIX = '[T1ArcSavePerf]';

let nextTraceId = 1;

function savePipelineTracingEnabled() {
  const development = typeof __DEV__ !== 'undefined' && __DEV__;
  return (
    development || process.env.EXPO_PUBLIC_T1ARC_SAVE_PERF === '1'
  );
}

function monotonicNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

/**
 * Emits fixed-schema timings to local console/logcat in development or an
 * explicitly opted-in profiling build. The API deliberately accepts no record
 * IDs, values, names, or error messages.
 */
export function createSavePipelineTrace(
  operation: SavePipelineOperation,
  {
    enabled = savePipelineTracingEnabled(),
    now = monotonicNow,
    log = (message) => console.info(message),
  }: SavePipelineTraceOptions = {},
): SavePipelineTrace {
  if (!enabled) {
    return {
      measure: (_phase, work) => work(),
      run: (work) => work(),
    };
  }

  const traceId = nextTraceId;
  nextTraceId = nextTraceId >= Number.MAX_SAFE_INTEGER ? 1 : nextTraceId + 1;
  const acknowledgementStartedAt = now();
  const emit = (
    phase: SavePipelinePhase,
    startedAt: number,
    status: SavePipelineStatus,
  ) => {
    const durationMs = Math.max(0, now() - startedAt).toFixed(2);
    log(
      `${SAVE_PIPELINE_TRACE_PREFIX} trace=${traceId} operation=${operation} phase=${phase} status=${status} duration_ms=${durationMs}`,
    );
  };

  return {
    async measure(phase, work) {
      const startedAt = now();
      try {
        const result = await work();
        emit(phase, startedAt, 'ok');
        return result;
      } catch (error) {
        emit(phase, startedAt, 'error');
        throw error;
      }
    },
    async run(work) {
      try {
        const result = await work();
        emit('acknowledgement', acknowledgementStartedAt, 'ok');
        return result;
      } catch (error) {
        emit('acknowledgement', acknowledgementStartedAt, 'error');
        throw error;
      }
    },
  };
}
