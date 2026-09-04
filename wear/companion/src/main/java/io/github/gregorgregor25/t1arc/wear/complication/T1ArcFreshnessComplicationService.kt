package io.github.gregorgregor25.t1arc.wear.complication

import android.app.PendingIntent
import android.content.Intent
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.NoDataComplicationData
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationDataTimeline
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingTimelineComplicationDataSourceService
import androidx.wear.watchface.complications.datasource.TimeInterval
import androidx.wear.watchface.complications.datasource.TimelineEntry
import io.github.gregorgregor25.t1arc.wear.GraphActivity
import io.github.gregorgregor25.t1arc.wear.data.T1ArcWearRepository
import io.github.gregorgregor25.t1arc.wear.data.GlucoseFreshness
import io.github.gregorgregor25.t1arc.wear.data.GlucoseSemantics
import io.github.gregorgregor25.t1arc.wear.data.GlucoseSnapshot
import java.time.Instant
import kotlin.math.max

class T1ArcFreshnessComplicationService :
    SuspendingTimelineComplicationDataSourceService() {
    override suspend fun onComplicationRequest(
        request: ComplicationRequest,
    ): ComplicationDataTimeline {
        if (request.complicationType != ComplicationType.SHORT_TEXT) {
            return ComplicationDataTimeline(
                defaultComplicationData = NoDataComplicationData(),
                timelineEntries = emptyList(),
            )
        }

        val snapshot = T1ArcWearRepository.get(this).snapshot()
            ?: return ComplicationDataTimeline(
                defaultComplicationData = dataFor(null, 0),
                timelineEntries = emptyList(),
            )
        val entries =
            (0..12).map { minute ->
                val startMs =
                    if (minute == 0) {
                        0L
                    } else {
                        snapshot.timestampMs + minute * 60_000L
                    }
                TimelineEntry(
                    validity =
                        TimeInterval(
                            Instant.ofEpochMilli(startMs),
                            Instant.ofEpochMilli(snapshot.timestampMs + (minute + 1) * 60_000L),
                        ),
                    complicationData = dataFor(snapshot, minute),
                )
            }
        val currentMinute =
            max(0L, (System.currentTimeMillis() - snapshot.timestampMs) / 60_000L).toInt()
        return ComplicationDataTimeline(
            defaultComplicationData = dataFor(snapshot, currentMinute),
            timelineEntries = entries,
        )
    }

    override fun getPreviewData(type: ComplicationType): ComplicationData? =
        if (type == ComplicationType.SHORT_TEXT) {
            dataFor(
                GlucoseSnapshot(
                    mmolL = 6.4,
                    trend = "flat",
                    timestampMs = System.currentTimeMillis() - 2 * 60_000L,
                    sourceLabel = "T1 Arc preview",
                    sourceHasError = false,
                    category = "target",
                    colorToken = "cyan",
                ),
                2,
            )
        } else {
            null
        }

    private fun dataFor(
        snapshot: GlucoseSnapshot?,
        ageMinutes: Int,
    ): ComplicationData {
        val freshness =
            snapshot?.let {
                GlucoseSemantics.freshness(
                    it,
                    it.timestampMs + ageMinutes * 60_000L,
                )
            } ?: GlucoseFreshness.MISSING
        val status = GlucoseSemantics.statusTitle(snapshot, freshness)
        val label =
            if (snapshot == null) {
                status
            } else {
                "$status • ${GlucoseSemantics.formattedInteger(ageMinutes.toLong(), snapshot)} MIN"
            }
        val text = PlainComplicationText.Builder(label).build()
        return ShortTextComplicationData
            .Builder(
                text = text,
                contentDescription = text,
            )
            .setTapAction(
                PendingIntent.getActivity(
                    this,
                    42,
                    Intent(this, GraphActivity::class.java),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ),
            )
            .build()
    }
}
