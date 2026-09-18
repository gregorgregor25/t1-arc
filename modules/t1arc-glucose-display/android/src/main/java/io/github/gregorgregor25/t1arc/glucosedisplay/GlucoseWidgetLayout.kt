package io.github.gregorgregor25.t1arc.glucosedisplay

import kotlin.math.max
import kotlin.math.min

internal data class WidgetTracePoint(val x: Float, val y: Float, val value: Double)
internal data class WidgetTrace(val runs: List<List<WidgetTracePoint>>, val durationMs: Long)

internal fun glucoseWidgetHistory(history: List<GlucoseHistoryPoint>, endMs: Long) = history
  .filter { it.mmolL.isFinite() && it.mmolL in 0.5..40.0 && it.timestampMs in (endMs - 4 * 3_600_000L)..endMs }
  .distinctBy { it.timestampMs to it.mmolL }
  .sortedBy { it.timestampMs }
  .takeLast(480)

/** Match Today's four-hour trace: observed duration, no line across a >12m gap. */
internal fun glucoseWidgetTrace(history: List<GlucoseHistoryPoint>, endMs: Long): WidgetTrace? {
  val points = glucoseWidgetHistory(history, endMs)
  if (points.isEmpty()) return null
  val duration = points.last().timestampMs - points.first().timestampMs
  val lowest = points.minOf { it.mmolL }
  val highest = points.maxOf { it.mmolL }
  val padding = max((highest - lowest) * 0.2, 0.6)
  val minValue = max(0.0, lowest - padding)
  val maxValue = highest + padding
  val range = max(maxValue - minValue, 1.0)
  val runs = mutableListOf<MutableList<WidgetTracePoint>>()
  points.forEachIndexed { index, point ->
    val gap = if (index == 0) 0 else point.timestampMs - points[index - 1].timestampMs
    if (index == 0 || gap <= 0 || gap > 12 * 60_000L) runs.add(mutableListOf())
    runs.last().add(WidgetTracePoint(
      if (duration > 0) 0.01f + (point.timestampMs - points.first().timestampMs).toFloat() / duration * 0.98f else 0.99f,
      (5.0 / 60 + (maxValue - point.mmolL) / range * (47.0 / 60)).toFloat(),
      point.mmolL,
    ))
  }
  return WidgetTrace(runs, duration)
}
