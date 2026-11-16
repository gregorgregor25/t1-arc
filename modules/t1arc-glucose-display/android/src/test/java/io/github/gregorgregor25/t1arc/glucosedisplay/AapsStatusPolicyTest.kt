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

  @Test fun onlyNewOrCorrectedGlucoseCountsAsChanged() {
    val original = reading()
    val seen = AapsGlucoseIdentity.of(original)
    assertTrue(AapsStatusPolicy.glucoseChanged(null, original))
    assertFalse(AapsStatusPolicy.glucoseChanged(seen,
      original.copy(id = "two", receivedAt = original.receivedAt + 60_000L,
        iobUnits = -0.3, bolusIobUnits = 0.1, basalIobUnits = -0.4,
        cobGrams = 4.0, futureCarbsGrams = 2.0, deltaMgdl = 1.0, avgDeltaMgdl = 0.5)))
    assertTrue(AapsStatusPolicy.glucoseChanged(seen,
      original.copy(glucoseTimestamp = original.glucoseTimestamp!! + 300_000L)))
    assertTrue(AapsStatusPolicy.glucoseChanged(seen, original.copy(glucoseMgdl = 121.0)))
    assertTrue(AapsStatusPolicy.glucoseChanged(seen, original.copy(trend = "up")))
    assertTrue(AapsStatusPolicy.glucoseChanged(seen, original.copy(selectionGeneration = 5L)))
    assertTrue(AapsStatusPolicy.glucoseChanged(seen, original.copy(writeEpoch = 3L)))
  }

  @Test fun statusWithoutGlucoseIsNeverAGlucoseChange() {
    val original = reading()
    val missing = original.copy(glucoseMgdl = null, glucoseTimestamp = null, trend = null)
    assertFalse(AapsStatusPolicy.glucoseChanged(AapsGlucoseIdentity.of(original), missing))
    assertFalse(AapsStatusPolicy.glucoseChanged(null, missing))
    // The same glucose returning after a status without it is not a change.
    assertFalse(AapsStatusPolicy.glucoseChanged(AapsGlucoseIdentity.of(original), original))
  }

  @Test fun dueAlertCheckStillGetsItsSync() {
    assertTrue(AapsStatusPolicy.requestsSync(false, 1_000L, 61_000L, 5_000L, 5_000L))
    assertFalse(AapsStatusPolicy.requestsSync(false, 1_000L, 61_000L, 5_000L, 4_999L))
    assertFalse(AapsStatusPolicy.requestsSync(false, 1_000L, 61_000L, null, 5_000L))
    assertFalse(AapsStatusPolicy.requestsSync(false, 1_000L, 61_000L, 0L, 5_000L))
  }

  @Test fun insulinOnlyStatusWaitsForTheNextSyncWithinTheDeferralBound() {
    assertTrue(AapsStatusPolicy.requestsSync(true, 1_000L, 1_001L))
    assertTrue(AapsStatusPolicy.requestsSync(false, null, 1_000L))
    assertFalse(AapsStatusPolicy.requestsSync(false, 1_000L, 61_000L))
    assertFalse(AapsStatusPolicy.requestsSync(false, 1_000L,
      1_000L + AAPS_MAX_SYNC_DEFERRAL_MS - 1L))
    assertTrue(AapsStatusPolicy.requestsSync(false, 1_000L,
      1_000L + AAPS_MAX_SYNC_DEFERRAL_MS))
  }

  @Test fun newerAndCorrectedGlucosePublishesButOlderDoesNot() {
    assertTrue(AapsStatusPolicy.publishGlucose(null, null, null, 1000, 6.0, "flat"))
    assertFalse(AapsStatusPolicy.publishGlucose(1000, 6.0, "flat", 999, 6.5, "up"))
    assertFalse(AapsStatusPolicy.publishGlucose(1000, 6.0, "flat", 1000, 6.0, "flat"))
    assertTrue(AapsStatusPolicy.publishGlucose(1000, 6.0, "flat", 1000, 6.2, "flat"))
    assertTrue(AapsStatusPolicy.publishGlucose(1000, 6.0, "flat", 1000, 6.0, "up"))
    assertTrue(AapsStatusPolicy.publishGlucose(1000, 6.0, "doubleUp", 1000, 6.0, "tripleUp"))
    assertTrue(AapsStatusPolicy.publishGlucose(1000, 6.0, "flat", 1001, 6.0, "flat"))
    assertTrue(AapsStatusPolicy.publishGlucose(1000, 6.0, "flat", 1001, 6.0, "unknown"))
  }

  @Test fun repeatedReadingWithoutTrendKeepsTheShownTrend() {
    // Each AAPS status repeats the reading. Without a trend it must not
    // replace the trend already shown and republish every surface.
    assertFalse(AapsStatusPolicy.publishGlucose(1000, 6.0, "tripleDown", 1000, 6.0, "unknown"))
    assertFalse(AapsStatusPolicy.publishGlucose(1000, 6.0, "flat", 1000, 6.0, "unknown"))
    assertFalse(AapsStatusPolicy.publishGlucose(1000, 6.0, "unknown", 1000, 6.0, "unknown"))
    // A corrected value still publishes, with or without a trend.
    assertTrue(AapsStatusPolicy.publishGlucose(1000, 6.0, "flat", 1000, 6.1, "unknown"))
    // A trend from AAPS still replaces a calculated one.
    assertTrue(AapsStatusPolicy.publishGlucose(1000, 6.0, "flat", 1000, 6.0, "up"))
  }

  @Test fun nativeSnapshotGuardsOnlyAapsSuppliedTrends() {
    assertTrue(AapsStatusPolicy.nativeReadingWins(1000, 6.0, "flat", "source", 999, 6.0, "flat"))
    assertTrue(AapsStatusPolicy.nativeReadingWins(1000, 6.0, "flat", "source", 1000, 6.1, "flat"))
    assertTrue(AapsStatusPolicy.nativeReadingWins(1000, 6.0, "flat", "source", 1000, 6.0, "up"))
    assertFalse(AapsStatusPolicy.nativeReadingWins(1000, 6.0, "flat", "source", 1000, 6.0, "flat"))
    assertFalse(AapsStatusPolicy.nativeReadingWins(1000, 6.0, "flat", "source", 1001, 6.4, "up"))
    // A calculated trend can be recalculated by a later sync.
    assertFalse(AapsStatusPolicy.nativeReadingWins(1000, 6.0, "flat", "calculated", 1000, 6.0, "up"))
    assertFalse(AapsStatusPolicy.nativeReadingWins(1000, 6.0, "unknown", "unavailable", 1000, 6.0, "up"))
  }
}
