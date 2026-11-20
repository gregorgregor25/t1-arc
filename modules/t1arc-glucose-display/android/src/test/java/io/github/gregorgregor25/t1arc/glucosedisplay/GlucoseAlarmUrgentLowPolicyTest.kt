package io.github.gregorgregor25.t1arc.glucosedisplay

import org.junit.Assert.*
import org.junit.Test

class GlucoseAlarmUrgentLowPolicyTest {
  private val now = 10_000_000L
  private val elapsed = 2_000_000L
  private val source = "1:2:aaps"
  private val minute = 60_000L
  private val config = GlucoseAlarmPolicyConfig(enabled = true, urgentLowEnabled = true, urgentLowThreshold = 3.0,
    lowThreshold = 3.9, veryHighEnabled = true, veryHighThreshold = 18.0, hypoTreatmentSnoozeMinutes = 15)

  private fun episode(kind: GlucoseAlarmKind, notified: Long? = elapsed - 1000, start: Long? = null) =
    GlucoseAlarmEpisode("episode", kind, source, now - 1000, lastNotifiedElapsed = notified, bootCount = 2,
      excursionStartedAt = start)

  private fun evaluate(value: Double?, previous: GlucoseAlarmEpisode? = null, config: GlucoseAlarmPolicyConfig = this.config,
    minuteOfDay: Int = 12 * 60, lowPause: Long? = null, monotonic: Long = elapsed) =
    GlucoseAlarmPolicy.evaluate(config, value?.let { GlucoseAlarmObservation(it, now) }, previous, source, now, monotonic, 2,
      minuteOfDay, lowPause)

  // Urgent low priority

  @Test fun `urgent low takes priority over low and includes its threshold`() {
    assertEquals(GlucoseAlarmKind.URGENT_LOW, evaluate(3.0).kind)
    assertEquals(GlucoseAlarmKind.URGENT_LOW, evaluate(2.2).kind)
    assertEquals(GlucoseAlarmKind.LOW, evaluate(3.1).kind)
    assertEquals(GlucoseAlarmKind.LOW, evaluate(2.2, config = config.copy(urgentLowEnabled = false)).kind)
  }

  @Test fun `urgent low has recovery hysteresis`() {
    val urgent = episode(GlucoseAlarmKind.URGENT_LOW)
    assertEquals(GlucoseAlarmKind.URGENT_LOW, evaluate(3.25, urgent).kind)
    assertEquals(GlucoseAlarmKind.LOW, evaluate(3.35, urgent).kind)
  }

  @Test fun `easing from urgent low into low continues the episode without a second alarm`() {
    val decision = evaluate(3.5, episode(GlucoseAlarmKind.URGENT_LOW))
    assertEquals(GlucoseAlarmKind.LOW, decision.kind)
    assertTrue(decision.keepPrevious); assertFalse(decision.shouldNotify)
    // Low hysteresis also applies after urgent low.
    assertEquals(GlucoseAlarmKind.LOW, evaluate(4.1, episode(GlucoseAlarmKind.URGENT_LOW)).kind)
  }

  @Test fun `falling from low into urgent low alerts again straight away`() {
    val decision = evaluate(2.9, episode(GlucoseAlarmKind.LOW))
    assertEquals(GlucoseAlarmKind.URGENT_LOW, decision.kind)
    assertFalse(decision.keepPrevious); assertTrue(decision.shouldNotify)
  }

  @Test fun `a low snooze with no recorded start cannot hold back an urgent low`() {
    // Older saved snoozes and the hypo-treatment pause record no start; see GlucoseAlarmUpgradeAndSnoozeCarryTest.
    val snoozed = episode(GlucoseAlarmKind.LOW).copy(snoozeUntilElapsed = elapsed + 60 * minute)
    assertTrue(evaluate(2.8, snoozed).shouldNotify)
  }

  @Test fun `urgent low snooze is capped at thirty minutes`() {
    assertEquals(elapsed + 30 * minute,
      GlucoseAlarmPolicy.snoozeUntil(now, elapsed, now + 30 * minute, GlucoseAlarmKind.URGENT_LOW))
    val error = assertThrows(IllegalArgumentException::class.java) {
      GlucoseAlarmPolicy.snoozeUntil(now, elapsed, now + 30 * minute + 1, GlucoseAlarmKind.URGENT_LOW)
    }
    assertEquals("Urgent low alerts can be snoozed for up to 30 minutes.", error.message)
    assertEquals(elapsed + 60 * minute, GlucoseAlarmPolicy.snoozeUntil(now, elapsed, now + 60 * minute, GlucoseAlarmKind.LOW))
    assertEquals(30 * minute, GlucoseAlarmPolicy.maxSnoozeMs(GlucoseAlarmKind.URGENT_LOW))
    assertEquals(GlucoseAlarmPolicy.MAX_SNOOZE_MS, GlucoseAlarmPolicy.maxSnoozeMs(GlucoseAlarmKind.HIGH))
  }

  @Test fun `urgent low reminds within thirty minutes even when reminders are off`() {
    assertEquals(30, GlucoseAlarmPolicy.effectiveRepeatMinutes(config.copy(repeatMinutes = 0), GlucoseAlarmKind.URGENT_LOW))
    assertEquals(30, GlucoseAlarmPolicy.effectiveRepeatMinutes(config.copy(repeatMinutes = 120), GlucoseAlarmKind.URGENT_LOW))
    assertEquals(10, GlucoseAlarmPolicy.effectiveRepeatMinutes(config.copy(repeatMinutes = 10), GlucoseAlarmKind.URGENT_LOW))
    assertEquals(0, GlucoseAlarmPolicy.effectiveRepeatMinutes(config.copy(repeatMinutes = 0), GlucoseAlarmKind.LOW))
    val never = config.copy(repeatMinutes = 0)
    val acknowledged = episode(GlucoseAlarmKind.URGENT_LOW, notified = elapsed - 30 * minute).copy(acknowledged = true)
    assertTrue(evaluate(2.5, acknowledged, never).shouldNotify)
    assertFalse(evaluate(2.5, acknowledged.copy(lastNotifiedElapsed = elapsed - 29 * minute), never).shouldNotify)
    assertFalse(evaluate(3.5, episode(GlucoseAlarmKind.LOW, notified = elapsed - 30 * minute), never).shouldNotify)
  }

  // Night schedule

  @Test fun `night schedule quietens ordinary high only`() {
    val night = config.copy(nightEnabled = true, staleEnabled = true)
    for (minuteOfDay in listOf(23 * 60, 2 * 60)) {
      assertTrue(evaluate(15.0, config = night, minuteOfDay = minuteOfDay).silent)
      assertFalse(evaluate(2.5, config = night, minuteOfDay = minuteOfDay).silent)
      assertFalse(evaluate(3.5, config = night, minuteOfDay = minuteOfDay).silent)
      assertFalse(evaluate(20.0, config = night, minuteOfDay = minuteOfDay).silent)
      assertFalse(evaluate(null, config = night, minuteOfDay = minuteOfDay).silent)
    }
    assertTrue(evaluate(2.5, config = night, minuteOfDay = 23 * 60).shouldNotify)
    assertFalse(evaluate(15.0, config = config.copy(nightEnabled = false), minuteOfDay = 23 * 60).silent)
    assertFalse(GlucoseAlarmPolicy.silentAtNight(GlucoseAlarmKind.URGENT_LOW))
  }

  // Persistence delay for high and very high

  @Test fun `no delay is the default and alerts straight away`() {
    val decision = evaluate(15.0, config = config.copy(highPersistMinutes = 0))
    assertFalse(decision.pending); assertTrue(decision.shouldNotify)
  }

  @Test fun `a new high waits for the chosen delay without notifying`() {
    val delayed = config.copy(highPersistMinutes = 15)
    val decision = evaluate(15.0, config = delayed)
    assertEquals(GlucoseAlarmKind.HIGH, decision.kind)
    assertTrue(decision.pending); assertFalse(decision.shouldNotify)
    assertEquals(now + 15 * minute, decision.pendingUntilWall)
    assertEquals(now, decision.excursionStartedAt)
  }

  @Test fun `a high that stays out of range alerts once the delay has passed`() {
    val delayed = config.copy(highPersistMinutes = 15)
    val waiting = episode(GlucoseAlarmKind.HIGH, notified = null, start = now - 14 * minute)
    assertTrue(evaluate(15.0, waiting, delayed).pending)
    val due = evaluate(15.0, waiting.copy(excursionStartedAt = now - 15 * minute), delayed)
    assertFalse(due.pending); assertTrue(due.shouldNotify)
    assertEquals(now - 15 * minute, due.excursionStartedAt)
  }

  @Test fun `rising from high to very high keeps the time already spent high`() {
    val delayed = config.copy(highPersistMinutes = 15)
    val decision = evaluate(20.0, episode(GlucoseAlarmKind.HIGH, notified = null, start = now - 16 * minute), delayed)
    assertEquals(GlucoseAlarmKind.VERY_HIGH, decision.kind)
    assertFalse(decision.pending); assertTrue(decision.shouldNotify)
    assertEquals(now - 16 * minute, decision.excursionStartedAt)
  }

  @Test fun `an already notified high is never hidden again`() {
    val delayed = config.copy(highPersistMinutes = 30)
    assertFalse(evaluate(15.0, episode(GlucoseAlarmKind.HIGH, start = now), delayed).pending)
  }

  @Test fun `lows urgent lows and missing readings are never delayed`() {
    val delayed = config.copy(highPersistMinutes = 30, staleEnabled = true)
    for (value in listOf<Double?>(2.5, 3.5, null)) {
      val decision = evaluate(value, config = delayed)
      assertFalse(decision.pending); assertTrue(decision.shouldNotify)
    }
  }

  @Test fun `missing data cannot confirm a high that is still waiting`() {
    val delayed = config.copy(highPersistMinutes = 15)
    val decision = evaluate(null, episode(GlucoseAlarmKind.HIGH, notified = null, start = now - 20 * minute), delayed)
    assertEquals(GlucoseAlarmKind.HIGH, decision.kind)
    assertTrue(decision.missing); assertTrue(decision.pending); assertFalse(decision.shouldNotify)
  }

  @Test fun `a future excursion start is treated as now`() {
    val delayed = config.copy(highPersistMinutes = 15)
    val decision = evaluate(15.0, episode(GlucoseAlarmKind.HIGH, notified = null, start = now + 60 * minute), delayed)
    assertEquals(now, decision.excursionStartedAt); assertTrue(decision.pending)
  }

  @Test fun `returning to range ends a waiting high`() {
    val delayed = config.copy(highPersistMinutes = 15)
    assertNull(evaluate(8.0, episode(GlucoseAlarmKind.HIGH, notified = null, start = now - 5 * minute), delayed).kind)
  }

  // Automatic low pause after a logged hypo treatment

  @Test fun `a logged hypo treatment pauses low but never urgent low`() {
    val pause = elapsed + 15 * minute
    val low = evaluate(3.5, lowPause = pause)
    assertEquals(GlucoseAlarmKind.LOW, low.kind); assertFalse(low.shouldNotify)
    val urgent = evaluate(2.8, lowPause = pause)
    assertEquals(GlucoseAlarmKind.URGENT_LOW, urgent.kind); assertTrue(urgent.shouldNotify)
    assertTrue(evaluate(15.0, lowPause = pause).shouldNotify)
  }

  @Test fun `low alerts resume when the pause ends`() {
    val pause = elapsed + 15 * minute
    assertFalse(evaluate(3.5, lowPause = pause, monotonic = pause - 1).shouldNotify)
    assertTrue(evaluate(3.5, lowPause = pause, monotonic = pause).shouldNotify)
  }

  @Test fun `hypo pause length is counted from the treatment and bounded`() {
    assertEquals(now + 15 * minute, GlucoseAlarmPolicy.hypoTreatmentPauseUntil(config, now, now))
    assertEquals(now + 10 * minute, GlucoseAlarmPolicy.hypoTreatmentPauseUntil(config, now - 5 * minute, now))
    assertNull(GlucoseAlarmPolicy.hypoTreatmentPauseUntil(config, now - 20 * minute, now))
    // A slightly future clock never extends the pause beyond the chosen length.
    assertEquals(now + 15 * minute, GlucoseAlarmPolicy.hypoTreatmentPauseUntil(config, now + minute, now))
    assertNull(GlucoseAlarmPolicy.hypoTreatmentPauseUntil(config, now + 3 * minute, now))
  }

  @Test fun `hypo pause does nothing when turned off or alerts are off`() {
    assertNull(GlucoseAlarmPolicy.hypoTreatmentPauseUntil(null, now, now))
    assertNull(GlucoseAlarmPolicy.hypoTreatmentPauseUntil(config.copy(hypoTreatmentSnoozeMinutes = 0), now, now))
    assertNull(GlucoseAlarmPolicy.hypoTreatmentPauseUntil(config.copy(hypoTreatmentSnoozeMinutes = 7), now, now))
    assertNull(GlucoseAlarmPolicy.hypoTreatmentPauseUntil(config.copy(lowEnabled = false), now, now))
    assertNull(GlucoseAlarmPolicy.hypoTreatmentPauseUntil(config.copy(enabled = false), now, now))
    for (minutes in listOf(10, 15, 20, 30)) {
      assertEquals(now + minutes * minute,
        GlucoseAlarmPolicy.hypoTreatmentPauseUntil(config.copy(hypoTreatmentSnoozeMinutes = minutes), now, now))
    }
  }

  // Upgrading older saved choices: see GlucoseAlarmUpgradeAndSnoozeCarryTest.
}
