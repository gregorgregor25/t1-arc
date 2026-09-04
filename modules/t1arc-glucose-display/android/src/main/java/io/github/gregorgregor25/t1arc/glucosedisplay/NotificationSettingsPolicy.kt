package io.github.gregorgregor25.t1arc.glucosedisplay

internal enum class NotificationSettingsDestination {
  APP,
  CHANNEL,
}

/**
 * A channel page cannot recover an app-level notification denial. Route to
 * the app page until Android reports that notifications are globally allowed;
 * only then is the current-glucose channel page the actionable destination.
 */
internal fun notificationSettingsDestination(
  appNotificationsAllowed: Boolean,
  channelSettingsSupported: Boolean,
): NotificationSettingsDestination =
  if (appNotificationsAllowed && channelSettingsSupported) {
    NotificationSettingsDestination.CHANNEL
  } else {
    NotificationSettingsDestination.APP
  }

/**
 * The display status represents whether its ongoing notification can actually
 * be shown, not only whether the app has the global Android grant. A disabled
 * current-glucose channel therefore remains actionable in the app UI.
 */
internal fun effectiveCurrentGlucoseNotificationsAllowed(
  appNotificationsAllowed: Boolean,
  channelSettingsSupported: Boolean,
  currentChannelEnabled: Boolean,
): Boolean =
  appNotificationsAllowed && (!channelSettingsSupported || currentChannelEnabled)
