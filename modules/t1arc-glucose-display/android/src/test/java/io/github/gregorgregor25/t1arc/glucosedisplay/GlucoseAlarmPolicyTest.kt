package io.github.gregorgregor25.t1arc.glucosedisplay

import org.junit.Assert.*
import org.junit.Test

class GlucoseAlarmPolicyTest {
  private val now = 10_000_000L
  private val elapsed = 2_000_000L
  private val source = "1:2:aaps"
  private val config = GlucoseAlarmPolicyConfig(enabled = true, veryHighEnabled = true, veryHighThreshold = 18.0)
  private fun episode(kind: GlucoseAlarmKind = GlucoseAlarmKind.LOW) = GlucoseAlarmEpisode("episode", kind, source, now - 1000,
    lastNotifiedElapsed = elapsed - 1000, bootCount = 2)
  private fun evaluate(value: Double?, previous: GlucoseAlarmEpisode? = null,
    config: GlucoseAlarmPolicyConfig = this.config, timestamp: Long = now, wall: Long = now,
    monotonic: Long = elapsed, boot: Int = 2, identity: String = source, minute: Int = 12 * 60) =
    GlucoseAlarmPolicy.evaluate(config, value?.let { GlucoseAlarmObservation(it, timestamp) }, previous,
      identity, wall, monotonic, boot, minute)

  @Test fun `disabled configuration never alerts`() {
    val decision = evaluate(2.0, episode(), config.copy(enabled = false))
    assertNull(decision.kind); assertFalse(decision.shouldNotify)
  }
  @Test fun `explicit rearm retries blocked audio without waiting for the repeat interval`() {
    assertTrue(GlucoseAlarmPolicy.shouldRestartAudio(true, true, false, false))
    assertTrue(GlucoseAlarmPolicy.shouldRestartAudio(false, false, false, false))
    assertTrue(GlucoseAlarmPolicy.shouldRestartAudio(true, false, true, true))
    assertFalse(GlucoseAlarmPolicy.shouldRestartAudio(true, false, false, false))
  }
  @Test fun `missing custom media cannot prevent master off or audio disarm`() {
    for (kind in GlucoseAlarmKind.entries) {
      assertFalse(GlucoseAlarmPolicy.soundRequired(config.copy(enabled = false), true, kind))
      assertFalse(GlucoseAlarmPolicy.soundRequired(config, false, kind))
    }
    assertFalse(GlucoseAlarmPolicy.soundRequired(config.copy(lowEnabled = false), true, GlucoseAlarmKind.LOW))
    assertTrue(GlucoseAlarmPolicy.soundRequired(config, true, GlucoseAlarmKind.LOW))
  }
  @Test fun `first audible alarm stays eligible while its foreground monitor is starting`() {
    val pending = episode().copy(lastNotifiedElapsed = null)
    assertTrue(evaluate(3.0, pending).shouldNotify)
    assertFalse(GlucoseAlarmPolicy.canDeliver(true, true, true, false))
    // No successful delivery was consumed; the service's initial tick can post it.
    assertTrue(evaluate(3.0, pending).shouldNotify)
    assertTrue(GlucoseAlarmPolicy.canDeliver(true, true, true, true))
  }
  @Test fun `Android app and channel notification blocks prevent audible delivery`() {
    assertFalse(GlucoseAlarmPolicy.canDeliver(false, true, true, true))
    assertFalse(GlucoseAlarmPolicy.canDeliver(true, false, true, true))
    assertFalse(GlucoseAlarmPolicy.canDeliver(false, false, false, true))
    assertTrue(GlucoseAlarmPolicy.canDeliver(true, true, false, false))
  }
  @Test fun `low threshold includes equality and has recovery hysteresis`() {
    assertEquals(GlucoseAlarmKind.LOW, evaluate(3.9).kind)
    assertEquals(GlucoseAlarmKind.LOW, evaluate(4.1, episode()).kind)
    assertNull(evaluate(4.2, episode()).kind)
  }
  @Test fun `very high takes priority over high with independent hysteresis`() {
    assertEquals(GlucoseAlarmKind.HIGH, evaluate(17.9).kind)
    assertEquals(GlucoseAlarmKind.VERY_HIGH, evaluate(18.0).kind)
    assertEquals(GlucoseAlarmKind.VERY_HIGH, evaluate(17.8, episode(GlucoseAlarmKind.VERY_HIGH)).kind)
    assertEquals(GlucoseAlarmKind.HIGH, evaluate(17.5, episode(GlucoseAlarmKind.VERY_HIGH)).kind)
  }
  @Test fun `a missing feed preserves the unresolved excursion without repeating old glucose`() {
    for (value in listOf<Double?>(null, 3.0)) {
      val d = evaluate(value, episode(), timestamp = now - GlucoseAlarmPolicy.STALE_MS - 1)
      assertEquals(GlucoseAlarmKind.LOW, d.kind); assertTrue(d.missing); assertTrue(d.keepPrevious); assertFalse(d.shouldNotify)
    }
  }
  @Test fun `missing data alone is separate from a low or a normal reading`() {
    val d = evaluate(null, config = config.copy(staleEnabled = true))
    assertEquals(GlucoseAlarmKind.STALE, d.kind); assertTrue(d.missing); assertTrue(d.shouldNotify)
    assertNull(evaluate(null).kind)
  }
  @Test fun `explicitly disabling a category also deactivates its missing feed episode`() {
    assertNull(evaluate(null, episode(), config.copy(lowEnabled = false)).kind)
    assertNull(evaluate(null, episode(GlucoseAlarmKind.HIGH), config.copy(highEnabled = false)).kind)
    assertNull(evaluate(null, episode(GlucoseAlarmKind.VERY_HIGH), config.copy(veryHighEnabled = false)).kind)
  }
  @Test fun `future timestamps fail closed instead of becoming a current low`() {
    val d = evaluate(2.0, timestamp = now + GlucoseAlarmPolicy.FUTURE_ALLOWANCE_MS + 1)
    assertTrue(d.missing); assertNull(d.kind)
  }
  @Test fun `staleness boundary accepts twelve minutes but no later`() {
    assertEquals(GlucoseAlarmKind.LOW, evaluate(3.0, timestamp = now - GlucoseAlarmPolicy.STALE_MS).kind)
    assertNull(evaluate(3.0, timestamp = now - GlucoseAlarmPolicy.STALE_MS - 1).kind)
  }
  @Test fun `same episode does not notify on each duplicate or corrected packet`() {
    assertFalse(evaluate(3.0, episode()).shouldNotify)
    assertFalse(evaluate(3.1, episode()).shouldNotify)
  }
  @Test fun `repeat deadlines use elapsed clock despite wall clock changes`() {
    val old = episode().copy(lastNotifiedElapsed = elapsed - 30 * 60_000)
    assertTrue(evaluate(3.0, old, wall = now + 2 * 60 * 60_000L, timestamp = now + 2 * 60 * 60_000L).shouldNotify)
    assertFalse(evaluate(3.0, old.copy(lastNotifiedElapsed = elapsed - 29 * 60_000)).shouldNotify)
  }
  @Test fun `acknowledgement stops this burst and reminders still follow the chosen interval`() {
    assertFalse(evaluate(3.0, episode().copy(acknowledged = true)).shouldNotify)
    assertTrue(evaluate(3.0, episode().copy(acknowledged = true, lastNotifiedElapsed = elapsed - 30 * 60_000)).shouldNotify)
    assertFalse(evaluate(3.0, episode().copy(acknowledged = true), config.copy(repeatMinutes = 0)).shouldNotify)
  }
  @Test fun `each requested preset suppresses only until its monotonic expiry`() {
    for (minutes in listOf(5, 10, 15, 20, 30, 60)) {
      val deadline = GlucoseAlarmPolicy.snoozeUntil(now, elapsed, now + minutes * 60_000)
      val old = episode().copy(snoozeUntilElapsed = deadline, snoozeUntilWall = now + minutes * 60_000)
      assertFalse(evaluate(3.0, old).shouldNotify)
      assertTrue(evaluate(3.0, old, monotonic = deadline).shouldNotify)
    }
  }
  @Test fun `snooze expiry rechecks the latest reading and never claims a stale recovery`() {
    val old = episode().copy(snoozeUntilElapsed = elapsed)
    assertNull(evaluate(6.0, old).kind)
    val lost = evaluate(null, old)
    assertTrue(lost.missing); assertEquals(GlucoseAlarmKind.LOW, lost.kind); assertFalse(lost.shouldNotify)
  }
  @Test fun `a snoozed high cannot suppress a low or a very high`() {
    val old = episode(GlucoseAlarmKind.HIGH).copy(snoozeUntilElapsed = elapsed + 60 * 60_000)
    assertTrue(evaluate(3.0, old).shouldNotify)
    assertTrue(evaluate(20.0, old).shouldNotify)
  }
  @Test fun `changing source discards old hysteresis and snooze`() {
    val old = episode().copy(snoozeUntilElapsed = elapsed + 60 * 60_000)
    assertNull(evaluate(4.0, old, identity = "new-source").kind)
    assertTrue(evaluate(3.0, old, identity = "new-source").shouldNotify)
  }
  @Test fun `reboot does not compare another boots elapsed deadline`() {
    val old = episode().copy(snoozeUntilElapsed = elapsed + 60 * 60_000)
    assertTrue(evaluate(3.0, old, boot = 3, monotonic = 1000).shouldNotify)
  }
  @Test fun `night schedule wraps midnight and ordinary high is silent`() {
    val night = config.copy(nightEnabled = true)
    for (minute in listOf(23 * 60, 0, 6 * 60 + 59)) {
      assertTrue(evaluate(15.0, config = night, minute = minute).silent)
      assertFalse(evaluate(3.0, config = night, minute = minute).silent)
      assertFalse(evaluate(20.0, config = night, minute = minute).silent)
    }
    assertFalse(evaluate(15.0, config = night, minute = 7 * 60).silent)
  }
  @Test fun `custom snooze is bounded and refuses a past clock time`() {
    for (duration in listOf(-1L, 0L, GlucoseAlarmPolicy.MAX_SNOOZE_MS + 1)) {
      assertThrows(IllegalArgumentException::class.java) { GlucoseAlarmPolicy.snoozeUntil(now, elapsed, now + duration) }
    }
    assertEquals(elapsed + 1, GlucoseAlarmPolicy.snoozeUntil(now, elapsed, now + 1))
    assertEquals(elapsed + GlucoseAlarmPolicy.MAX_SNOOZE_MS, GlucoseAlarmPolicy.snoozeUntil(now, elapsed, now + GlucoseAlarmPolicy.MAX_SNOOZE_MS))
  }
}
