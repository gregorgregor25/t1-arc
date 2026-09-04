package io.github.gregorgregor25.t1arc.glucosedisplay

import org.junit.Assert.assertEquals
import org.junit.Test

class NotificationSettingsDestinationTest {
  @Test
  fun `app denial routes to the app notification page`() {
    assertEquals(
      NotificationSettingsDestination.APP,
      notificationSettingsDestination(
        appNotificationsAllowed = false,
        channelSettingsSupported = true,
      ),
    )
  }

  @Test
  fun `allowed app routes to the current glucose channel page`() {
    assertEquals(
      NotificationSettingsDestination.CHANNEL,
      notificationSettingsDestination(
        appNotificationsAllowed = true,
        channelSettingsSupported = true,
      ),
    )
  }

  @Test
  fun `Android versions without channel settings use the app page`() {
    assertEquals(
      NotificationSettingsDestination.APP,
      notificationSettingsDestination(
        appNotificationsAllowed = true,
        channelSettingsSupported = false,
      ),
    )
  }

  @Test
  fun `disabled current channel is not reported as notification access`() {
    assertEquals(
      false,
      effectiveCurrentGlucoseNotificationsAllowed(
        appNotificationsAllowed = true,
        channelSettingsSupported = true,
        currentChannelEnabled = false,
      ),
    )
  }

  @Test
  fun `enabled current channel is reported as notification access`() {
    assertEquals(
      true,
      effectiveCurrentGlucoseNotificationsAllowed(
        appNotificationsAllowed = true,
        channelSettingsSupported = true,
        currentChannelEnabled = true,
      ),
    )
  }

  @Test
  fun `app denial wins even when the current channel is enabled`() {
    assertEquals(
      false,
      effectiveCurrentGlucoseNotificationsAllowed(
        appNotificationsAllowed = false,
        channelSettingsSupported = true,
        currentChannelEnabled = true,
      ),
    )
  }

  @Test
  fun `pre-channel Android relies on app notification access`() {
    assertEquals(
      true,
      effectiveCurrentGlucoseNotificationsAllowed(
        appNotificationsAllowed = true,
        channelSettingsSupported = false,
        currentChannelEnabled = false,
      ),
    )
  }
}
