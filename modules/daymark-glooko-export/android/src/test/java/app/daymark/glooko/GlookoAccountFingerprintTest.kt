package app.daymark.glooko

import javax.crypto.spec.SecretKeySpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GlookoAccountFingerprintTest {
  private val installationKeyA =
    SecretKeySpec(ByteArray(32) { index -> (index + 1).toByte() }, "HmacSHA256")
  private val installationKeyB =
    SecretKeySpec(ByteArray(32) { index -> (index + 2).toByte() }, "HmacSHA256")

  @Test
  fun fingerprintIsStableForSameAccountAndInstallation() {
    val first =
      GlookoAccountFingerprint.encode(
        installationKeyA,
        "eu-west-1-private-account-1234",
      )
    val second =
      GlookoAccountFingerprint.encode(
        installationKeyA,
        "eu-west-1-private-account-1234",
      )

    assertEquals(first, second)
    assertTrue(first.matches(Regex("^af1_[0-9a-f]{64}$")))
    assertFalse(first.contains("private-account"))
  }

  @Test
  fun fingerprintChangesForDifferentAccount() {
    val first =
      GlookoAccountFingerprint.encode(installationKeyA, "eu-account-one")
    val second =
      GlookoAccountFingerprint.encode(installationKeyA, "eu-account-two")

    assertNotEquals(first, second)
  }

  @Test
  fun fingerprintCannotBeCorrelatedAcrossInstallations() {
    val first =
      GlookoAccountFingerprint.encode(installationKeyA, "eu-account-one")
    val second =
      GlookoAccountFingerprint.encode(installationKeyB, "eu-account-one")

    assertNotEquals(first, second)
  }
}
