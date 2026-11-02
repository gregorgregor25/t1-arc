package io.github.gregorgregor25.t1arc.glucosedisplay

/** Pure policy, shared by native intake, watchdog and actions. No Android or audio calls. */
internal enum class GlucoseAlarmKind(val wire: String) {
  LOW("low"), HIGH("high"), VERY_HIGH("veryHigh"), STALE("stale");
  companion object { fun parse(value: String?) = entries.firstOrNull { it.wire == value } }
}

internal data class GlucoseAlarmPolicyConfig(
  val enabled: Boolean = false,
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
)

internal data class GlucoseAlarmDecision(
  val kind: GlucoseAlarmKind?,
  val missing: Boolean,
  val shouldNotify: Boolean,
  val silent: Boolean,
  val keepPrevious: Boolean,
)

internal object GlucoseAlarmPolicy {
  const val STALE_MS = 12 * 60_000L
  const val MAX_SNOOZE_MS = 24 * 60 * 60_000L
  const val FUTURE_ALLOWANCE_MS = 120_000L

  fun shouldRestartAudio(armedInProcess: Boolean, blocked: Boolean, hasPlayer: Boolean, configurationChanged: Boolean) =
    !armedInProcess || blocked || (hasPlayer && configurationChanged)

  fun soundRequired(config: GlucoseAlarmPolicyConfig, audioEnabled: Boolean, kind: GlucoseAlarmKind): Boolean =
    config.enabled && audioEnabled && when (kind) {
      GlucoseAlarmKind.LOW -> config.lowEnabled
      GlucoseAlarmKind.HIGH -> config.highEnabled
      GlucoseAlarmKind.VERY_HIGH -> config.veryHighEnabled
      GlucoseAlarmKind.STALE -> config.staleEnabled
    }

  /** A pending monitor start is not a delivered notification or an audio failure. */
  fun canDeliver(appNotificationsAllowed: Boolean, channelAllowed: Boolean, wantsAudio: Boolean, monitorReady: Boolean) =
    appNotificationsAllowed && channelAllowed && (!wantsAudio || monitorReady)

  fun isNight(config: GlucoseAlarmPolicyConfig, minuteOfDay: Int): Boolean {
    if (!config.nightEnabled || config.nightStart == config.nightEnd) return false
    return if (config.nightStart < config.nightEnd) minuteOfDay >= config.nightStart && minuteOfDay < config.nightEnd
      else minuteOfDay >= config.nightStart || minuteOfDay < config.nightEnd
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
  ): GlucoseAlarmDecision {
    if (!config.enabled) return GlucoseAlarmDecision(null, false, false, true, false)
    val sameSource = previous?.sourceIdentity == identity
    val missing = observation == null || !observation.live || observation.hasError ||
      observation.timestamp > wallNow + FUTURE_ALLOWANCE_MS || wallNow - observation.timestamp > STALE_MS ||
      !observation.mmolL.isFinite() || observation.mmolL !in 0.5..40.0
    if (missing) {
      // A lost feed is never evidence that a preceding excursion recovered.
      val retained = previous?.takeIf { sameSource && when (it.kind) {
        GlucoseAlarmKind.LOW -> config.lowEnabled
        GlucoseAlarmKind.HIGH -> config.highEnabled
        GlucoseAlarmKind.VERY_HIGH -> config.veryHighEnabled
        GlucoseAlarmKind.STALE -> false
      } }
      if (retained != null) return GlucoseAlarmDecision(retained.kind, true, false, true, true)
      if (!config.staleEnabled) return GlucoseAlarmDecision(null, true, false, true, false)
      return notificationDecision(config, GlucoseAlarmKind.STALE, previous, sameSource,
        true, elapsedNow, bootCount, minuteOfDay)
    }
    val value = requireNotNull(observation).mmolL
    val oldKind = previous?.takeIf { sameSource }?.kind
    val kind = when {
      config.lowEnabled && (value <= config.lowThreshold ||
        (oldKind == GlucoseAlarmKind.LOW && value < config.lowThreshold + 0.3)) -> GlucoseAlarmKind.LOW
      config.veryHighEnabled && config.veryHighThreshold != null &&
        (value >= config.veryHighThreshold || (oldKind == GlucoseAlarmKind.VERY_HIGH && value > config.veryHighThreshold - 0.5)) -> GlucoseAlarmKind.VERY_HIGH
      config.highEnabled && (value >= config.highThreshold ||
        (oldKind == GlucoseAlarmKind.HIGH && value > config.highThreshold - 0.5)) -> GlucoseAlarmKind.HIGH
      else -> null
    }
    if (kind == null) return GlucoseAlarmDecision(null, false, false, true, false)
    return notificationDecision(config, kind, previous, sameSource, false, elapsedNow, bootCount, minuteOfDay)
  }

  private fun notificationDecision(
    config: GlucoseAlarmPolicyConfig,
    kind: GlucoseAlarmKind,
    previous: GlucoseAlarmEpisode?,
    sameSource: Boolean,
    missing: Boolean,
    elapsedNow: Long,
    bootCount: Int,
    minuteOfDay: Int,
  ): GlucoseAlarmDecision {
    val same = sameSource && previous?.kind == kind
    val previousSameBoot = previous?.bootCount == bootCount
    val snoozed = same && previousSameBoot && (previous?.snoozeUntilElapsed ?: 0L) > elapsedNow
    val repeatDue = same && config.repeatMinutes > 0 && previousSameBoot &&
      previous?.lastNotifiedElapsed != null && elapsedNow - previous.lastNotifiedElapsed >= config.repeatMinutes * 60_000L
    val snoozeExpired = same && previousSameBoot && previous?.snoozeUntilElapsed != null &&
      previous.snoozeUntilElapsed <= elapsedNow
    val first = !same || previous?.lastNotifiedElapsed == null || !previousSameBoot
    return GlucoseAlarmDecision(kind, missing, !snoozed && (first || repeatDue || snoozeExpired),
      kind == GlucoseAlarmKind.HIGH && isNight(config, minuteOfDay), same)
  }

  fun snoozeUntil(wallNow: Long, elapsedNow: Long, untilWall: Long): Long {
    val duration = untilWall - wallNow
    require(duration in 1L..MAX_SNOOZE_MS) { "Choose a future snooze time within the next 24 hours." }
    return elapsedNow + duration
  }
}
