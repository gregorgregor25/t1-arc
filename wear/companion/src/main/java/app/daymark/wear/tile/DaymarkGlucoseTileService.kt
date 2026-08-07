package app.daymark.wear.tile

import android.content.ComponentName
import androidx.wear.protolayout.ActionBuilders.launchAction
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.TimelineBuilders.Timeline
import androidx.wear.protolayout.layout.column
import androidx.wear.protolayout.material3.MaterialScope
import androidx.wear.protolayout.material3.Typography
import androidx.wear.protolayout.material3.primaryLayout
import androidx.wear.protolayout.material3.text
import androidx.wear.protolayout.modifiers.clickable
import androidx.wear.protolayout.types.LayoutColor
import androidx.wear.protolayout.types.argb
import androidx.wear.protolayout.types.layoutString
import androidx.wear.tiles.Material3TileService
import androidx.wear.tiles.RequestBuilders.TileRequest
import androidx.wear.tiles.TileBuilders.Tile
import androidx.wear.tiles.tile
import app.daymark.wear.GraphActivity
import app.daymark.wear.data.DaymarkWearRepository
import app.daymark.wear.data.GlucoseFreshness
import app.daymark.wear.data.GlucoseSemantics
import app.daymark.wear.data.GlucoseSnapshot
import java.util.Locale
import kotlin.time.Duration.Companion.minutes

class DaymarkGlucoseTileService : Material3TileService() {
    override suspend fun MaterialScope.tileResponse(requestParams: TileRequest): Tile {
        val snapshot = DaymarkWearRepository.get(this@DaymarkGlucoseTileService).snapshot()
        val freshness = GlucoseSemantics.freshness(snapshot)
        val value =
            snapshot?.let {
                val number = String.format(Locale.UK, "%.1f", it.mmolL)
                "${GlucoseSemantics.displayedValue(number, freshness)} ${GlucoseSemantics.arrow(it.trend)}"
            } ?: "--"
        val detail =
            if (snapshot == null) {
                "NO DATA"
            } else {
                val age =
                    GlucoseSemantics
                        .ageLabel(snapshot)
                        .removeSuffix(" ago")
                        .replace("just now", "now")
                        .uppercase(Locale.UK)
                "${freshness.label.uppercase(Locale.UK)} $age" +
                    if (GlucoseSemantics.trendIsCalculated(snapshot)) {
                        " · CALC"
                    } else {
                        ""
                    }
            }
        val layout =
            primaryLayout(
                titleSlot = {
                    text(
                        (if (freshness == GlucoseFreshness.STALE) "LAST KNOWN" else "GLUCOSE").layoutString,
                        typography = Typography.LABEL_LARGE,
                        color = colorScheme.primary,
                        scalable = false,
                    )
                },
                mainSlot = {
                    column(
                        text(
                            value.layoutString,
                            typography = Typography.DISPLAY_LARGE,
                            color = valueColor(snapshot, freshness),
                            scalable = false,
                            maxLines = 1,
                            incrementsForTypographySize = listOf(-4f, -8f),
                        ),
                        text(
                            "mmol/L".layoutString,
                            typography = Typography.LABEL_MEDIUM,
                            color = colorScheme.onSurfaceVariant,
                            scalable = false,
                        ),
                        width = expand(),
                        height = expand(),
                    )
                },
                bottomSlot = {
                    text(
                        detail.layoutString,
                        typography = Typography.LABEL_MEDIUM,
                        color = colorScheme.onSurface,
                        scalable = false,
                        maxLines = 1,
                    )
                },
                onClick =
                    clickable(
                        action =
                            launchAction(
                                ComponentName(
                                    this@DaymarkGlucoseTileService,
                                    GraphActivity::class.java,
                                ),
                            ),
                        id = "open-daymark",
                    ),
            )
        return tile(
            timeline = Timeline.fromLayoutElement(layout),
            freshness = 1.minutes,
        )
    }

    private fun valueColor(
        snapshot: GlucoseSnapshot?,
        freshness: GlucoseFreshness,
    ): LayoutColor = GlucoseSemantics.colorArgb(snapshot, freshness).argb
}
