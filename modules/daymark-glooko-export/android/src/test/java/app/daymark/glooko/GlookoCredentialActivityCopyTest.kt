package app.daymark.glooko

import org.junit.Assert.assertTrue
import org.junit.Test

class GlookoCredentialActivityCopyTest {
  @Test
  fun legacyContinuityAttestsPersonAndUkTimestampContract() {
    val copy = glookoCredentialConfirmationCopy(true)

    assertTrue(copy.contains("same person"))
    assertTrue(copy.contains("existing Glooko data"))
    assertTrue(copy.contains("UK local time"))
    assertTrue(copy.contains("day/month/year"))
  }
}
