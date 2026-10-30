package io.github.gregorgregor25.t1arc.communityreminder

import java.util.Calendar
import java.util.TimeZone
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

class CommunityReminderScheduleTest {
  private val originalZone = TimeZone.getDefault()

  @After fun restoreZone() { TimeZone.setDefault(originalZone) }

  private fun timestamp(year: Int, month: Int, day: Int, hour: Int): Long =
    Calendar.getInstance().apply {
      set(year, month - 1, day, hour, 0, 0)
      set(Calendar.MILLISECOND, 0)
    }.timeInMillis

  @Test fun schedulesNextMondayAtFivePm() {
    TimeZone.setDefault(TimeZone.getTimeZone("Europe/London"))
    assertEquals(timestamp(2026, 11, 2, 17), CommunityReminder.nextMondayAfternoon(timestamp(2026, 10, 30, 12)))
    assertEquals(timestamp(2026, 11, 9, 17), CommunityReminder.nextMondayAfternoon(timestamp(2026, 11, 2, 17)))
  }

  @Test fun followsLocalTimeAcrossDaylightSavingChange() {
    TimeZone.setDefault(TimeZone.getTimeZone("Europe/London"))
    assertEquals(timestamp(2026, 3, 30, 17), CommunityReminder.nextMondayAfternoon(timestamp(2026, 3, 27, 12)))
    assertEquals(timestamp(2026, 10, 26, 17), CommunityReminder.nextMondayAfternoon(timestamp(2026, 10, 23, 12)))
  }

  @Test fun suppressesDuplicateDeliveryAfterClockOrTimezoneChange() {
    val first = timestamp(2026, 11, 2, 17)
    assertEquals(true, CommunityReminder.mayDeliver(first, 0L))
    assertEquals(false, CommunityReminder.mayDeliver(first, first))
    assertEquals(false, CommunityReminder.mayDeliver(first - 60_000L, first))
    assertEquals(false, CommunityReminder.mayDeliver(first + 6L * 24L * 60L * 60L * 1000L, first))
    assertEquals(true, CommunityReminder.mayDeliver(first + 7L * 24L * 60L * 60L * 1000L, first))
    // If Android delivers five minutes late, the following week remains scheduled.
    assertEquals(timestamp(2026, 11, 9, 17) + 5L * 60L * 1000L,
      CommunityReminder.nextDue(first + 5L * 60L * 1000L, first + 5L * 60L * 1000L))
  }

  @Test fun ordinaryForegroundDoesNotReplacePendingAlarmEvenWhenOverdue() {
    assertEquals(true, CommunityReminder.preservePendingAlarm(timestamp(2026, 11, 2, 17), false))
    assertEquals(false, CommunityReminder.preservePendingAlarm(timestamp(2026, 11, 2, 17), true))
    assertEquals(false, CommunityReminder.preservePendingAlarm(0L, false))
  }

  @Test fun permissionRevocationOrOptOutClearsConsumedAlarmState() {
    assertEquals(true, CommunityReminder.clearPendingAlarm(true, false))
    assertEquals(true, CommunityReminder.clearPendingAlarm(false, true))
    assertEquals(false, CommunityReminder.clearPendingAlarm(true, true))
  }
}
