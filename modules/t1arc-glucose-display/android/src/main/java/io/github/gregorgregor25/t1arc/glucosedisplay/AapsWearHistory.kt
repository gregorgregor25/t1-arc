package io.github.gregorgregor25.t1arc.glucosedisplay

// Kept apart from T1ArcGlucoseDisplayModule.kt so JVM unit tests can load it
// without that file's Android-only static initialisers (for example Color.rgb).
internal const val WEAR_HISTORY_WINDOW_MS = 6 * 60 * 60_000L

/**
 * Extends the watch history last published from the database by the new
 * reading, over the same six-hour window the JS sync uses. When the sync then
 * publishes that window, the payload is identical and the watch history is
 * not sent a second time. The four-hour widget history is only a fallback
 * while nothing has been published since the process started.
 */
internal fun aapsWearHistory(
  published: List<GlucoseHistoryPoint>,
  widgetHistory: List<GlucoseHistoryPoint>,
  mmolL: Double,
  timestampMs: Long,
): List<GlucoseHistoryPoint> {
  if (published.isEmpty()) return widgetHistory
  val start = timestampMs - WEAR_HISTORY_WINDOW_MS
  return published.filter { it.timestampMs in start until timestampMs } +
    GlucoseHistoryPoint(mmolL, timestampMs)
}
