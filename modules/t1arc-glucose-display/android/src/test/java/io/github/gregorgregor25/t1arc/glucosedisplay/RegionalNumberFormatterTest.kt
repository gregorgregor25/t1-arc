package io.github.gregorgregor25.t1arc.glucosedisplay

import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Test

class RegionalNumberFormatterTest {
  @Test
  fun `Arabic display uses Arabic-Indic digits`() {
    assertEquals(
      "١٨",
      RegionalNumberFormatter.integer(18L, Locale.forLanguageTag("ar-EG")),
    )
  }

  @Test
  fun `British and Japanese displays retain their locale digits`() {
    assertEquals("18", RegionalNumberFormatter.integer(18L, Locale.UK))
    assertEquals(
      "18",
      RegionalNumberFormatter.integer(18L, Locale.forLanguageTag("ja-JP")),
    )
  }
}
