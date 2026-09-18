package io.github.gregorgregor25.t1arc.glucosedisplay

import org.junit.Assert.*
import org.junit.Test

class GlucoseWidgetTest {
  private val end = 20_000_000L
  private fun point(minutesAgo: Int, value: Double = 6.9) = GlucoseHistoryPoint(value, end - minutesAgo * 60_000L)

  @Test fun `age and freshness agree at future and stale boundaries`() {
    val locale = java.util.Locale.UK
    assertEquals("2 min ago", GlucoseWidgetCard.age(end - 120_000, end, locale))
    assertEquals("2 days ago", GlucoseWidgetCard.age(end - 2 * 86_400_000, end, locale))
    assertEquals("3 min ahead", GlucoseWidgetCard.age(end + 121_000, end, locale))
    assertEquals(DisplayFreshness.STALE, DisplayFreshnessPolicy.resolve(end + 121_000, end, false))
    assertEquals(DisplayFreshness.CURRENT, DisplayFreshnessPolicy.resolve(end + 120_000, end, false))
  }

  @Test fun `minute history retains the full Today window`() {
    val trace = glucoseWidgetTrace((0..240).map { point(it) }, end)!!
    assertEquals(241, trace.runs.flatten().size)
    assertEquals("4h history", GlucoseWidgetCard.period(trace, false))
    assertEquals("3h 55m history", GlucoseWidgetCard.period(glucoseWidgetTrace(listOf(point(235),point(0)),end)!!,false))
    assertEquals("1h to last reading", GlucoseWidgetCard.period(glucoseWidgetTrace(listOf(point(65),point(0)),end)!!,true))
  }

  @Test fun `trace breaks across missing and conflicting observations`() {
    val trace = glucoseWidgetTrace(listOf(point(30), point(25), point(5), point(5, 7.1), point(0)), end)!!
    assertEquals(listOf(2, 1, 2), trace.runs.map { it.size })
    assertEquals(30 * 60_000L, trace.durationMs)
  }

  @Test fun `trace filters future invalid and out of window observations and duplicate imports`() {
    val trace = glucoseWidgetTrace(listOf(point(-1), point(241), point(7, Double.NaN), point(5), point(5), point(0)), end)!!
    assertEquals(2, trace.runs.flatten().size)
    assertEquals(5 * 60_000L, trace.durationMs)
    assertEquals(0.01f, trace.runs.first().first().x, 0.001f)
    assertEquals(0.99f, trace.runs.last().last().x, 0.001f)
  }

  @Test fun `missing and simultaneous readings do not invent a history trace`() {
    assertNull(glucoseWidgetTrace(emptyList(), end))
    assertEquals("1 reading", GlucoseWidgetCard.period(glucoseWidgetTrace(listOf(point(0)), end)!!, false))
    assertEquals(listOf(1, 1), glucoseWidgetTrace(listOf(point(0), point(0, 8.0)), end)!!.runs.map { it.size })
  }

  @Test fun `extreme and flat traces remain inside the bitmap`() {
    listOf(listOf(point(5, 0.5), point(0, 40.0)), listOf(point(5), point(0))).forEach {
      val points = glucoseWidgetTrace(it, end)!!.runs.flatten()
      assertTrue(points.all { p -> p.x in 0f..1f && p.y in 0f..1f })
    }
  }
}
