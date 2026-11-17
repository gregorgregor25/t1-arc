package io.github.gregorgregor25.t1arc.glucosedisplay

import kotlin.math.roundToInt

/** Pure policy, shared by native intake, watchdog and actions. No Android or audio calls. */
internal enum class GlucoseAlarmKind(val wire: String) {
  URGENT_LOW("urgentLow"), LOW("low"), HIGH("high"), VERY_HIGH("veryHigh"), STALE("stale");
  companion object { fun parse(value: String?) = entries.firstOrNull { it.wire == value } }
}

internal data class GlucoseAlarmPolicyConfig(
  val enabled: Boolean = false,
  val urgentLowEnabled: Boolean = false,
  val urgentLowThreshold: Double = 3.0,
  val lowEnabled: Boolean = true,
  val lowThreshold: Double = 3.9,
  val highEnabled: Boolean = true,
  val highThreshold: Double = 13.9,
  val veryHighEnabled: Boolean = false,
  val veryHighThreshold: Double? = null,
  val staleEnabled: Boolean = false,
  val repeatMinutes: Int = 30,
  val nightEnabled: Boolean = false,
  val nightStart: Int = 23 * 60,
  val nightEnd: Int = 7 * 60,
  /** High and very high only. Lows and missing readings are never delayed. */
  val highPersistMinutes: Int = 0,
  /** 0 turns the automatic low pause after a logged hypo treatment off. */
  val hypoTreatmentSnoozeMinutes: Int = 0,
)

internal data class GlucoseAlarmObservation(
  val mmolL: Double,
  val timestamp: Long,
  val live: Boolean = true,
  val hasError: Boolean = false,
)

internal data class GlucoseAlarmEpisode(
  val id: String,
  val kind: GlucoseAlarmKind,
  val sourceIdentity: String,
  val createdAt: Long,
  val lastNotifiedElapsed: Long? = null,
  val acknowledged: Boolean = false,
  val snoozeUntilElapsed: Long? = null,
  val snoozeUntilWall: Long? = null,
  val bootCount: Int,
  /** Wall time the reading first went beyond the high threshold; null means createdAt. */
  val excursionStartedAt: Long? = null,
  /**
   * A high that was still waiting out its delay when readings stopped. It is
   * kept beside a missing-reading alert, never shown or sounded by itself.
   */
  val heldHighKind: GlucoseAlarmKind? = null,
  val heldHighStartedAt: Long? = null,
  /**
   * Elapsed time the user chose a snooze. Null when no user snooze is known
   * (none chosen, or saved before this was recorded); only a user snooze with
   * a known start can carry into urgent low.
   */
  val snoozedAtElapsed: Long? = null,
  /**
   * When the user's own snooze ends. Kept apart from [snoozeUntilElapsed],
   * which the automatic pause after a logged hypo treatment can lengthen, so
   * that pause never wipes out or extends a user snooze carried into urgent
   * low. Null for snoozes saved before this was recorded: then
   * [snoozeUntilElapsed] is the user's own end.
   */
  val userSnoozeUntilElapsed: Long? = null,
)

internal data class GlucoseAlarmDecision(
  val kind: GlucoseAlarmKind?,
  val missing: Boolean,
  val shouldNotify: Boolean,
  val silent: Boolean,
  val keepPrevious: Boolean,
  /** A high that has not yet stayed out of range for the chosen time: no notification, no sound. */
  val pending: Boolean = false,
  val pendingUntilWall: Long? = null,
  val excursionStartedAt: Long? = null,
  /** An unconfirmed high carried by a missing-reading alert; see [GlucoseAlarmEpisode.heldHighKind]. */
  val heldHighKind: GlucoseAlarmKind? = null,
  val heldHighStartedAt: Long? = null,
  /** A snoozed low that deepened into urgent low: the new episode starts with this capped snooze. */
  val carriedSnoozeUntilElapsed: Long? = null,
  val carriedSnoozeUntilWall: Long? = null,
  val carriedSnoozedAtElapsed: Long? = null,
)

internal object GlucoseAlarmPolicy {
  const val STALE_MS = 12 * 60_000L
  const val MAX_SNOOZE_MS = 24 * 60 * 60_000L
  const val URGENT_LOW_MAX_SNOOZE_MS = 30 * 60_000L
  const val URGENT_LOW_MAX_REPEAT_MINUTES = 30
  const val FUTURE_ALLOWANCE_MS = 120_000L
  /** Normal re-evaluation cadence while an alert or a waiting high is active. */
  const val CHECK_INTERVAL_MS = 60_000L
  const val DEFAULT_URGENT_LOW_MMOL = 3.0
  const val DEFAULT_HYPO_TREATMENT_SNOOZE_MINUTES = 15
  val PERSIST_MINUTES = setOf(0, 5, 10, 15, 20, 30)
  val HYPO_TREATMENT_SNOOZE_MINUTES = setOf(0, 10, 15, 20, 30)
  private val DELAYABLE = setOf(GlucoseAlarmKind.HIGH, GlucoseAlarmKind.VERY_HIGH)

  fun shouldRestartAudio(wasArmed: Boolean, blocked: Boolean, hasPlayer: Boolean, configurationChanged: Boolean) =
    !wasArmed || blocked || (hasPlayer && configurationChanged)

  fun categoryEnabled(config: GlucoseAlarmPolicyConfig, kind: GlucoseAlarmKind): Boolean = when (kind) {
    GlucoseAlarmKind.URGENT_LOW -> config.urgentLowEnabled
    GlucoseAlarmKind.LOW -> config.lowEnabled
    GlucoseAlarmKind.HIGH -> config.highEnabled
    GlucoseAlarmKind.VERY_HIGH -> config.veryHighEnabled
    GlucoseAlarmKind.STALE -> config.staleEnabled
  }

  fun soundRequired(config: GlucoseAlarmPolicyConfig, audioEnabled: Boolean, kind: GlucoseAlarmKind): Boolean =
    config.enabled && audioEnabled && categoryEnabled(config, kind)

  /** A pending monitor start is not a delivered notification or an audio failure. */
  fun canDeliver(appNotificationsAllowed: Boolean, channelAllowed: Boolean, wantsAudio: Boolean, monitorReady: Boolean) =
    appNotificationsAllowed && channelAllowed && (!wantsAudio || monitorReady)

  fun isNight(config: GlucoseAlarmPolicyConfig, minuteOfDay: Int): Boolean {
    if (!config.nightEnabled || config.nightStart == config.nightEnd) return false
    return if (config.nightStart < config.nightEnd) minuteOfDay >= config.nightStart && minuteOfDay < config.nightEnd
      else minuteOfDay >= config.nightStart || minuteOfDay < config.nightEnd
  }

  /**
   * Only ordinary high is quietened by the night schedule. Urgent low, low,
   * very high and missing readings always keep their chosen sound.
   */
  fun silentAtNight(kind: GlucoseAlarmKind) = kind == GlucoseAlarmKind.HIGH

  fun maxSnoozeMs(kind: GlucoseAlarmKind) = if (kind == GlucoseAlarmKind.URGENT_LOW) URGENT_LOW_MAX_SNOOZE_MS else MAX_SNOOZE_MS

  /** Urgent low always reminds again within 30 minutes, even after "Silence" or "Never". */
  fun effectiveRepeatMinutes(config: GlucoseAlarmPolicyConfig, kind: GlucoseAlarmKind): Int =
    if (kind != GlucoseAlarmKind.URGENT_LOW) config.repeatMinutes
    else if (config.repeatMinutes <= 0 || config.repeatMinutes > URGENT_LOW_MAX_REPEAT_MINUTES) URGENT_LOW_MAX_REPEAT_MINUTES
    else config.repeatMinutes

  /**
   * The urgent-low level offered to someone whose saved choices predate urgent
   * low: 3.0 mmol/L, or 0.2 mmol/L below a low level already at or under 3.0.
   * Null when no level of at least 2.0 mmol/L fits below the low level.
   */
  fun suggestedUrgentLowThreshold(lowThreshold: Double): Double? {
    if (!lowThreshold.isFinite()) return null
    val threshold = if (lowThreshold > DEFAULT_URGENT_LOW_MMOL) DEFAULT_URGENT_LOW_MMOL
      else ((lowThreshold - 0.2) * 10).roundToInt() / 10.0
    return threshold.takeIf { it >= 2.0 && it < lowThreshold }
  }

  /**
   * Version 1 choices (saved before urgent low, the high delay and the hypo
   * pause existed) are upgraded so existing alarms behave exactly as before:
   * urgent low stays off (settings offer it; only the user can add it), there
   * is no high delay and no automatic low pause. The master switch and the
   * sound switch are never changed.
   */
  fun upgradeVersion1(fields: Map<String, Any?>): Map<String, Any?> {
    val low = (fields["lowThresholdMmolL"] as? Number)?.toDouble() ?: return fields
    return fields + mapOf(
      "schemaVersion" to 2.0,
      "urgentLowEnabled" to false,
      "urgentLowThresholdMmolL" to (suggestedUrgentLowThreshold(low) ?: 2.0),
      "urgentLowSound" to fields["lowSound"],
      "highPersistMinutes" to 0.0,
      "hypoTreatmentSnoozeMinutes" to 0.0,
    )
  }

  private data class HeldHigh(val kind: GlucoseAlarmKind, val startedAt: Long)

  /**
   * A same-source high that has not been confirmed yet: still inside its delay
   * and never notified, or one already carried by a missing-reading alert.
   */
  private fun heldHigh(config: GlucoseAlarmPolicyConfig, previous: GlucoseAlarmEpisode): HeldHigh? {
    if (config.highPersistMinutes <= 0) return null
    val held = when {
      previous.kind == GlucoseAlarmKind.STALE -> {
        val kind = previous.heldHighKind ?: return null
        HeldHigh(kind, previous.heldHighStartedAt ?: return null)
      }
      previous.kind in DELAYABLE && previous.lastNotifiedElapsed == null ->
        HeldHigh(previous.kind, previous.excursionStartedAt ?: previous.createdAt)
      else -> return null
    }
    return held.takeIf { it.kind in DELAYABLE && categoryEnabled(config, it.kind) }
  }

  /**
   * Next wake-up while a high waits out its delay. A deadline that has already
   * been reached is never scheduled again straight away: it has just been
   * evaluated, so the normal cadence follows.
   */
  fun pendingCheckElapsed(pendingUntilWall: Long?, wallNow: Long, elapsedNow: Long): Long {
    val cadence = elapsedNow + CHECK_INTERVAL_MS
    val remaining = pendingUntilWall?.let { it - wallNow }?.takeIf { it > 0L } ?: return cadence
    return minOf(cadence, elapsedNow + remaining)
  }

  fun evaluate(
    config: GlucoseAlarmPolicyConfig,
    observation: GlucoseAlarmObservation?,
    previous: GlucoseAlarmEpisode?,
    identity: String,
    wallNow: Long,
    elapsedNow: Long,
    bootCount: Int,
    minuteOfDay: Int,
    lowPausedUntilElapsed: Long? = null,
  ): GlucoseAlarmDecision {
    if (!config.enabled) return GlucoseAlarmDecision(null, false, false, true, false)
    val sameSource = previous?.sourceIdentity == identity
    val missing = observation == null || !observation.live || observation.hasError ||
      observation.timestamp > wallNow + FUTURE_ALLOWANCE_MS || wallNow - observation.timestamp > STALE_MS ||
      !observation.mmolL.isFinite() || observation.mmolL !in 0.5..40.0
    if (missing) {
      val sourcePrevious = previous?.takeIf { sameSource }
      // Missing data can neither confirm nor end a high that is still waiting.
      val held = sourcePrevious?.let { heldHigh(config, it) }
      // A lost feed is never evidence that a preceding (notified) excursion recovered.
      val retained = sourcePrevious?.takeIf { held == null && it.kind != GlucoseAlarmKind.STALE && categoryEnabled(config, it.kind) }
      if (retained != null) {
        return GlucoseAlarmDecision(retained.kind, true, false, true, true,
          excursionStartedAt = retained.excursionStartedAt ?: retained.createdAt)
      }
      if (config.staleEnabled) {
        // The missing-reading alert is evaluated on its own. An unconfirmed
        // high never hides it; the high is carried separately until readings return.
        return notificationDecision(config, GlucoseAlarmKind.STALE, previous, sameSource,
          true, wallNow, elapsedNow, bootCount, minuteOfDay, lowPausedUntilElapsed)
          .copy(heldHighKind = held?.kind, heldHighStartedAt = held?.startedAt)
      }
      if (held != null) {
        // Hidden: no notification and no sound. Once the delay has passed
        // there is no deadline left to wait for, only the normal cadence.
        val deadline = held.startedAt + config.highPersistMinutes * 60_000L
        return GlucoseAlarmDecision(held.kind, true, false, true, sourcePrevious?.kind == held.kind, true,
          deadline.takeIf { it > wallNow }, held.startedAt)
      }
      return GlucoseAlarmDecision(null, true, false, true, false)
    }
    val value = requireNotNull(observation).mmolL
    val oldKind = previous?.takeIf { sameSource }?.kind
    val wasLow = oldKind == GlucoseAlarmKind.LOW || oldKind == GlucoseAlarmKind.URGENT_LOW
    val kind = when {
      config.urgentLowEnabled && (value <= config.urgentLowThreshold ||
        (oldKind == GlucoseAlarmKind.URGENT_LOW && value < config.urgentLowThreshold + 0.3)) -> GlucoseAlarmKind.URGENT_LOW
      config.lowEnabled && (value <= config.lowThreshold || (wasLow && value < config.lowThreshold + 0.3)) -> GlucoseAlarmKind.LOW
      config.veryHighEnabled && config.veryHighThreshold != null &&
        (value >= config.veryHighThreshold || (oldKind == GlucoseAlarmKind.VERY_HIGH && value > config.veryHighThreshold - 0.5)) -> GlucoseAlarmKind.VERY_HIGH
      config.highEnabled && (value >= config.highThreshold ||
        (oldKind == GlucoseAlarmKind.HIGH && value > config.highThreshold - 0.5)) -> GlucoseAlarmKind.HIGH
      else -> null
    }
    if (kind == null) return GlucoseAlarmDecision(null, false, false, true, false)
    return notificationDecision(config, kind, previous, sameSource, false, wallNow, elapsedNow, bootCount, minuteOfDay,
      lowPausedUntilElapsed)
  }

  private fun notificationDecision(
    config: GlucoseAlarmPolicyConfig,
    kind: GlucoseAlarmKind,
    previous: GlucoseAlarmEpisode?,
    sameSource: Boolean,
    missing: Boolean,
    wallNow: Long,
    elapsedNow: Long,
    bootCount: Int,
    minuteOfDay: Int,
    lowPausedUntilElapsed: Long?,
  ): GlucoseAlarmDecision {
    // Rising from urgent low into low continues the same episode instead of
    // sounding a second, new alarm. Falling from low into urgent low is new.
    val same = sameSource && previous != null &&
      (previous.kind == kind || (previous.kind == GlucoseAlarmKind.URGENT_LOW && kind == GlucoseAlarmKind.LOW))
    val previousSameBoot = previous?.bootCount == bootCount
    // A user snooze on a low that deepens into urgent low is respected, but
    // never for longer than urgent low allows: 30 minutes from when it started.
    val carriedSnoozeUntil = previous?.takeIf {
      kind == GlucoseAlarmKind.URGENT_LOW && it.kind == GlucoseAlarmKind.LOW && sameSource && previousSameBoot
    }?.let { low ->
      val startedAt = low.snoozedAtElapsed ?: return@let null
      val until = low.userSnoozeUntilElapsed ?: low.snoozeUntilElapsed ?: return@let null
      minOf(until, startedAt + URGENT_LOW_MAX_SNOOZE_MS).takeIf { it > elapsedNow }
    }
    val snoozed = (same && previousSameBoot && (previous?.snoozeUntilElapsed ?: 0L) > elapsedNow) || carriedSnoozeUntil != null
    val repeatMinutes = effectiveRepeatMinutes(config, kind)
    val repeatDue = same && repeatMinutes > 0 && previousSameBoot &&
      previous?.lastNotifiedElapsed != null && elapsedNow - previous.lastNotifiedElapsed >= repeatMinutes * 60_000L
    val snoozeExpired = same && previousSameBoot && previous?.snoozeUntilElapsed != null &&
      previous.snoozeUntilElapsed <= elapsedNow
    val first = !same || previous?.lastNotifiedElapsed == null || !previousSameBoot
    // Only ordinary low is paused after a logged hypo treatment; urgent low is not.
    val paused = kind == GlucoseAlarmKind.LOW && lowPausedUntilElapsed != null && lowPausedUntilElapsed > elapsedNow
    val inheritedStart = previous?.takeIf {
      same || (sameSource && it.kind in DELAYABLE && kind in DELAYABLE)
    }?.let { it.excursionStartedAt ?: it.createdAt }
      // A high held through a gap in readings keeps its original start.
      ?: previous?.takeIf { sameSource && it.kind == GlucoseAlarmKind.STALE && kind in DELAYABLE }?.heldHighStartedAt
    val start = (inheritedStart ?: wallNow).coerceAtMost(wallNow)
    val delayMs = if (kind in DELAYABLE) config.highPersistMinutes.coerceAtLeast(0) * 60_000L else 0L
    val alreadyNotified = same && previous?.lastNotifiedElapsed != null
    val pending = delayMs > 0 && !alreadyNotified && wallNow - start < delayMs
    return GlucoseAlarmDecision(kind, missing, !pending && !snoozed && !paused && (first || repeatDue || snoozeExpired),
      silentAtNight(kind) && isNight(config, minuteOfDay), same, pending,
      if (pending) start + delayMs else null, start,
      carriedSnoozeUntilElapsed = carriedSnoozeUntil,
      carriedSnoozeUntilWall = carriedSnoozeUntil?.let { wallNow + (it - elapsedNow) },
      carriedSnoozedAtElapsed = carriedSnoozeUntil?.let { previous?.snoozedAtElapsed })
  }

  /**
   * The low episode after the automatic pause that follows a logged hypo
   * treatment. The alert is held until [untilElapsed]; a user snooze already
   * running keeps its own start and end, so it still carries into urgent low
   * exactly as the user chose it.
   */
  fun episodeAfterHypoPause(current: GlucoseAlarmEpisode, untilElapsed: Long, untilWall: Long, bootCount: Int) =
    current.copy(snoozeUntilElapsed = untilElapsed, snoozeUntilWall = untilWall, bootCount = bootCount,
      userSnoozeUntilElapsed = current.snoozedAtElapsed?.let { current.userSnoozeUntilElapsed ?: current.snoozeUntilElapsed })

  fun snoozeUntil(wallNow: Long, elapsedNow: Long, untilWall: Long, kind: GlucoseAlarmKind = GlucoseAlarmKind.LOW): Long {
    val duration = untilWall - wallNow
    require(duration >= 1L) { "Choose a future snooze time." }
    require(duration <= maxSnoozeMs(kind)) {
      if (kind == GlucoseAlarmKind.URGENT_LOW) "Urgent low alerts can be snoozed for up to 30 minutes."
      else "Choose a future snooze time within the next 24 hours."
    }
    return elapsedNow + duration
  }

  /**
   * End of the automatic low pause after a logged hypo treatment, or null when
   * none applies. It is counted from the treatment time and never extends past
   * the chosen number of minutes from now.
   */
  fun hypoTreatmentPauseUntil(config: GlucoseAlarmPolicyConfig?, treatedAtWall: Long, wallNow: Long): Long? {
    if (config == null || !config.enabled || !config.lowEnabled) return null
    val minutes = config.hypoTreatmentSnoozeMinutes
    if (minutes <= 0 || minutes !in HYPO_TREATMENT_SNOOZE_MINUTES) return null
    if (treatedAtWall > wallNow + FUTURE_ALLOWANCE_MS) return null
    val until = minOf(treatedAtWall + minutes * 60_000L, wallNow + minutes * 60_000L)
    return until.takeIf { it > wallNow }
  }
}

/** Something Android or the phone needs the user to change before alarms can work fully. */
internal enum class GlucoseAlarmReadinessIssue(val message: String, val affectsSound: Boolean) {
  CONFIGURATION_UNREADABLE("Your saved alarm choices could not be read securely on this phone. Open alarm settings, check them and save again.", true),
  NOTIFICATIONS_BLOCKED("Android notifications for T1 Arc are turned off, so alarms cannot be shown or sounded. Turn them on in Android notification settings.", true),
  CHANNEL_BLOCKED("The Android “Glucose alarms” notification category is turned off. Turn it on in Android notification settings.", true),
  MONITOR_STOPPED("The background glucose monitor is not running. Open T1 Arc so Android can start it again.", true),
  PLAYBACK_BLOCKED("Android stopped the last alarm sound. Check the alarm volume and that T1 Arc may run in the background.", true),
  ALARM_VOLUME_ZERO("This phone’s alarm volume is at zero, so alarm sounds will be silent.", true),
  APP_VOLUME_ZERO("T1 Arc’s alarm sound level is set to 0%.", true),
  DO_NOT_DISTURB_SILENCES_ALARMS("Do Not Disturb is set to total silence, which also silences alarm sounds.", true),
  EXACT_ALARMS_DENIED("Precise alarm timing is off. Android may delay snooze endings and missing-reading checks. Use “Allow precise alarm timing”.", false),
  CUSTOM_SOUND_MISSING("A chosen alarm sound file is no longer on this phone. T1 Arc will use the built-in Steady pulse sound until you choose another.", false),
}

internal data class GlucoseAlarmReadinessInput(
  val configured: Boolean,
  val configurationReadable: Boolean,
  val enabled: Boolean,
  val audioEnabled: Boolean,
  val appNotificationsAllowed: Boolean = true,
  val channelAllowed: Boolean = true,
  val monitorRunning: Boolean = true,
  val playbackBlocked: Boolean = false,
  val alarmStreamVolume: Int = 1,
  val appVolume: Float = 1f,
  val dndTotalSilence: Boolean = false,
  val exactAlarmsAllowed: Boolean = true,
  val customSoundMissing: Boolean = false,
)

internal data class GlucoseAlarmArmingState(
  val alertsActive: Boolean,
  val audioArmed: Boolean,
  val issues: List<GlucoseAlarmReadinessIssue>,
) {
  /** Short, value-free text safe for the lock screen and the ongoing notification. */
  val ongoingWarning: String?
    get() = when {
      issues.contains(GlucoseAlarmReadinessIssue.CONFIGURATION_UNREADABLE) -> "Alarms need attention · open T1 Arc"
      !alertsActive || issues.isEmpty() -> null
      audioArmed && issues.any { it.affectsSound } -> "Alarm sound needs attention · open T1 Arc"
      else -> "Alarms need attention · open T1 Arc"
    }
}

/**
 * Arming follows the user's saved choice only. It never depends on whether the
 * settings screen was opened in this process, so an app update, a reboot or a
 * process restart keeps the same armed state. Problems Android needs the user
 * to fix are reported, never silently treated as "armed and fine".
 */
internal object GlucoseAlarmArmingPolicy {
  fun resolve(input: GlucoseAlarmReadinessInput): GlucoseAlarmArmingState {
    val issues = mutableListOf<GlucoseAlarmReadinessIssue>()
    if (input.configured && !input.configurationReadable) {
      issues.add(GlucoseAlarmReadinessIssue.CONFIGURATION_UNREADABLE)
      return GlucoseAlarmArmingState(false, false, issues)
    }
    val alertsActive = input.configured && input.enabled
    val audioArmed = alertsActive && input.audioEnabled
    if (!alertsActive) return GlucoseAlarmArmingState(false, false, issues)
    if (!input.appNotificationsAllowed) issues.add(GlucoseAlarmReadinessIssue.NOTIFICATIONS_BLOCKED)
    else if (!input.channelAllowed) issues.add(GlucoseAlarmReadinessIssue.CHANNEL_BLOCKED)
    if (!input.monitorRunning) issues.add(GlucoseAlarmReadinessIssue.MONITOR_STOPPED)
    if (audioArmed) {
      if (input.playbackBlocked) issues.add(GlucoseAlarmReadinessIssue.PLAYBACK_BLOCKED)
      if (input.alarmStreamVolume == 0) issues.add(GlucoseAlarmReadinessIssue.ALARM_VOLUME_ZERO)
      if (input.appVolume <= 0f) issues.add(GlucoseAlarmReadinessIssue.APP_VOLUME_ZERO)
      if (input.dndTotalSilence) issues.add(GlucoseAlarmReadinessIssue.DO_NOT_DISTURB_SILENCES_ALARMS)
      if (input.customSoundMissing) issues.add(GlucoseAlarmReadinessIssue.CUSTOM_SOUND_MISSING)
    }
    if (!input.exactAlarmsAllowed) issues.add(GlucoseAlarmReadinessIssue.EXACT_ALARMS_DENIED)
    return GlucoseAlarmArmingState(alertsActive, audioArmed, issues)
  }
}
