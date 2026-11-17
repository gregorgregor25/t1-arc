package io.github.gregorgregor25.t1arc.glucosedisplay

import org.junit.Assert.*
import org.junit.Test

class GlucoseAlarmArmingPolicyTest {
  private val armed = GlucoseAlarmReadinessInput(configured = true, configurationReadable = true, enabled = true, audioEnabled = true)
  private fun resolve(input: GlucoseAlarmReadinessInput) = GlucoseAlarmArmingPolicy.resolve(input)

  @Test fun `saved armed choice stays armed in a new process without opening settings`() {
    // A process restart, reboot or app update only re-reads the saved choice.
    val first = resolve(armed)
    val afterRestart = resolve(armed.copy())
    assertTrue(first.alertsActive); assertTrue(first.audioArmed)
    assertEquals(first, afterRestart)
    assertTrue(afterRestart.issues.isEmpty())
    assertNull(afterRestart.ongoingWarning)
    // Saving the same choices again is not needed and does not force a restart.
    assertFalse(GlucoseAlarmPolicy.shouldRestartAudio(afterRestart.audioArmed, false, false, false))
  }

  @Test fun `alarms the user turned off stay off and never warn`() {
    val off = resolve(armed.copy(enabled = false, appNotificationsAllowed = false, monitorRunning = false,
      alarmStreamVolume = 0, exactAlarmsAllowed = false))
    assertFalse(off.alertsActive); assertFalse(off.audioArmed)
    assertTrue(off.issues.isEmpty()); assertNull(off.ongoingWarning)
  }

  @Test fun `never configured is not armed and not a warning`() {
    val state = resolve(GlucoseAlarmReadinessInput(configured = false, configurationReadable = false, enabled = false, audioEnabled = false))
    assertFalse(state.alertsActive); assertFalse(state.audioArmed)
    assertTrue(state.issues.isEmpty()); assertNull(state.ongoingWarning)
  }

  @Test fun `silent alerts stay active without sound checks`() {
    val state = resolve(armed.copy(audioEnabled = false, alarmStreamVolume = 0, appVolume = 0f, dndTotalSilence = true))
    assertTrue(state.alertsActive); assertFalse(state.audioArmed)
    assertTrue(state.issues.isEmpty())
  }

  @Test fun `unreadable saved choices fail closed with a warning`() {
    val state = resolve(armed.copy(configurationReadable = false))
    assertFalse(state.alertsActive); assertFalse(state.audioArmed)
    assertEquals(listOf(GlucoseAlarmReadinessIssue.CONFIGURATION_UNREADABLE), state.issues)
    assertEquals("Alarms need attention · open T1 Arc", state.ongoingWarning)
  }

  @Test fun `Android notification blocks are reported`() {
    val app = resolve(armed.copy(appNotificationsAllowed = false, channelAllowed = false))
    assertEquals(listOf(GlucoseAlarmReadinessIssue.NOTIFICATIONS_BLOCKED), app.issues)
    assertEquals("Alarm sound needs attention · open T1 Arc", app.ongoingWarning)
    val channel = resolve(armed.copy(channelAllowed = false))
    assertEquals(listOf(GlucoseAlarmReadinessIssue.CHANNEL_BLOCKED), channel.issues)
  }

  @Test fun `audio problems are reported only when sound is armed`() {
    val state = resolve(armed.copy(playbackBlocked = true, alarmStreamVolume = 0, appVolume = 0f, dndTotalSilence = true,
      customSoundMissing = true, monitorRunning = false))
    assertTrue(state.audioArmed)
    assertEquals(setOf(
      GlucoseAlarmReadinessIssue.MONITOR_STOPPED, GlucoseAlarmReadinessIssue.PLAYBACK_BLOCKED,
      GlucoseAlarmReadinessIssue.ALARM_VOLUME_ZERO, GlucoseAlarmReadinessIssue.APP_VOLUME_ZERO,
      GlucoseAlarmReadinessIssue.DO_NOT_DISTURB_SILENCES_ALARMS, GlucoseAlarmReadinessIssue.CUSTOM_SOUND_MISSING,
    ), state.issues.toSet())
    assertEquals("Alarm sound needs attention · open T1 Arc", state.ongoingWarning)
  }

  @Test fun `issues that do not stop sound use the general warning`() {
    val exact = resolve(armed.copy(exactAlarmsAllowed = false))
    assertTrue(exact.audioArmed)
    assertEquals(listOf(GlucoseAlarmReadinessIssue.EXACT_ALARMS_DENIED), exact.issues)
    assertEquals("Alarms need attention · open T1 Arc", exact.ongoingWarning)
    val missingSound = resolve(armed.copy(customSoundMissing = true))
    assertEquals("Alarms need attention · open T1 Arc", missingSound.ongoingWarning)
  }

  @Test fun `ongoing warnings never contain glucose values`() {
    for (issue in GlucoseAlarmReadinessIssue.entries) {
      assertFalse(issue.message.contains("mmol")); assertFalse(issue.message.contains("mg/dL"))
    }
  }
}
