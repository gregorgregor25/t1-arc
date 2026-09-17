package io.github.gregorgregor25.t1arc.glucosedisplay

import java.time.Instant
import java.util.Locale
import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RegionalTimeFormatterTest {
  private val timestamp = Instant.parse("2026-08-28T13:30:00Z").toEpochMilli()
  private val utc = TimeZone.getTimeZone("UTC")

  @Test
  fun `US display uses the locale short twelve-hour clock`() {
    val label = RegionalTimeFormatter.format(timestamp, Locale.US, utc)

    assertTrue(label.contains("1:30"))
    assertTrue(label.contains("PM", ignoreCase = true))
    assertFalse(label.contains("13:30"))
  }

  @Test
  fun `British display uses the locale short twenty-four-hour clock`() {
    assertEquals(
      "13:30",
      RegionalTimeFormatter.format(timestamp, Locale.UK, utc),
    )
  }
}
