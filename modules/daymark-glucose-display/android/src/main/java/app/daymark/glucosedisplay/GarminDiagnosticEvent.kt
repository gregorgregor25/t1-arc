package app.daymark.glucosedisplay

/** Deliberately no free-text fields: callers cannot accidentally journal payloads or identifiers. */
internal enum class GarminDiagnosticKind {
  SDK_START, SDK_READY, SDK_ERROR, SDK_SHUTDOWN, CONNECT_MISSING,
  SYNC_ENABLED, SYNC_DISABLED, RETRY, WATCH_CONNECTED, WATCH_DISCONNECTED,
  APP_FOUND, APP_MISSING, UPDATE_QUEUED, SEND_ATTEMPT, SEND_ACCEPTED, SEND_FAILED,
  ACK_FOREGROUND, ACK_BACKGROUND, ACK_TIMEOUT, STORAGE_ERROR, CONNECTION_ERROR, REPORT_CREATED
}

internal data class GarminDiagnosticEvent(
  val at: Long,
  val kind: GarminDiagnosticKind,
  val revision: Long = 0,
  val attempt: Int = 0,
)

internal object GarminDiagnosticRetention {
  const val MAX_EVENTS = 2000
  const val MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000

  fun prune(events: List<GarminDiagnosticEvent>, now: Long): List<GarminDiagnosticEvent> =
    events.filter { it.at >= now - MAX_AGE_MS && it.at <= now }.takeLast(MAX_EVENTS)
}
