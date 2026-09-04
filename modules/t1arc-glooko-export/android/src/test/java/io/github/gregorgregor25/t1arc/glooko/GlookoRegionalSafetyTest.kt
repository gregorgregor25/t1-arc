package io.github.gregorgregor25.t1arc.glooko

import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GlookoRegionalSafetyTest {
  @Test
  fun automaticImportHasAnExplicitRouteForBothConsumerRegions() {
    assertTrue(GlookoRegionalCapability.supportsAutomaticImport(GlookoRegion.EU))
    assertTrue(GlookoRegionalCapability.supportsAutomaticImport(GlookoRegion.US))
  }

  @Test
  fun credentialWithoutAnAccountTimeZoneFailsClosed() {
    assertFalse(
      glookoCredentialContractConfigured(
        hasStoredCredentials = true,
        regionalFormatConfirmed = true,
        timeZone = null,
      ),
    )
    assertFalse(
      glookoCredentialContractConfigured(
        hasStoredCredentials = true,
        regionalFormatConfirmed = true,
        timeZone = "not/a-zone",
      ),
    )
  }

  @Test
  fun confirmedIanaAccountTimeZoneCompletesCredentialContract() {
    assertTrue(
      glookoCredentialContractConfigured(
        hasStoredCredentials = true,
        regionalFormatConfirmed = true,
        timeZone = "America/New_York",
      ),
    )
    assertEquals(
      ZoneId.of("America/New_York"),
      validatedGlookoCredentialTimeZone("America/New_York"),
    )
  }
}
