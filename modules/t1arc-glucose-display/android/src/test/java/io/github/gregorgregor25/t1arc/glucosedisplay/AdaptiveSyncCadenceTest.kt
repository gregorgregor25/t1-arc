package io.github.gregorgregor25.t1arc.glucosedisplay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AdaptiveSyncCadenceTest {
  private val min = 60_000L
  private val t0 = 1_800_000_000_000L

  @Test fun unknownReadingUsesBaseTick() =
    assertEquals(60_000L, GlucoseSyncCadencePolicy.nextDelayMs(null, t0, null))

  @Test fun unknownIntervalKeepsLegacyCadence() {
    assertEquals(60_000L, GlucoseSyncCadencePolicy.nextDelayMs(t0, t0 + 1 * min, null))
    assertEquals(15_000L, GlucoseSyncCadencePolicy.nextDelayMs(t0, t0 + 5 * min, null))
    assertEquals(60_000L, GlucoseSyncCadencePolicy.nextDelayMs(t0, t0 + 13 * min, null))
  }

  @Test fun minuteSourceKeepsLegacyCadence() {
    assertEquals(60_000L, GlucoseSyncCadencePolicy.nextDelayMs(t0, t0 + 30_000L, 60_000L))
    assertEquals(15_000L, GlucoseSyncCadencePolicy.nextDelayMs(t0, t0 + 5 * min, 60_000L))
  }

  @Test fun fiveMinuteSourceSleepsUntilDue() =
    // reading at t0, due t0+5m+20s, now t0+1m -> wait 4m20s
    assertEquals(260_000L, GlucoseSyncCadencePolicy.nextDelayMs(t0, t0 + 1 * min, 5 * min))

  @Test fun dueDelayIsClampedToAtLeastFifteenSeconds() =
    assertEquals(15_000L, GlucoseSyncCadencePolicy.nextDelayMs(t0, t0 + 5 * min + 15_000L, 5 * min))

  @Test fun futureTimestampIsClampedToOneIntervalPlusGrace() =
    assertEquals(5 * min + 20_000L, GlucoseSyncCadencePolicy.nextDelayMs(t0 + 10 * min, t0, 5 * min))

  @Test fun overdueReadingPollsFastUntilStaleThenSettles() {
    assertEquals(20_000L, GlucoseSyncCadencePolicy.nextDelayMs(t0, t0 + 6 * min, 5 * min))
    assertEquals(20_000L, GlucoseSyncCadencePolicy.nextDelayMs(t0, t0 + 8 * min, 5 * min))
    assertEquals(20_000L, GlucoseSyncCadencePolicy.nextDelayMs(t0, t0 + 12 * min, 5 * min))
    assertEquals(60_000L, GlucoseSyncCadencePolicy.nextDelayMs(t0, t0 + 12 * min + 1L, 5 * min))
  }

  @Test fun alertCheckWakesAdaptiveScheduleEarly() {
    // Reading-based wait is 4m20s; a repeat due in 90 s wins.
    assertEquals(90_000L, GlucoseSyncCadencePolicy.nextDelayMs(t0, t0 + 1 * min, 5 * min, alertCheckAtMs = t0 + 150_000L))
    // A later alert check never delays the reading-based schedule.
    assertEquals(260_000L, GlucoseSyncCadencePolicy.nextDelayMs(t0, t0 + 1 * min, 5 * min, alertCheckAtMs = t0 + 30 * min))
    // Due or overdue checks are clamped, so a stale hint cannot cause a storm.
    assertEquals(15_000L, GlucoseSyncCadencePolicy.nextDelayMs(t0, t0 + 1 * min, 5 * min, alertCheckAtMs = t0))
    // Legacy timing already checks at least once a minute and is unchanged.
    assertEquals(60_000L, GlucoseSyncCadencePolicy.nextDelayMs(t0, t0 + 1 * min, null, alertCheckAtMs = t0 + 70_000L))
  }

  @Test fun alertCheckAlsoBoundsProbeAndOverdueDelays() {
    assertEquals(15_000L, GlucoseSyncCadencePolicy.nextDelayMs(t0, t0 + 40_000L, 5 * min, t0 + 90_000L, t0 + 50_000L))
    assertEquals(20_000L, GlucoseSyncCadencePolicy.nextDelayMs(t0, t0 + 6 * min, 5 * min, alertCheckAtMs = t0 + 7 * min))
  }

  @Test fun publishedReadingReschedulesOnlyWhenItAdvances() {
    val tracker = fiveMinuteTracker() // latest t0 + 10m
    assertEquals(false, tracker.observe(t0 + 10 * min))
    assertEquals(false, tracker.observe(t0 + 9 * min))
    assertEquals(true, tracker.observe(t0 + 15 * min))
    assertEquals(true, tracker.adaptive())
    // Rescheduled from the new reading: next due 5m20s after it.
    assertEquals(
      310_000L,
      GlucoseSyncCadencePolicy.nextDelayMs(t0 + 15 * min, t0 + 15 * min + 10_000L, tracker.expectedIntervalMs(), tracker.probeAtMs()),
    )
    assertEquals(false, ReadingCadenceTracker().apply { observe(t0) }.adaptive())
  }

  @Test fun probeChecksShortlyAfterReadingThenResumesDueSchedule() {
    val probeAt = t0 + 90_000L
    assertEquals(50_000L, GlucoseSyncCadencePolicy.nextDelayMs(t0, t0 + 40_000L, 5 * min, probeAt))
    assertEquals(15_000L, GlucoseSyncCadencePolicy.nextDelayMs(t0, t0 + 85_000L, 5 * min, probeAt))
    // Once the probe time has passed, the normal due schedule applies.
    assertEquals(230_000L, GlucoseSyncCadencePolicy.nextDelayMs(t0, t0 + 90_000L, 5 * min, probeAt))
    // A probe never changes legacy timing.
    assertEquals(60_000L, GlucoseSyncCadencePolicy.nextDelayMs(t0, t0 + 40_000L, null, probeAt))
  }

  @Test fun trackerNeedsTwoConsistentFiveMinuteGaps() {
    val tracker = ReadingCadenceTracker()
    tracker.observe(t0)
    assertNull(tracker.expectedIntervalMs())
    tracker.observe(t0) // repeat of same reading changes nothing
    assertNull(tracker.expectedIntervalMs())
    tracker.observe(t0 + 5 * min)
    assertNull(tracker.expectedIntervalMs())
    tracker.observe(t0 + 10 * min)
    assertEquals(5 * min, tracker.expectedIntervalMs())
    tracker.observe(t0 + 11 * min)
    assertEquals(60_000L, tracker.expectedIntervalMs())
  }

  @Test fun minuteSourceOutageDoesNotSwitchToFiveMinuteCadence() {
    val tracker = ReadingCadenceTracker()
    tracker.observe(t0)
    tracker.observe(t0 + 1 * min)
    assertEquals(60_000L, tracker.expectedIntervalMs())
    tracker.observe(t0 + 6 * min) // one five-minute outage
    tracker.observe(t0 + 7 * min)
    assertEquals(60_000L, tracker.expectedIntervalMs())
    tracker.observe(t0 + 12 * min) // non-consecutive outage
    assertEquals(60_000L, tracker.expectedIntervalMs())
  }

  @Test fun trackerIgnoresGapsAndOlderReadings() {
    val tracker = ReadingCadenceTracker()
    tracker.observe(t0)
    tracker.observe(t0 + 5 * min)
    tracker.observe(t0 + 50 * min) // sensor gap: not a cadence, breaks the streak
    assertNull(tracker.expectedIntervalMs())
    tracker.observe(t0 + 55 * min)
    assertNull(tracker.expectedIntervalMs())
    tracker.observe(t0 + 60 * min)
    assertEquals(5 * min, tracker.expectedIntervalMs())
    tracker.observe(t0 + 40 * min) // backfilled older reading ignored
    assertEquals(5 * min, tracker.expectedIntervalMs())
  }

  @Test fun sparseGapsWhileAdaptiveDoNotChangeClassification() {
    val tracker = fiveMinuteTracker()
    tracker.observe(t0 + 20 * min) // missed reading observed at the sparse cadence
    assertEquals(5 * min, tracker.expectedIntervalMs())
  }

  @Test fun adaptiveTrackerProbesEverySixthReading() {
    val tracker = fiveMinuteTracker() // latest reading t0 + 10m
    for (step in 1..5) {
      tracker.observe(t0 + (10 + 5 * step) * min)
      assertNull(tracker.probeAtMs())
    }
    tracker.observe(t0 + 40 * min)
    assertEquals(t0 + 40 * min + 90_000L, tracker.probeAtMs())
    tracker.observe(t0 + 40 * min) // the same reading keeps the same probe
    assertEquals(t0 + 40 * min + 90_000L, tracker.probeAtMs())
    tracker.observe(t0 + 45 * min)
    assertNull(tracker.probeAtMs())
  }

  @Test fun probeRevealingMinuteReadingsRestoresLegacyCadence() {
    val tracker = fiveMinuteTracker()
    tracker.observe(t0 + 11 * min)
    assertEquals(60_000L, tracker.expectedIntervalMs())
    assertNull(tracker.probeAtMs())
  }

  @Test fun sourceChangeForgetsLearnedCadence() {
    val tracker = ReadingCadenceTracker()
    tracker.observe(t0, "Dexcom")
    tracker.observe(t0 + 5 * min, "Dexcom")
    tracker.observe(t0 + 10 * min, "Dexcom")
    assertEquals(5 * min, tracker.expectedIntervalMs())
    tracker.observe(t0 + 11 * min, "LibreLinkUp")
    assertNull(tracker.expectedIntervalMs())
  }

  @Test fun legacyCadenceIsUnchangedForUnknownSource() {
    val tracker = ReadingCadenceTracker()
    tracker.observe(t0)
    assertEquals(
      GlucoseSyncCadencePolicy.nextDelayMs(t0, t0 + 4 * min),
      GlucoseSyncCadencePolicy.nextDelayMs(t0, t0 + 4 * min, tracker.expectedIntervalMs(), tracker.probeAtMs()),
    )
  }

  @Test fun renderOnlyWhenVisible() {
    assertEquals(true, RenderGatePolicy.shouldRender(interactive = true, displayOff = false))
    assertEquals(false, RenderGatePolicy.shouldRender(interactive = false, displayOff = true))
    // System always-on display (doze) can still show the notification icon.
    assertEquals(true, RenderGatePolicy.shouldRender(interactive = false, displayOff = false))
  }

  @Test fun skippedRenderIsReplayedWhenDisplayBecomesVisible() {
    val gate = RenderGate()
    assertEquals(true, gate.beginRender(interactive = true, displayOff = false))
    assertEquals(false, gate.shouldReplayOnDisplayChange(interactive = false, displayOff = false))
    assertEquals(false, gate.beginRender(interactive = false, displayOff = true))
    // Still off: nothing to replay.
    assertEquals(false, gate.shouldReplayOnDisplayChange(interactive = false, displayOff = true))
    assertEquals(true, gate.shouldReplayOnDisplayChange(interactive = false, displayOff = false))
    assertEquals(true, gate.beginRender(interactive = false, displayOff = false))
    assertEquals(false, gate.shouldReplayOnDisplayChange(interactive = true, displayOff = false))
  }

  @Test fun historyDedupeSkipsOnlyConfirmedIdenticalPayloads() {
    val dedupe = WearHistoryDedupe()
    val first = requireNotNull(dedupe.begin("a", force = false))
    // Not yet confirmed: an identical payload is still sent.
    assertEquals(true, dedupe.begin("a", force = false) != null)
    dedupe.published(first, "a")
    val second = requireNotNull(dedupe.begin("a", force = false))
    dedupe.published(second, "a")
    assertNull(dedupe.begin("a", force = false))
    assertEquals(true, dedupe.begin("b", force = false) != null)
  }

  @Test fun historyDedupeNeverSkipsAfterFailureForceOrReset() {
    val dedupe = WearHistoryDedupe()
    dedupe.published(requireNotNull(dedupe.begin("a", force = false)), "a")
    // A failed write records nothing, so the same payload is retried.
    dedupe.begin("b", force = false)
    assertEquals(true, dedupe.begin("b", force = false) != null)
    // An explicit watch request always publishes.
    dedupe.published(requireNotNull(dedupe.begin("c", force = false)), "c")
    assertEquals(true, dedupe.begin("c", force = true) != null)
    dedupe.published(requireNotNull(dedupe.begin("d", force = false)), "d")
    dedupe.reset()
    assertEquals(true, dedupe.begin("d", force = false) != null)
  }

  @Test fun historyDedupeIgnoresOutOfOrderConfirmation() {
    val dedupe = WearHistoryDedupe()
    dedupe.published(requireNotNull(dedupe.begin("a", force = false)), "a")
    val b = requireNotNull(dedupe.begin("b", force = false))
    // While "b" is in flight the retained item is no longer known to be "a".
    val a = requireNotNull(dedupe.begin("a", force = false))
    dedupe.published(a, "a")
    dedupe.published(b, "b") // late confirmation of an older write
    assertNull(dedupe.begin("a", force = false))
    assertEquals(true, dedupe.begin("b", force = false) != null)
  }

  private fun fiveMinuteTracker() =
    ReadingCadenceTracker().apply {
      observe(t0)
      observe(t0 + 5 * min)
      observe(t0 + 10 * min)
      assertEquals(5 * min, expectedIntervalMs())
    }
}
