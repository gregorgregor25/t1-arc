package io.github.gregorgregor25.t1arc.glucosedisplay

import org.junit.Assert.*
import org.junit.Test

class GlucoseWidgetTest {
  private val end = 20_000_000L
  private fun point(minutesAgo: Int, value: Double = 6.9) = GlucoseHistoryPoint(value, end - minutesAgo * 60_000L)

  @Test fun `small widgets retain reading while tall widgets expose chart`() {
    val tiny = GlucoseWidgetLayout.forSize(150f, 80f, 1f)
    assertFalse(tiny.details)
    assertFalse(tiny.chart)
    assertFalse(GlucoseWidgetLayout.forSize(220f, 190f, 1f).source)
    assertTrue(GlucoseWidgetLayout.forSize(250f, 200f, 1f).source)
    assertFalse(GlucoseWidgetLayout.forSize(250f, 200f, 1f).chart)
    assertTrue(GlucoseWidgetLayout.forSize(250f, 320f, 1f).chart)
    assertFalse(GlucoseWidgetLayout.forSize(150f, 400f, 1f).source)
  }

  @Test fun `large text reserves space before showing history`() {
    assertFalse(GlucoseWidgetLayout.forSize(250f, 300f, 1.5f).chart)
    assertTrue(GlucoseWidgetLayout.forSize(250f, 400f, 1.5f).chart)
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
    assertNull(glucoseWidgetTrace(listOf(point(0)), end))
    assertNull(glucoseWidgetTrace(listOf(point(0), point(0, 8.0)), end))
  }

  @Test fun `extreme and flat traces remain inside the bitmap`() {
    listOf(listOf(point(5, 0.5), point(0, 40.0)), listOf(point(5), point(0))).forEach {
      val points = glucoseWidgetTrace(it, end)!!.runs.flatten()
      assertTrue(points.all { p -> p.x in 0f..1f && p.y in 0f..1f })
    }
  }
}
