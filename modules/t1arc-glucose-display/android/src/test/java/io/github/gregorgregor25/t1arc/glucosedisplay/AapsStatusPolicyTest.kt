package io.github.gregorgregor25.t1arc.glucosedisplay

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AapsStatusPolicyTest {
  private fun reading() = AapsLocalReading(
    id = "one", receivedAt = 1_700_000_010_000L,
    writeEpoch = 2L, selectionGeneration = 4L,
    glucoseMgdl = 120.0, glucoseTimestamp = 1_700_000_000_000L,
    trend = "flat", iobUnits = -0.2, cobGrams = 0.0,
  )

  @Test fun queuedBroadcastCannotCrossSelectionOrErase() {
    assertTrue(AapsStatusPolicy.acceptsCaptured(2, 4, 2, 4, AAPS_SOURCE_ID))
    assertFalse(AapsStatusPolicy.acceptsCaptured(2, 4, 3, 4, AAPS_SOURCE_ID))
    assertFalse(AapsStatusPolicy.acceptsCaptured(2, 4, 2, 5, AAPS_SOURCE_ID))
    assertFalse(AapsStatusPolicy.acceptsCaptured(2, 4, 2, 4, "none"))
  }

  @Test fun duplicateCheckIncludesAllStatusFields() {
    val original = reading()
    assertTrue(AapsStatusPolicy.samePayload(original, original.copy(id = "two", receivedAt = original.receivedAt + 1)))
    assertFalse(AapsStatusPolicy.samePayload(original, original.copy(id = "two", trend = "up")))
    assertFalse(AapsStatusPolicy.samePayload(original, original.copy(id = "two", bolusIobUnits = 0.4)))
    assertFalse(AapsStatusPolicy.samePayload(original, original.copy(id = "two", futureCarbsGrams = 3.0)))
  }

  @Test fun newerAndCorrectedGlucosePublishesButOlderDoesNot() {
    assertTrue(AapsStatusPolicy.publishGlucose(null, null, null, 1000, 6.0, "flat"))
    assertFalse(AapsStatusPolicy.publishGlucose(1000, 6.0, "flat", 999, 6.5, "up"))
    assertFalse(AapsStatusPolicy.publishGlucose(1000, 6.0, "flat", 1000, 6.0, "flat"))
    assertTrue(AapsStatusPolicy.publishGlucose(1000, 6.0, "flat", 1000, 6.2, "flat"))
    assertTrue(AapsStatusPolicy.publishGlucose(1000, 6.0, "flat", 1000, 6.0, "up"))
    assertTrue(AapsStatusPolicy.publishGlucose(1000, 6.0, "doubleUp", 1000, 6.0, "tripleUp"))
    assertTrue(AapsStatusPolicy.publishGlucose(1000, 6.0, "tripleDown", 1000, 6.0, "unknown"))
    assertTrue(AapsStatusPolicy.publishGlucose(1000, 6.0, "flat", 1001, 6.0, "flat"))
  }
}
