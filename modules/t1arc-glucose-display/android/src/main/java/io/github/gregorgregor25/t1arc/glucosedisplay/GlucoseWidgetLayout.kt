package io.github.gregorgregor25.t1arc.glucosedisplay

import kotlin.math.max
import kotlin.math.min

internal data class GlucoseWidgetLayout(
  val padding: Float,
  val valueSize: Float,
  val arrowSize: Float,
  val labelSize: Float,
  val smallSize: Float,
  val details: Boolean,
  val source: Boolean,
  val chart: Boolean,
) {
  companion object {
    fun forSize(width: Float, height: Float, fontScale: Float): GlucoseWidgetLayout {
      val scale = fontScale.coerceAtLeast(1f)
      val compact = height < 160 * min(scale, 1.3f) || width < 220
      val tiny = height < 110 * min(scale, 1.3f)
      val short = height < 240 * min(scale, 1.3f)
      // Fit the largest supported value (721 mg/dL) plus its unit at every
      // size. As with Today's card, cap text growth while honouring font size.
      val textScale = min(scale, 1.3f) / scale
      return GlucoseWidgetLayout(
        padding = if (compact) 10f else if (short) 12f else 18f,
        valueSize = (if (tiny) 28f else if (compact) 38f else if (short) 44f else if (width < 280) 58f else 68f) * textScale,
        arrowSize = (if (tiny) 18f else if (compact) 23f else 30f) * textScale,
        labelSize = (if (compact) 11f else if (short) 14f else 16f) * textScale,
        smallSize = (if (compact) 9f else 11f) * textScale,
        details = !tiny,
        source = !compact && height >= 200 * min(scale, 1.3f),
        chart = !compact && height >= 280 * min(scale, 1.3f),
      )
    }
  }
}

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
  if (points.size < 2) return null
  val duration = points.last().timestampMs - points.first().timestampMs
  if (duration <= 0) return null
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
      0.01f + (point.timestampMs - points.first().timestampMs).toFloat() / duration * 0.98f,
      (0.08 + (maxValue - point.mmolL) / range * 0.78).toFloat(),
      point.mmolL,
    ))
  }
  return WidgetTrace(runs, duration)
}
