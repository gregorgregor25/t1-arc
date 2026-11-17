package io.github.gregorgregor25.t1arc.glucosedisplay

import org.junit.Assert.*
import org.junit.Test

/**
 * Upgrading must not change how existing alarms behave, and a snoozed low
 * that deepens into urgent low keeps the user's snooze, capped at 30 minutes
 * from when the snooze started.
 */
class GlucoseAlarmUpgradeAndSnoozeCarryTest {
  private val now = 10_000_000L
  private val elapsed = 2_000_000L
  private val source = "1:2:aaps"
  private val minute = 60_000L
  private val config = GlucoseAlarmPolicyConfig(enabled = true, urgentLowEnabled = true, urgentLowThreshold = 3.0,
    lowThreshold = 3.9)

  private fun evaluate(value: Double, previous: GlucoseAlarmEpisode?, config: GlucoseAlarmPolicyConfig = this.config,
    monotonic: Long = elapsed, wall: Long = now, lowPause: Long? = null) =
    GlucoseAlarmPolicy.evaluate(config, GlucoseAlarmObservation(value, wall), previous, source, wall, monotonic, 2,
      12 * 60, lowPause)

  /** A low that sounded and was then snoozed by the user [snoozedAgo] ago for [length]. */
  private fun snoozedLow(snoozedAgo: Long, length: Long) = GlucoseAlarmEpisode("low", GlucoseAlarmKind.LOW, source,
    now - 20 * minute, lastNotifiedElapsed = elapsed - snoozedAgo, bootCount = 2,
    snoozeUntilElapsed = elapsed - snoozedAgo + length, snoozeUntilWall = now - snoozedAgo + length,
    snoozedAtElapsed = elapsed - snoozedAgo)

  // Upgrading version 1 choices

  private val version1 = mapOf<String, Any?>("schemaVersion" to 1.0, "enabled" to true, "audioEnabled" to true,
    "lowEnabled" to true, "lowThresholdMmolL" to 3.9, "lowSound" to "pulse", "repeatMinutes" to 0.0)

  @Test fun `upgraded version 1 choices keep urgent low off and every existing switch unchanged`() {
    for (low in listOf(true, false)) {
      val upgraded = GlucoseAlarmPolicy.upgradeVersion1(version1 + ("lowEnabled" to low))
      assertEquals(false, upgraded["urgentLowEnabled"])
      assertEquals(2.0, upgraded["schemaVersion"])
      assertEquals(true, upgraded["enabled"]); assertEquals(true, upgraded["audioEnabled"])
      assertEquals(low, upgraded["lowEnabled"]); assertEquals(0.0, upgraded["repeatMinutes"])
      assertEquals("pulse", upgraded["urgentLowSound"])
      assertEquals(0.0, upgraded["highPersistMinutes"])
      // No new automatic low pause after a logged hypo treatment either.
      assertEquals(0.0, upgraded["hypoTreatmentSnoozeMinutes"])
    }
  }

  @Test fun `the upgrade keeps a valid suggested urgent low level ready for the user to add`() {
    assertEquals(3.0, GlucoseAlarmPolicy.upgradeVersion1(version1)["urgentLowThresholdMmolL"] as Double, 1e-9)
    assertEquals(2.8, GlucoseAlarmPolicy.upgradeVersion1(version1 + ("lowThresholdMmolL" to 3.0))["urgentLowThresholdMmolL"] as Double, 1e-9)
    // No level 2.0 mmol/L or above fits below this low level; urgent low stays off at the lowest level.
    assertEquals(2.0, GlucoseAlarmPolicy.upgradeVersion1(version1 + ("lowThresholdMmolL" to 2.1))["urgentLowThresholdMmolL"] as Double, 1e-9)
  }

  @Test fun `the suggested urgent low level is 3_0 or just below a low level already at or under 3_0`() {
    assertEquals(3.0, GlucoseAlarmPolicy.suggestedUrgentLowThreshold(3.9)!!, 1e-9)
    assertEquals(2.8, GlucoseAlarmPolicy.suggestedUrgentLowThreshold(3.0)!!, 1e-9)
    assertEquals(2.3, GlucoseAlarmPolicy.suggestedUrgentLowThreshold(2.5)!!, 1e-9)
    assertNull(GlucoseAlarmPolicy.suggestedUrgentLowThreshold(2.1))
    assertNull(GlucoseAlarmPolicy.suggestedUrgentLowThreshold(Double.NaN))
  }

  @Test fun `an upgraded configuration never repeats a low within 30 minutes when reminders are Never`() {
    val upgraded = config.copy(urgentLowEnabled = false, repeatMinutes = 0)
    val sounded = GlucoseAlarmEpisode("low", GlucoseAlarmKind.LOW, source, now - 40 * minute,
      lastNotifiedElapsed = elapsed - 40 * minute, bootCount = 2, acknowledged = true)
    val decision = evaluate(2.5, sounded, upgraded)
    assertEquals(GlucoseAlarmKind.LOW, decision.kind); assertFalse(decision.shouldNotify)
  }

  // Snooze carry-over from low to urgent low

  @Test fun `a snoozed low deepening into urgent low stays snoozed until the snooze ends`() {
    val decision = evaluate(2.8, snoozedLow(snoozedAgo = 5 * minute, length = 15 * minute))
    assertEquals(GlucoseAlarmKind.URGENT_LOW, decision.kind)
    assertFalse(decision.keepPrevious); assertFalse(decision.shouldNotify)
    assertEquals(elapsed + 10 * minute, decision.carriedSnoozeUntilElapsed)
    assertEquals(now + 10 * minute, decision.carriedSnoozeUntilWall)
    assertEquals(elapsed - 5 * minute, decision.carriedSnoozedAtElapsed)
  }

  @Test fun `a carried snooze never lasts beyond 30 minutes from when it started`() {
    val decision = evaluate(2.8, snoozedLow(snoozedAgo = 10 * minute, length = 60 * minute))
    assertFalse(decision.shouldNotify)
    assertEquals(elapsed + 20 * minute, decision.carriedSnoozeUntilElapsed)
    assertEquals(now + 20 * minute, decision.carriedSnoozeUntilWall)
  }

  @Test fun `urgent low sounds straight away when the snooze started 30 or more minutes ago`() {
    for (ago in listOf(30 * minute, 45 * minute)) {
      val decision = evaluate(2.8, snoozedLow(snoozedAgo = ago, length = 60 * minute))
      assertEquals(GlucoseAlarmKind.URGENT_LOW, decision.kind)
      assertTrue(decision.shouldNotify); assertNull(decision.carriedSnoozeUntilElapsed)
    }
  }

  @Test fun `the carried urgent low snooze sounds when it ends`() {
    val carried = evaluate(2.8, snoozedLow(snoozedAgo = 5 * minute, length = 15 * minute))
    val urgent = GlucoseAlarmEpisode("urgent", GlucoseAlarmKind.URGENT_LOW, source, now, bootCount = 2,
      snoozeUntilElapsed = carried.carriedSnoozeUntilElapsed, snoozeUntilWall = carried.carriedSnoozeUntilWall,
      snoozedAtElapsed = carried.carriedSnoozedAtElapsed)
    assertFalse(evaluate(2.8, urgent, monotonic = elapsed + 10 * minute - 1).shouldNotify)
    assertTrue(evaluate(2.8, urgent, monotonic = elapsed + 10 * minute).shouldNotify)
  }

  @Test fun `an unsnoozed, silenced or expired low still alerts straight away as urgent low`() {
    val sounded = GlucoseAlarmEpisode("low", GlucoseAlarmKind.LOW, source, now - 5 * minute,
      lastNotifiedElapsed = elapsed - minute, bootCount = 2)
    assertTrue(evaluate(2.8, sounded).shouldNotify)
    assertTrue(evaluate(2.8, sounded.copy(acknowledged = true)).shouldNotify)
    assertTrue(evaluate(2.8, snoozedLow(snoozedAgo = 10 * minute, length = 10 * minute)).shouldNotify)
  }

  @Test fun `a hypo-treatment pause or an older saved snooze is not carried into urgent low`() {
    // The automatic pause after a logged hypo treatment records no user snooze start.
    val paused = snoozedLow(snoozedAgo = minute, length = 15 * minute).copy(snoozedAtElapsed = null)
    assertTrue(evaluate(2.8, paused, lowPause = elapsed + 14 * minute).shouldNotify)
    assertTrue(evaluate(2.8, paused).shouldNotify)
  }

  @Test fun `a hypo-treatment pause after a user snooze keeps the user snooze for urgent low`() {
    // Snoozed 10 minutes for a low 2 minutes ago, then a logged treatment pauses low for 20 minutes.
    val snoozed = snoozedLow(snoozedAgo = 2 * minute, length = 10 * minute)
    val paused = GlucoseAlarmPolicy.episodeAfterHypoPause(snoozed, elapsed + 20 * minute, now + 20 * minute, 2)
    assertEquals(elapsed - 2 * minute, paused.snoozedAtElapsed)
    assertEquals(elapsed + 8 * minute, paused.userSnoozeUntilElapsed)
    assertEquals(elapsed + 20 * minute, paused.snoozeUntilElapsed)
    // Five minutes later the reading falls to urgent low: still within the user's own snooze.
    val urgent = evaluate(2.8, paused, monotonic = elapsed + 5 * minute, wall = now + 5 * minute,
      lowPause = elapsed + 20 * minute)
    assertFalse(urgent.shouldNotify)
    assertEquals(elapsed + 8 * minute, urgent.carriedSnoozeUntilElapsed)
    // After the user's snooze ends, urgent low sounds although the automatic low pause is still running.
    assertTrue(evaluate(2.8, paused, monotonic = elapsed + 8 * minute, wall = now + 8 * minute,
      lowPause = elapsed + 20 * minute).shouldNotify)
  }

  @Test fun `a hypo-treatment pause without a user snooze is still not carried`() {
    val sounded = GlucoseAlarmEpisode("low", GlucoseAlarmKind.LOW, source, now - 5 * minute,
      lastNotifiedElapsed = elapsed - minute, bootCount = 2)
    val paused = GlucoseAlarmPolicy.episodeAfterHypoPause(sounded, elapsed + 15 * minute, now + 15 * minute, 2)
    assertNull(paused.userSnoozeUntilElapsed); assertNull(paused.snoozedAtElapsed)
    assertTrue(evaluate(2.8, paused, lowPause = elapsed + 15 * minute).shouldNotify)
  }

  @Test fun `a snooze from another boot or another source is not carried`() {
    val low = snoozedLow(snoozedAgo = 5 * minute, length = 15 * minute)
    assertTrue(GlucoseAlarmPolicy.evaluate(config, GlucoseAlarmObservation(2.8, now), low, source, now, elapsed, 3, 12 * 60)
      .shouldNotify)
    assertTrue(GlucoseAlarmPolicy.evaluate(config, GlucoseAlarmObservation(2.8, now), low, "other", now, elapsed, 2, 12 * 60)
      .shouldNotify)
  }

  @Test fun `a snoozed high is never carried into urgent low`() {
    val high = snoozedLow(snoozedAgo = minute, length = 15 * minute).copy(kind = GlucoseAlarmKind.HIGH)
    assertTrue(evaluate(2.8, high).shouldNotify)
  }
}
