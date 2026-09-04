package io.github.gregorgregor25.t1arc.glucosedisplay

internal const val LOW_GLUCOSE_ALERT_CHANNEL_ID = "t1arc_low_glucose_alerts_v1"
internal const val HIGH_GLUCOSE_ALERT_CHANNEL_ID = "t1arc_high_glucose_alerts_v1"
internal const val STALE_GLUCOSE_ALERT_CHANNEL_ID = "t1arc_glucose_freshness_alerts_v1"

internal enum class GlucoseAlertChannelKind(
  val wireValue: String,
  val channelId: String,
  val notificationId: Int,
  val testNotificationId: Int,
) {
  LOW("low", LOW_GLUCOSE_ALERT_CHANNEL_ID, 6421, 6431),
  HIGH("high", HIGH_GLUCOSE_ALERT_CHANNEL_ID, 6422, 6432),
  STALE("stale", STALE_GLUCOSE_ALERT_CHANNEL_ID, 6423, 6433),
}

internal enum class GlucoseAlertChannelAvailability(val wireValue: String) {
  ALLOWED("allowed"),
  BLOCKED("blocked"),
  UNAVAILABLE("unavailable"),
}

internal object GlucoseAlertChannelPolicy {
  fun kindFor(value: String): GlucoseAlertChannelKind? =
    GlucoseAlertChannelKind.entries.firstOrNull { it.wireValue == value }

  fun channelIdFor(value: String): String? = kindFor(value)?.channelId

  fun availability(
    appNotificationsAllowed: Boolean,
    groupBlocked: Boolean,
    channelExists: Boolean,
    channelImportance: Int?,
  ): GlucoseAlertChannelAvailability =
    when {
      !appNotificationsAllowed -> GlucoseAlertChannelAvailability.BLOCKED
      groupBlocked -> GlucoseAlertChannelAvailability.BLOCKED
      !channelExists || channelImportance == null -> GlucoseAlertChannelAvailability.UNAVAILABLE
      channelImportance <= 0 -> GlucoseAlertChannelAvailability.BLOCKED
      else -> GlucoseAlertChannelAvailability.ALLOWED
    }
}
