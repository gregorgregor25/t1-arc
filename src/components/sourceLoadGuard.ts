export interface SourceLoadGuard {
  mounted: boolean;
  generation: number;
}

export function mountSourceLoadGuard(guard: SourceLoadGuard) {
  guard.mounted = true;
}

export function unmountSourceLoadGuard(guard: SourceLoadGuard) {
  guard.mounted = false;
  guard.generation += 1;
}

export function beginSourceLoad(guard: SourceLoadGuard) {
  guard.generation += 1;
  return guard.generation;
}

export function canCommitSourceLoad(
  guard: SourceLoadGuard,
  generation: number,
) {
  return guard.mounted && guard.generation === generation;
}
