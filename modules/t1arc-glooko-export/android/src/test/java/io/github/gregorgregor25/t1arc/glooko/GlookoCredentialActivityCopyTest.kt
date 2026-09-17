package io.github.gregorgregor25.t1arc.glooko

import org.junit.Assert.assertTrue
import org.junit.Test

class GlookoCredentialActivityCopyTest {
  @Test
  fun existingDataBindingAttestsPersonAndSelectedTimestampContract() {
    val copy = glookoCredentialConfirmationCopy(true)

    assertTrue(copy.contains("same person"))
    assertTrue(copy.contains("existing Glooko data"))
    assertTrue(copy.contains("Europe/London local time"))
    assertTrue(copy.contains("day/month/year"))
  }

  @Test
  fun usCopyUsesSelectedZoneAndDateOrder() {
    val copy =
      glookoCredentialConfirmationCopy(
        existingDataBindingRequired = false,
        timeZone = "America/New_York",
        dateOrder = "month/day/year",
      )

    assertTrue(copy.contains("America/New_York local time"))
    assertTrue(copy.contains("month/day/year"))
  }

  @Test
  fun accountTimeZoneCopyExplainsTravelDoesNotReinterpretImports() {
    val copy = glookoCredentialTimeZoneCopy("America/New_York")

    assertTrue(copy.contains("stay bound to America/New_York"))
    assertTrue(copy.contains("Travel"))
    assertTrue(copy.contains("display timezone"))
    assertTrue(copy.contains("not reinterpret"))
  }
}
