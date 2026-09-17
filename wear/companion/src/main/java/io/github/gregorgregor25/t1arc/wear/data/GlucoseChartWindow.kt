package io.github.gregorgregor25.t1arc.wear.data

/** One wall-clock window for both the axis and the readings; never stretch partial history. */
data class GlucoseChartWindow(val endMs: Long, val hours: Int = 3) {
    init { require(hours > 0) }
    val startMs: Long = endMs - hours * 60 * 60_000L

    fun fraction(timestampMs: Long): Float =
        ((timestampMs - startMs).toDouble() / (endMs - startMs)).toFloat().coerceIn(0f, 1f)

    fun points(history: List<GlucoseHistoryPoint>): List<GlucoseHistoryPoint> =
        history.filter { it.timestampMs in startMs..endMs && it.mmolL.isFinite() && it.mmolL > 0 }
            .sortedBy(GlucoseHistoryPoint::timestampMs)
            .distinctBy(GlucoseHistoryPoint::timestampMs)

    fun connected(first: GlucoseHistoryPoint, second: GlucoseHistoryPoint): Boolean =
        second.timestampMs - first.timestampMs in 1..12 * 60_000L
}
