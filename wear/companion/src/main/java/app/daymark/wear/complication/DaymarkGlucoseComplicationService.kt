package app.daymark.wear.complication

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
import app.daymark.wear.GraphActivity
import app.daymark.wear.data.CURRENT_AFTER_MS
import app.daymark.wear.data.DaymarkWearRepository
import app.daymark.wear.data.GlucoseFreshness
import app.daymark.wear.data.GlucoseSemantics
import app.daymark.wear.data.GlucoseSnapshot
import app.daymark.wear.data.STALE_AFTER_MS
import java.time.Instant
import java.util.Locale

open class DaymarkGlucoseComplicationService :
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

        val snapshot = DaymarkWearRepository.get(this).snapshot()
            ?: return ComplicationDataTimeline(
                defaultComplicationData = dataFor(request.complicationType, null, GlucoseFreshness.MISSING),
                timelineEntries = emptyList(),
            )
        val start = Instant.ofEpochMilli(0L)
        val currentEnd = Instant.ofEpochMilli(snapshot.timestampMs + CURRENT_AFTER_MS)
        val staleAt = Instant.ofEpochMilli(snapshot.timestampMs + STALE_AFTER_MS)
        val entries = mutableListOf<TimelineEntry>()
        if (!snapshot.sourceHasError) {
            entries +=
                TimelineEntry(
                    validity = TimeInterval(start, currentEnd),
                    complicationData =
                        dataFor(request.complicationType, snapshot, GlucoseFreshness.CURRENT),
                )
        }
        entries +=
            TimelineEntry(
                validity =
                    TimeInterval(
                        if (snapshot.sourceHasError) start else currentEnd,
                        staleAt,
                    ),
                complicationData =
                    dataFor(request.complicationType, snapshot, GlucoseFreshness.DELAYED),
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
                    "${String.format(Locale.UK, "%.1f", it.mmolL)} millimoles per litre, " +
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
            val value = String.format(Locale.UK, "%.1f", it.mmolL)
            "${GlucoseSemantics.displayedValue(value, freshness)}${GlucoseSemantics.arrow(it.trend)}"
        } ?: "--"

    protected open fun displayTitle(
        snapshot: GlucoseSnapshot?,
        freshness: GlucoseFreshness,
    ): String = GlucoseSemantics.statusTitle(snapshot, freshness)
}

class T1ArcOpticalGlucoseComplicationService :
    DaymarkGlucoseComplicationService() {
    override fun displayText(
        snapshot: GlucoseSnapshot?,
        freshness: GlucoseFreshness,
    ): String =
        snapshot?.let {
            GlucoseSemantics.displayedValue(
                String.format(Locale.UK, "%.1f", it.mmolL),
                freshness,
            )
        } ?: "--"

    override fun displayTitle(
        snapshot: GlucoseSnapshot?,
        freshness: GlucoseFreshness,
    ): String = snapshot?.let { GlucoseSemantics.arrow(it.trend) } ?: ""
}
