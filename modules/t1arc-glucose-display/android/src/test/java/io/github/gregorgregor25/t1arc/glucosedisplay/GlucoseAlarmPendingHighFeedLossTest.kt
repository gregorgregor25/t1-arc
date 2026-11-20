package io.github.gregorgregor25.t1arc.glucosedisplay

import org.junit.Assert.*
import org.junit.Test

/**
 * A high that is still waiting out "Only alert if high lasts" must never hide a
 * missing-reading alert, and an expired waiting deadline must never be
 * rescheduled straight away (that would wake the phone in a tight loop).
 */
class GlucoseAlarmPendingHighFeedLossTest {
  private val now = 10_000_000L
  private val elapsed = 2_000_000L
  private val source = "1:2:aaps"
  private val minute = 60_000L
  private val delayed = GlucoseAlarmPolicyConfig(enabled = true, urgentLowEnabled = true, highPersistMinutes = 15)
  private val delayedWithStale = delayed.copy(staleEnabled = true)

  /** A high first seen [highFor] ago that has not been notified yet. */
  private fun waitingHigh(highFor: Long) = GlucoseAlarmEpisode("waiting", GlucoseAlarmKind.HIGH, source, now - highFor,
    lastNotifiedElapsed = null, bootCount = 2, excursionStartedAt = now - highFor)

  private fun evaluate(value: Double?, previous: GlucoseAlarmEpisode?, config: GlucoseAlarmPolicyConfig,
    wall: Long = now, monotonic: Long = elapsed, readingAt: Long = wall) =
    GlucoseAlarmPolicy.evaluate(config, value?.let { GlucoseAlarmObservation(it, readingAt) }, previous, source, wall,
      monotonic, 2, 12 * 60)

  /** What the engine stores after a decision, so a sequence of checks can be replayed. */
  private fun next(previous: GlucoseAlarmEpisode?, decision: GlucoseAlarmDecision, wall: Long, monotonic: Long): GlucoseAlarmEpisode? {
    val kind = decision.kind ?: return null
    val base = if (decision.keepPrevious && previous != null) previous.copy(kind = kind)
      else GlucoseAlarmEpisode("e-$wall", kind, source, wall, bootCount = 2)
    val stored = base.copy(excursionStartedAt = decision.excursionStartedAt, heldHighKind = decision.heldHighKind,
      heldHighStartedAt = decision.heldHighStartedAt)
    return if (decision.shouldNotify) stored.copy(lastNotifiedElapsed = monotonic) else stored
  }

  @Test fun `a missing-reading alert sounds when the feed stops before, during or after the high delay`() {
    for (highFor in listOf(0L, 5 * minute, 14 * minute, 15 * minute, 40 * minute)) {
      val decision = evaluate(null, waitingHigh(highFor), delayedWithStale)
      assertEquals("high for ${highFor / minute} min", GlucoseAlarmKind.STALE, decision.kind)
      assertTrue(decision.missing); assertTrue(decision.shouldNotify); assertFalse(decision.pending)
      assertFalse(decision.silent)
      // The unconfirmed high is still tracked, separately, with its original start.
      assertEquals(GlucoseAlarmKind.HIGH, decision.heldHighKind)
      assertEquals(now - highFor, decision.heldHighStartedAt)
    }
  }

  @Test fun `an old reading that becomes stale while a high waits also raises the missing-reading alert`() {
    val decision = evaluate(15.0, waitingHigh(5 * minute), delayedWithStale, readingAt = now - GlucoseAlarmPolicy.STALE_MS - 1)
    assertEquals(GlucoseAlarmKind.STALE, decision.kind); assertTrue(decision.shouldNotify)
    assertEquals(GlucoseAlarmKind.HIGH, decision.heldHighKind)
  }

  @Test fun `an already notified high still keeps its episode when readings stop`() {
    val notified = waitingHigh(20 * minute).copy(lastNotifiedElapsed = elapsed - minute)
    val decision = evaluate(null, notified, delayedWithStale)
    assertEquals(GlucoseAlarmKind.HIGH, decision.kind); assertTrue(decision.keepPrevious)
    assertFalse(decision.pending); assertFalse(decision.shouldNotify)
  }

  @Test fun `with missing-reading alerts off a waiting high stays hidden and its deadline is never in the past`() {
    for (highFor in listOf(0L, 5 * minute, 14 * minute)) {
      val decision = evaluate(null, waitingHigh(highFor), delayed)
      assertEquals(GlucoseAlarmKind.HIGH, decision.kind)
      assertTrue(decision.pending); assertFalse(decision.shouldNotify)
      assertEquals(now - highFor + 15 * minute, decision.pendingUntilWall)
    }
    for (highFor in listOf(15 * minute, 40 * minute)) {
      val decision = evaluate(null, waitingHigh(highFor), delayed)
      assertTrue(decision.pending); assertFalse(decision.shouldNotify)
      assertNull("expired deadline for ${highFor / minute} min", decision.pendingUntilWall)
    }
  }

  @Test fun `an expired waiting deadline is checked once and then follows the normal cadence`() {
    // Deadline in the future: wake at the deadline when it is sooner than a minute.
    assertEquals(elapsed + 30_000L, GlucoseAlarmPolicy.pendingCheckElapsed(now + 30_000L, now, elapsed))
    assertEquals(elapsed + GlucoseAlarmPolicy.CHECK_INTERVAL_MS, GlucoseAlarmPolicy.pendingCheckElapsed(now + 10 * minute, now, elapsed))
    // Deadline reached or passed: never "now", which would loop.
    for (deadline in listOf(now, now - 1, now - 30 * minute, null)) {
      assertEquals(elapsed + GlucoseAlarmPolicy.CHECK_INTERVAL_MS, GlucoseAlarmPolicy.pendingCheckElapsed(deadline, now, elapsed))
    }
  }

  @Test fun `delay expiry with no new readings never asks for an immediate recheck`() {
    var episode: GlucoseAlarmEpisode? = waitingHigh(10 * minute)
    // Readings stop; check every scheduled wake-up for the next hour.
    var wall = now
    var monotonic = elapsed
    repeat(60) {
      val decision = evaluate(null, episode, delayed, wall = wall, monotonic = monotonic)
      assertFalse(decision.shouldNotify)
      val wake = GlucoseAlarmPolicy.pendingCheckElapsed(decision.pendingUntilWall, wall, monotonic)
      assertTrue("wake-up must be in the future", wake > monotonic)
      episode = next(episode, decision, wall, monotonic)
      wall += wake - monotonic; monotonic = wake
    }
  }

  @Test fun `after feed loss a fresh high reading alerts once the original delay has passed`() {
    // High for 10 minutes, then 20 minutes without readings: missing-reading alert sounds.
    var episode = next(waitingHigh(10 * minute), evaluate(null, waitingHigh(10 * minute), delayedWithStale), now, elapsed)
    assertEquals(GlucoseAlarmKind.STALE, episode?.kind)
    val later = now + 20 * minute
    episode = next(episode, evaluate(null, episode, delayedWithStale, wall = later, monotonic = elapsed + 20 * minute),
      later, elapsed + 20 * minute)
    assertEquals(GlucoseAlarmKind.STALE, episode?.kind); assertEquals(GlucoseAlarmKind.HIGH, episode?.heldHighKind)
    // A fresh reading is still high: it confirms the excursion that began 30 minutes ago.
    val fresh = evaluate(15.0, episode, delayedWithStale, wall = later + minute, monotonic = elapsed + 21 * minute)
    assertEquals(GlucoseAlarmKind.HIGH, fresh.kind)
    assertFalse(fresh.pending); assertTrue(fresh.shouldNotify); assertFalse(fresh.keepPrevious)
    assertEquals(now - 10 * minute, fresh.excursionStartedAt)
    assertNull(fresh.heldHighKind)
  }

  @Test fun `a fresh high reading soon after feed loss keeps waiting out the delay`() {
    val stale = next(waitingHigh(2 * minute), evaluate(null, waitingHigh(2 * minute), delayedWithStale), now, elapsed)
    val fresh = evaluate(15.0, stale, delayedWithStale, wall = now + 3 * minute, monotonic = elapsed + 3 * minute)
    assertEquals(GlucoseAlarmKind.HIGH, fresh.kind)
    assertTrue(fresh.pending); assertFalse(fresh.shouldNotify)
    assertEquals(now - 2 * minute + 15 * minute, fresh.pendingUntilWall)
  }

  @Test fun `a fresh in-range or low reading after feed loss ends the waiting high`() {
    val stale = next(waitingHigh(5 * minute), evaluate(null, waitingHigh(5 * minute), delayedWithStale), now, elapsed)
    assertNull(evaluate(8.0, stale, delayedWithStale, wall = now + minute, monotonic = elapsed + minute).kind)
    val low = evaluate(3.5, stale, delayedWithStale, wall = now + minute, monotonic = elapsed + minute)
    assertEquals(GlucoseAlarmKind.LOW, low.kind); assertTrue(low.shouldNotify)
  }

  @Test fun `a fresh high reading after a hidden wait with missing-reading alerts off alerts once the delay has passed`() {
    val hidden = next(waitingHigh(10 * minute), evaluate(null, waitingHigh(10 * minute), delayed), now, elapsed)
    assertEquals(GlucoseAlarmKind.HIGH, hidden?.kind); assertNull(hidden?.lastNotifiedElapsed)
    val fresh = evaluate(15.0, hidden, delayed, wall = now + 20 * minute, monotonic = elapsed + 20 * minute)
    assertFalse(fresh.pending); assertTrue(fresh.shouldNotify)
  }

  @Test fun `a held high from another source is discarded`() {
    val stale = waitingHigh(20 * minute).copy(kind = GlucoseAlarmKind.STALE, heldHighKind = GlucoseAlarmKind.HIGH,
      heldHighStartedAt = now - 20 * minute)
    val decision = GlucoseAlarmPolicy.evaluate(delayedWithStale, GlucoseAlarmObservation(15.0, now), stale, "other", now,
      elapsed, 2, 12 * 60)
    assertTrue(decision.pending); assertEquals(now, decision.excursionStartedAt)
  }
}
