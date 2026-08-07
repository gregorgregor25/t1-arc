package app.daymark.wear.data

import org.junit.Assert.assertEquals
import org.junit.Test

class GlucoseSemanticsTest {
    private val now = 1_000_000L
    private val snapshot =
        GlucoseSnapshot(
            mmolL = 6.8,
            trend = "flat",
            timestampMs = now,
            sourceLabel = "Daymark",
            sourceHasError = false,
            category = "target",
        )

    @Test
    fun freshnessTransitionsAtDeterministicBoundaries() {
        assertEquals(GlucoseFreshness.CURRENT, GlucoseSemantics.freshness(snapshot, now + CURRENT_AFTER_MS))
        assertEquals(GlucoseFreshness.DELAYED, GlucoseSemantics.freshness(snapshot, now + CURRENT_AFTER_MS + 1))
        assertEquals(GlucoseFreshness.DELAYED, GlucoseSemantics.freshness(snapshot, now + STALE_AFTER_MS))
        assertEquals(GlucoseFreshness.STALE, GlucoseSemantics.freshness(snapshot, now + STALE_AFTER_MS + 1))
    }

    @Test
    fun sourceErrorNeverLooksCurrent() {
        assertEquals(
            GlucoseFreshness.DELAYED,
            GlucoseSemantics.freshness(snapshot.copy(sourceHasError = true), now),
        )
    }

    @Test
    fun calculatedTrendNeverHidesFreshness() {
        val calculated = snapshot.copy(trendOrigin = "calculated")
        assertEquals(
            "CURRENT · CALC",
            GlucoseSemantics.statusTitle(
                calculated,
                GlucoseFreshness.CURRENT,
            ),
        )
        assertEquals(
            "LAST KNOWN · CALC",
            GlucoseSemantics.statusTitle(
                calculated,
                GlucoseFreshness.STALE,
            ),
        )
        assertEquals(
            "MISSING",
            GlucoseSemantics.statusTitle(
                null,
                GlucoseFreshness.MISSING,
            ),
        )
    }

    @Test
    fun staleValuesAreStruckThroughWhileCurrentAndDelayedValuesRemainReadable() {
        assertEquals(
            "6̶.̶8̶",
            GlucoseSemantics.displayedValue("6.8", GlucoseFreshness.STALE),
        )
        assertEquals(
            "6.8",
            GlucoseSemantics.displayedValue("6.8", GlucoseFreshness.CURRENT),
        )
        assertEquals(
            "6.8",
            GlucoseSemantics.displayedValue("6.8", GlucoseFreshness.DELAYED),
        )
    }

    @Test
    fun staleAlwaysUsesTheConfiguredStaleColour() {
        assertEquals(7f, GlucoseSemantics.colorIndex(snapshot, GlucoseFreshness.STALE))
        assertEquals(7f, GlucoseSemantics.colorIndex(snapshot, GlucoseFreshness.DELAYED))
        assertEquals(3f, GlucoseSemantics.colorIndex(snapshot, GlucoseFreshness.CURRENT))
    }

    @Test
    fun trendsMapToSingleGlanceableGlyphs() {
        assertEquals("⇊", GlucoseSemantics.arrow("doubleDown"))
        assertEquals("→", GlucoseSemantics.arrow("flat"))
        assertEquals("⇈", GlucoseSemantics.arrow("doubleUp"))
    }

    @Test
    fun futureClockSkewDoesNotInventNegativeAge() {
        val future = snapshot.copy(timestampMs = now + 90_000L)
        assertEquals(GlucoseFreshness.CURRENT, GlucoseSemantics.freshness(future, now))
        assertEquals("just now", GlucoseSemantics.ageLabel(future, now))
    }

    @Test
    fun everyPhonePaletteTokenHasAStableFaceValue() {
        assertEquals(
            listOf(0f, 1f, 2f, 3f, 4f, 5f, 6f, 7f),
            listOf("rose", "amber", "orange", "cyan", "green", "blue", "purple", "slate").map {
                GlucoseSemantics.colorIndex(
                    snapshot.copy(colorToken = it),
                    GlucoseFreshness.CURRENT,
                )
            },
        )
    }

    @Test
    fun unknownColourFailsClosedToStaleTone() {
        assertEquals(
            7f,
            GlucoseSemantics.colorIndex(
                snapshot.copy(colorToken = "unexpected"),
                GlucoseFreshness.CURRENT,
            ),
        )
    }
}
