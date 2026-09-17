package io.github.gregorgregor25.t1arc.wear.data

import org.junit.Assert.*
import org.junit.Test

class GlucoseChartWindowTest {
    private val now = 1_789_036_200_000L
    private fun point(minutesAgo: Long, value: Double = 6.0) =
        GlucoseHistoryPoint(value, now - minutesAgo * 60_000L)

    @Test fun partialHistoryOccupiesItsActualPartOfTheThreeHourAxis() {
        val window = GlucoseChartWindow(now)
        assertEquals(5f / 6f, window.fraction(point(30).timestampMs), 0.00001f)
        assertEquals(1f, window.fraction(now), 0f)
        assertEquals(0f, window.fraction(point(180).timestampMs), 0f)
    }

    @Test fun delayedReadingDoesNotMoveTheNowLabelBackInTime() {
        val window = GlucoseChartWindow(now)
        assertEquals(2f / 3f, window.fraction(point(60).timestampMs), 0.00001f)
        assertEquals(now, window.endMs)
    }

    @Test fun supportsSixHoursAndRejectsOutOfWindowOrInvalidReadings() {
        val window = GlucoseChartWindow(now, 6)
        val valid = point(240)
        assertEquals(1f / 3f, window.fraction(valid.timestampMs), 0.00001f)
        assertEquals(listOf(valid, point(0)), window.points(listOf(point(-1), point(361), point(40, Double.NaN), point(20, 0.0), point(0), valid, valid)))
    }

    @Test fun gapsAndDuplicateTimesAreNotJoined() {
        val window = GlucoseChartWindow(now)
        assertTrue(window.connected(point(12), point(0)))
        assertFalse(window.connected(point(13), point(0)))
        assertFalse(window.connected(point(0), point(0)))
        assertFalse(window.connected(point(0), point(1)))
    }
}
