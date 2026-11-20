package io.github.gregorgregor25.t1arc.glucosedisplay

import org.junit.Assert.*
import org.junit.Test

/**
 * "Silence this alert" ends a snooze that is still running, so the old snooze
 * end cannot sound again by itself. Later reminders follow the repeat setting
 * from the silence (urgent low: at least every 30 minutes), and a low paused
 * after a logged hypo treatment is still checked again when the pause ends.
 */
class GlucoseAlarmSilenceTest {
  private val now = 10_000_000L
  private val elapsed = 2_000_000L
  private val source = "1:2:aaps"
  private val minute = 60_000L
  private val config = GlucoseAlarmPolicyConfig(enabled = true, urgentLowEnabled = true, urgentLowThreshold = 3.0,
    lowThreshold = 3.9)
  private val never = config.copy(repeatMinutes = 0)

  /** The policy [after] milliseconds from now, with the low pause end the engine would pass then. */
  private fun evaluate(value: Double, previous: GlucoseAlarmEpisode, config: GlucoseAlarmPolicyConfig, after: Long,
    lowPause: Long? = null) =
    GlucoseAlarmPolicy.evaluate(config, GlucoseAlarmObservation(value, now + after), previous, source, now + after,
      elapsed + after, 2, 12 * 60, lowPause)

  /** An alert of [kind] that sounded and was then snoozed by the user [snoozedAgo] ago for [length]. */
  private fun snoozed(kind: GlucoseAlarmKind, snoozedAgo: Long, length: Long) = GlucoseAlarmEpisode("episode", kind,
    source, now - 20 * minute, lastNotifiedElapsed = elapsed - snoozedAgo, bootCount = 2,
    snoozeUntilElapsed = elapsed - snoozedAgo + length, snoozeUntilWall = now - snoozedAgo + length,
    snoozedAtElapsed = elapsed - snoozedAgo, userSnoozeUntilElapsed = elapsed - snoozedAgo + length)

  private fun silence(episode: GlucoseAlarmEpisode) = GlucoseAlarmPolicy.episodeAfterAcknowledge(episode, elapsed, null, null)

  @Test fun `silencing a snoozed alert clears the snooze and records the silence`() {
    val silenced = silence(snoozed(GlucoseAlarmKind.LOW, snoozedAgo = 5 * minute, length = 30 * minute))
    assertTrue(silenced.acknowledged)
    assertEquals(elapsed, silenced.lastNotifiedElapsed)
    assertNull(silenced.snoozeUntilElapsed); assertNull(silenced.snoozeUntilWall)
    assertNull(silenced.snoozedAtElapsed); assertNull(silenced.userSnoozeUntilElapsed)
  }

  @Test fun `with reminders set to Never the old snooze end does not sound again`() {
    for ((kind, value) in listOf(GlucoseAlarmKind.LOW to 3.5, GlucoseAlarmKind.HIGH to 15.0)) {
      // Snoozed for 30 minutes 5 minutes ago, then silenced: the snooze would have ended 25 minutes from now.
      val silenced = silence(snoozed(kind, snoozedAgo = 5 * minute, length = 30 * minute))
      for (after in listOf(25 * minute, 26 * minute, 3 * 60 * minute)) {
        val decision = evaluate(value, silenced, never, after)
        assertEquals(kind, decision.kind); assertFalse("$kind after ${after / minute} minutes", decision.shouldNotify)
      }
    }
  }

  @Test fun `after silencing, reminders follow the repeat interval counted from the silence`() {
    val silenced = silence(snoozed(GlucoseAlarmKind.LOW, snoozedAgo = 5 * minute, length = 60 * minute))
    val every15 = config.copy(repeatMinutes = 15)
    assertFalse(evaluate(3.5, silenced, every15, after = 15 * minute - 1).shouldNotify)
    assertTrue(evaluate(3.5, silenced, every15, after = 15 * minute).shouldNotify)
  }

  @Test fun `a silenced urgent low still reminds after 30 minutes when reminders are Never`() {
    val silenced = silence(snoozed(GlucoseAlarmKind.URGENT_LOW, snoozedAgo = 5 * minute, length = 30 * minute))
    // The old snooze would have ended after 25 minutes; only the 30-minute urgent low reminder applies now.
    assertFalse(evaluate(2.8, silenced, never, after = 25 * minute).shouldNotify)
    assertFalse(evaluate(2.8, silenced, never, after = 30 * minute - 1).shouldNotify)
    assertTrue(evaluate(2.8, silenced, never, after = 30 * minute).shouldNotify)
  }

  @Test fun `a silenced low falling to urgent low alerts at once instead of keeping the old snooze`() {
    val silenced = silence(snoozed(GlucoseAlarmKind.LOW, snoozedAgo = 5 * minute, length = 15 * minute))
    val urgent = evaluate(2.8, silenced, config, after = minute)
    assertEquals(GlucoseAlarmKind.URGENT_LOW, urgent.kind)
    assertTrue(urgent.shouldNotify); assertNull(urgent.carriedSnoozeUntilElapsed)
  }

  @Test fun `silencing during a hypo-treatment pause keeps the check when the pause ends`() {
    val sounded = GlucoseAlarmEpisode("episode", GlucoseAlarmKind.LOW, source, now - 5 * minute,
      lastNotifiedElapsed = elapsed - minute, bootCount = 2)
    val paused = GlucoseAlarmPolicy.episodeAfterHypoPause(sounded, elapsed + 15 * minute, now + 15 * minute, 2)
    val silenced = GlucoseAlarmPolicy.episodeAfterAcknowledge(paused, elapsed, elapsed + 15 * minute, now + 15 * minute)
    assertTrue(silenced.acknowledged)
    assertEquals(elapsed + 15 * minute, silenced.snoozeUntilElapsed)
    assertEquals(now + 15 * minute, silenced.snoozeUntilWall)
    assertFalse(evaluate(3.5, silenced, never, after = 15 * minute - 1, lowPause = elapsed + 15 * minute).shouldNotify)
    // The pause has ended, so the engine passes none: still low, so it sounds once more.
    assertTrue(evaluate(3.5, silenced, never, after = 15 * minute).shouldNotify)
  }

  @Test fun `silencing drops a user snooze but keeps a running hypo-treatment pause check`() {
    // Snoozed for an hour 5 minutes ago; a logged treatment then paused low alerts until 10 minutes from now.
    val silenced = GlucoseAlarmPolicy.episodeAfterAcknowledge(
      snoozed(GlucoseAlarmKind.LOW, snoozedAgo = 5 * minute, length = 60 * minute), elapsed,
      elapsed + 10 * minute, now + 10 * minute)
    assertEquals(elapsed + 10 * minute, silenced.snoozeUntilElapsed)
    assertNull(silenced.snoozedAtElapsed); assertNull(silenced.userSnoozeUntilElapsed)
    assertTrue(evaluate(3.5, silenced, never, after = 10 * minute).shouldNotify)
    // Falling to urgent low during the pause alerts at once: the user snooze no longer carries.
    val urgent = evaluate(2.8, silenced, never, after = minute, lowPause = elapsed + 10 * minute)
    assertTrue(urgent.shouldNotify); assertNull(urgent.carriedSnoozeUntilElapsed)
  }

  @Test fun `only an ordinary low with a pause still running keeps a check`() {
    val pauseEnd = elapsed + 10 * minute
    for (kind in listOf(GlucoseAlarmKind.HIGH, GlucoseAlarmKind.URGENT_LOW)) {
      val silenced = GlucoseAlarmPolicy.episodeAfterAcknowledge(snoozed(kind, 5 * minute, 30 * minute), elapsed,
        pauseEnd, now + 10 * minute)
      assertNull(silenced.snoozeUntilElapsed); assertNull(silenced.snoozeUntilWall)
    }
    val ended = GlucoseAlarmPolicy.episodeAfterAcknowledge(snoozed(GlucoseAlarmKind.LOW, 5 * minute, 30 * minute),
      elapsed, elapsed, now)
    assertNull(ended.snoozeUntilElapsed); assertNull(ended.snoozeUntilWall)
  }
}
