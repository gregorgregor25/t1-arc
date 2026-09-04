package io.github.gregorgregor25.t1arc.glooko

import org.junit.Assert.assertEquals
import org.junit.Test

class GlookoReportPlotGeometryTest {
  @Test
  fun mapsTheLetterReportPlotToItsTrueMidBinCoordinates() {
    // Android renders the 612pt report at 2x for extraction.
    assertEquals(144, glookoDailyPlotX(1_224, 2.5))
    assertEquals(661, glookoDailyPlotX(1_224, 12.0 * 60.0 + 2.5))
    assertEquals(1_174, glookoDailyPlotX(1_224, 24.0 * 60.0 - 2.5))
  }

  @Test(expected = IllegalArgumentException::class)
  fun rejectsTimesOutsideTheDailyPlot() {
    glookoDailyPlotX(1_224, -2.5)
  }

  @Test
  fun acceptsDayFirstDailyOverviewDates() {
    assertEquals(
      "22/Jul",
      glookoDailyChartDateLabel("Daily Overview\nWednesday, 22 Jul 2026\nOP5 BASAL"),
    )
  }

  @Test
  fun acceptsMonthFirstDailyOverviewDates() {
    assertEquals(
      "11/Aug",
      glookoDailyChartDateLabel("Daily Overview\nTuesday, Aug 11, 2026\nOP5 BASAL"),
    )
  }
}
