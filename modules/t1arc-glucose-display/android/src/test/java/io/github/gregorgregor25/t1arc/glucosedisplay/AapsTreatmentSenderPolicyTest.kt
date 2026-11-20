package io.github.gregorgregor25.t1arc.glucosedisplay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AapsTreatmentSenderPolicyTest {
  private val aaps = listOf("info.nightscout.androidaps")

  @Test fun nothingIsAcceptedWhileTheSwitchIsOff() {
    assertEquals(AapsTreatmentSenderDecision.REJECT, AapsTreatmentSenderPolicy.decide(null, false))
    assertEquals(AapsTreatmentSenderDecision.REJECT, AapsTreatmentSenderPolicy.decide(aaps, false))
    assertEquals(AapsTreatmentSenderDecision.REJECT, AapsTreatmentSenderPolicy.decide(listOf("com.example.other"), false))
  }

  @Test fun anUnidentifiedSenderIsAcceptedOnlyAsUnverifiedWithTheSwitchOn() {
    assertEquals(AapsTreatmentSenderDecision.ACCEPT_UNVERIFIED, AapsTreatmentSenderPolicy.decide(null, true))
  }

  @Test fun aNamedSenderThatIsAapsIsVerified() {
    assertEquals(AapsTreatmentSenderDecision.ACCEPT_VERIFIED, AapsTreatmentSenderPolicy.decide(aaps, true))
    // A shared UID can name several packages; one of them being AAPS is enough.
    assertEquals(
      AapsTreatmentSenderDecision.ACCEPT_VERIFIED,
      AapsTreatmentSenderPolicy.decide(listOf("com.example.shared", "info.nightscout.androidaps"), true),
    )
  }

  @Test fun aNamedSenderThatIsNotAapsIsRejectedEvenWithTheSwitchOn() {
    assertEquals(AapsTreatmentSenderDecision.REJECT, AapsTreatmentSenderPolicy.decide(listOf("com.example.other"), true))
    assertEquals(AapsTreatmentSenderDecision.REJECT, AapsTreatmentSenderPolicy.decide(listOf("info.nightscout.androidaps.fake"), true))
    assertEquals(AapsTreatmentSenderDecision.REJECT, AapsTreatmentSenderPolicy.decide(listOf("io.github.gregorgregor25.t1arc"), true))
    // A UID whose packages cannot be found is a named sender that is not AAPS.
    assertEquals(AapsTreatmentSenderDecision.REJECT, AapsTreatmentSenderPolicy.decide(emptyList(), true))
  }

  @Test fun senderIdentityNeedsAndroid14AndAValidUid() {
    assertFalse(AapsTreatmentSenderPolicy.senderIdentityAvailable(33, 10_123))
    assertFalse(AapsTreatmentSenderPolicy.senderIdentityAvailable(34, -1))
    assertTrue(AapsTreatmentSenderPolicy.senderIdentityAvailable(34, 10_123))
    assertTrue(AapsTreatmentSenderPolicy.senderIdentityAvailable(36, 0))
  }

  @Test fun queuedRowsRecordWhetherTheSenderWasVerified() {
    val received = 1_700_000_000_000L
    val rows = listOf(mapOf<String, Any?>("eventType" to "Meal Bolus", "date" to received - 60_000L, "insulin" to 1.0))
    var next = 0
    val unverified = AapsTreatmentPolicy.sanitize(rows, received, 1L, 2L) { "id-${next++}" }
    val verified = AapsTreatmentPolicy.sanitize(rows, received, 1L, 2L, senderVerified = true) { "id-${next++}" }
    assertFalse(unverified.single().senderVerified)
    assertTrue(verified.single().senderVerified)
    assertEquals(true, verified.single().asMap()["senderVerified"])
    assertEquals(false, unverified.single().asMap()["senderVerified"])
  }
}
