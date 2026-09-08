package io.github.gregorgregor25.t1arc.wear.complication

import android.app.PendingIntent
import android.content.Intent
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.NoDataComplicationData
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.RangedValueComplicationData
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationDataTimeline
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingTimelineComplicationDataSourceService
import androidx.wear.watchface.complications.datasource.TimeInterval
import androidx.wear.watchface.complications.datasource.TimelineEntry
import io.github.gregorgregor25.t1arc.wear.GraphActivity
import io.github.gregorgregor25.t1arc.wear.data.CURRENT_AFTER_MS
import io.github.gregorgregor25.t1arc.wear.data.T1ArcWearRepository
import io.github.gregorgregor25.t1arc.wear.data.GlucoseFreshness
import io.github.gregorgregor25.t1arc.wear.data.GlucoseSemantics
import io.github.gregorgregor25.t1arc.wear.data.GlucoseSnapshot
import io.github.gregorgregor25.t1arc.wear.data.STALE_AFTER_MS
import java.time.Instant
import java.util.Locale

open class T1ArcGlucoseComplicationService :
    SuspendingTimelineComplicationDataSourceService() {

    override suspend fun onComplicationRequest(
        request: ComplicationRequest,
    ): ComplicationDataTimeline {
        if (
            request.complicationType != ComplicationType.RANGED_VALUE &&
                request.complicationType != ComplicationType.SHORT_TEXT
        ) {
            return ComplicationDataTimeline(
                defaultComplicationData = NoDataComplicationData(),
                timelineEntries = emptyList(),
            )
        }

        val snapshot = T1ArcWearRepository.get(this).snapshot()
            ?: return ComplicationDataTimeline(
                defaultComplicationData = dataFor(request.complicationType, null, GlucoseFreshness.MISSING),
                timelineEntries = emptyList(),
            )
        val start = Instant.ofEpochMilli(0L)
        val currentEnd = Instant.ofEpochMilli(snapshot.timestampMs + CURRENT_AFTER_MS)
        val staleAt = Instant.ofEpochMilli(snapshot.timestampMs + STALE_AFTER_MS)
        val entries =
            listOf(
                TimelineEntry(
                    validity = TimeInterval(start, currentEnd),
                    complicationData =
                        dataFor(request.complicationType, snapshot, GlucoseFreshness.CURRENT),
                ),
                TimelineEntry(
                    validity = TimeInterval(currentEnd, staleAt),
                    complicationData =
                        dataFor(request.complicationType, snapshot, GlucoseFreshness.DELAYED),
                ),
            )
        return ComplicationDataTimeline(
            defaultComplicationData =
                dataFor(request.complicationType, snapshot, GlucoseFreshness.STALE),
            timelineEntries = entries,
        )
    }

    override fun getPreviewData(type: ComplicationType): ComplicationData? =
        dataFor(
            type,
            GlucoseSnapshot(
                mmolL = 6.8,
                trend = "flat",
                timestampMs = System.currentTimeMillis(),
                sourceLabel = "T1 Arc",
                sourceHasError = false,
                category = "target",
                colorToken = "cyan",
                staleColorToken = "slate",
            ),
            GlucoseFreshness.CURRENT,
        )

    private fun dataFor(
        type: ComplicationType,
        snapshot: GlucoseSnapshot?,
        freshness: GlucoseFreshness,
    ): ComplicationData {
        val text = displayText(snapshot, freshness)
        val title = displayTitle(snapshot, freshness)
        val description =
            snapshot?.let {
                (if (freshness == GlucoseFreshness.STALE) {
                    "Last known stale glucose, "
                } else {
                    "Glucose, "
                }) +
                    "${GlucoseSemantics.formattedValue(it)} ${GlucoseSemantics.spokenUnit(it)}, " +
                    (if (GlucoseSemantics.trendIsCalculated(it)) {
                        "calculated trend, "
                    } else {
                        ""
                    }) +
                    "${freshness.label.lowercase(Locale.UK)}"
            } ?: "Glucose reading missing"
        val textValue = PlainComplicationText.Builder(text).build()
        val titleValue = PlainComplicationText.Builder(title).build()
        val descriptionValue = PlainComplicationText.Builder(description).build()
        val tapAction =
            PendingIntent.getActivity(
                this,
                0,
                Intent(this, GraphActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        return if (type == ComplicationType.RANGED_VALUE) {
            RangedValueComplicationData
                .Builder(
                    value = GlucoseSemantics.colorIndex(snapshot, freshness),
                    min = 0f,
                    max = 7f,
                    contentDescription = descriptionValue,
                )
                .setText(textValue)
                .setTitle(titleValue)
                .setTapAction(tapAction)
                .build()
        } else {
            ShortTextComplicationData
                .Builder(
                    text = textValue,
                    contentDescription = descriptionValue,
                )
                .setTitle(titleValue)
                .setTapAction(tapAction)
                .build()
        }
    }

    protected open fun displayText(
        snapshot: GlucoseSnapshot?,
        freshness: GlucoseFreshness,
    ): String =
        snapshot?.let {
            val value = GlucoseSemantics.formattedValue(it)
            "${GlucoseSemantics.displayedValue(value, freshness)}${GlucoseSemantics.arrow(it.trend)}"
        } ?: "--"

    protected open fun displayTitle(
        snapshot: GlucoseSnapshot?,
        freshness: GlucoseFreshness,
    ): String = GlucoseSemantics.statusTitle(snapshot, freshness)
}

/** New collection: visible units and freshness without changing existing bindings. */
class T1ArcWatchFaceGlucoseComplicationService : T1ArcGlucoseComplicationService() {
    override fun displayTitle(snapshot: GlucoseSnapshot?, freshness: GlucoseFreshness): String =
        GlucoseSemantics.watchFaceStatusTitle(snapshot, freshness)
}

class T1ArcOpticalGlucoseComplicationService :
    T1ArcGlucoseComplicationService() {
    override fun displayText(
        snapshot: GlucoseSnapshot?,
        freshness: GlucoseFreshness,
    ): String =
        snapshot?.let {
            GlucoseSemantics.displayedValue(
                GlucoseSemantics.formattedValue(it),
                freshness,
            )
        } ?: "--"

    override fun displayTitle(
        snapshot: GlucoseSnapshot?,
        freshness: GlucoseFreshness,
    ): String = snapshot?.let { GlucoseSemantics.arrow(it.trend) } ?: ""
}
