export interface HevySet {
  index: number;
  type: string;
  weight_kg: number | null;
  reps: number | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  rpe: number | null;
  custom_metric: number | null;
}

export interface HevyExercise {
  index: number;
  title: string;
  notes: string;
  exercise_template_id: string;
  supersets_id: number | null;
  sets: HevySet[];
}

export interface HevyWorkout {
  id: string;
  title: string;
  routine_id?: string;
  description: string;
  start_time: string;
  end_time: string;
  updated_at: string;
  created_at: string;
  exercises: HevyExercise[];
}

export interface HevyUser {
  id: string;
  name: string;
  url?: string;
}

export type HevyWorkoutEvent =
  | { type: "updated"; workout: HevyWorkout }
  | { type: "deleted"; id: string; deleted_at?: string };

export interface HevyConnection {
  apiKey: string;
  user: HevyUser;
  connectedAt: number;
  /** SQLite-owned action revision; absent only on a pre-revision legacy key. */
  ownershipRevision?: number;
  /** Immutable SecureStore slot allocated by SQLite for this credential. */
  credentialRevision?: number;
}

export interface HevySourceStatus {
  connected: boolean;
  workoutCount: number;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  lastError?: string;
}

export interface HevySyncResult {
  mode: "initial" | "incremental";
  imported: number;
  updated: number;
  deleted: number;
  duplicatesLinked: number;
  total: number;
  syncedAt: number;
}
