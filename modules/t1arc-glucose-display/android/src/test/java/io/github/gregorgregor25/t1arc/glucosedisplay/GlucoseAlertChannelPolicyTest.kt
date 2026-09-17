package io.github.gregorgregor25.t1arc.glucosedisplay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GlucoseAlertChannelPolicyTest {
  @Test
  fun `each alert category has a stable independent channel and notification identity`() {
    assertEquals(
      listOf(
        "low" to "t1arc_low_glucose_alerts_v1",
        "high" to "t1arc_high_glucose_alerts_v1",
        "stale" to "t1arc_glucose_freshness_alerts_v1",
      ),
      GlucoseAlertChannelKind.entries.map { it.wireValue to it.channelId },
    )
    assertEquals(3, GlucoseAlertChannelKind.entries.map { it.notificationId }.toSet().size)
    assertEquals(3, GlucoseAlertChannelKind.entries.map { it.testNotificationId }.toSet().size)
  }

  @Test
  fun `wire values resolve fail closed`() {
    assertEquals(GlucoseAlertChannelKind.LOW, GlucoseAlertChannelPolicy.kindFor("low"))
    assertEquals(GlucoseAlertChannelKind.HIGH, GlucoseAlertChannelPolicy.kindFor("high"))
    assertEquals(GlucoseAlertChannelKind.STALE, GlucoseAlertChannelPolicy.kindFor("stale"))
    assertNull(GlucoseAlertChannelPolicy.kindFor("normal"))
    assertNull(GlucoseAlertChannelPolicy.kindFor("LOW"))
  }

  @Test
  fun `reported availability includes app blocks missing channels and channel blocks`() {
    assertEquals(
      GlucoseAlertChannelAvailability.BLOCKED,
      GlucoseAlertChannelPolicy.availability(
        appNotificationsAllowed = false,
        groupBlocked = false,
        channelExists = true,
        channelImportance = 4,
      ),
    )
    assertEquals(
      GlucoseAlertChannelAvailability.UNAVAILABLE,
      GlucoseAlertChannelPolicy.availability(
        appNotificationsAllowed = true,
        groupBlocked = false,
        channelExists = false,
        channelImportance = null,
      ),
    )
    assertEquals(
      GlucoseAlertChannelAvailability.BLOCKED,
      GlucoseAlertChannelPolicy.availability(
        appNotificationsAllowed = true,
        groupBlocked = false,
        channelExists = true,
        channelImportance = 0,
      ),
    )
    assertEquals(
      GlucoseAlertChannelAvailability.ALLOWED,
      GlucoseAlertChannelPolicy.availability(
        appNotificationsAllowed = true,
        groupBlocked = false,
        channelExists = true,
        channelImportance = 4,
      ),
    )
    assertEquals(
      GlucoseAlertChannelAvailability.BLOCKED,
      GlucoseAlertChannelPolicy.availability(
        appNotificationsAllowed = true,
        groupBlocked = true,
        channelExists = true,
        channelImportance = 4,
      ),
    )
  }
}
