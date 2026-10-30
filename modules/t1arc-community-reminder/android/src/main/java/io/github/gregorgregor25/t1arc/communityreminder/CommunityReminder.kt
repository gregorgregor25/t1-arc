package io.github.gregorgregor25.t1arc.communityreminder

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.util.Calendar

internal object CommunityReminder {
  private const val PREFS = "t1arc.community-reminder.v1"
  private const val ENABLED = "enabled"
  private const val PERMISSION_ASKED = "permission-asked"
  private const val NEXT_DUE = "next-due"
  private const val LAST_DELIVERED = "last-delivered"
  private const val CHANNEL = "t1arc-community-feedback"
  private const val ALARM_REQUEST = 71031
  private const val NOTIFICATION_ID = 71032
  private const val MIN_DELIVERY_INTERVAL = 7L * 24L * 60L * 60L * 1000L

  private fun enabled(context: Context): Boolean =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(ENABLED, true)

  fun status(context: Context): Map<String, Boolean> = mapOf(
    "enabled" to enabled(context),
    "notificationsAllowed" to allowed(context),
  )

  fun shouldRequestPermission(context: Context): Boolean =
    Build.VERSION.SDK_INT >= 33 && enabled(context) && !allowed(context) &&
      !context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(PERMISSION_ASKED, false)

  fun markPermissionRequested(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(PERMISSION_ASKED, true).apply()
  }

  private fun allowed(context: Context): Boolean {
    val channel = if (Build.VERSION.SDK_INT >= 26) context.getSystemService(NotificationManager::class.java).getNotificationChannel(CHANNEL) else null
    return (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
      NotificationManagerCompat.from(context).areNotificationsEnabled() &&
      (channel == null || channel.importance != NotificationManager.IMPORTANCE_NONE)
  }

  private fun alarmIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(
    context, ALARM_REQUEST,
    Intent(context, CommunityReminderReceiver::class.java).setAction("io.github.gregorgregor25.t1arc.COMMUNITY_REMINDER"),
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
  )

  internal fun nextMondayAfternoon(now: Long): Long {
    val next = Calendar.getInstance().apply {
      timeInMillis = now
      set(Calendar.DAY_OF_WEEK, Calendar.MONDAY)
      set(Calendar.HOUR_OF_DAY, 17)
      set(Calendar.MINUTE, 0)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
      if (timeInMillis <= now) add(Calendar.WEEK_OF_YEAR, 1)
    }
    return next.timeInMillis
  }

  internal fun mayDeliver(now: Long, lastDelivered: Long): Boolean =
    lastDelivered <= 0L || (now >= lastDelivered && now - lastDelivered >= MIN_DELIVERY_INTERVAL)

  internal fun nextDue(now: Long, lastDelivered: Long): Long =
    maxOf(nextMondayAfternoon(now), if (lastDelivered <= 0L) 0L else lastDelivered + MIN_DELIVERY_INTERVAL)

  internal fun preservePendingAlarm(due: Long, force: Boolean): Boolean = !force && due > 0L

  internal fun clearPendingAlarm(enabled: Boolean, allowed: Boolean): Boolean = !enabled || !allowed

  @Synchronized fun setEnabled(context: Context, value: Boolean) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(ENABLED, value).apply()
    reconcile(context, force = !value)
    if (!value) context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
  }

  @Synchronized fun erase(context: Context) {
    setEnabled(context, false)
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .remove(LAST_DELIVERED).remove(NEXT_DUE).apply()
  }

  @Synchronized fun reconcile(context: Context, force: Boolean = false) {
    val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val manager = context.getSystemService(AlarmManager::class.java)
    val intent = alarmIntent(context)
    if (clearPendingAlarm(enabled(context), allowed(context))) {
      manager.cancel(intent)
      preferences.edit().remove(NEXT_DUE).apply()
      return
    }
    val now = System.currentTimeMillis()
    val due = preferences.getLong(NEXT_DUE, 0L)
    // PendingIntent survives normal process death. Preserve its due time on app foreground.
    if (preservePendingAlarm(due, force)) return
    manager.cancel(intent)
    if (Build.VERSION.SDK_INT >= 26) {
      context.getSystemService(NotificationManager::class.java).createNotificationChannel(
        NotificationChannel(CHANNEL, "T1 Arc community feedback", NotificationManager.IMPORTANCE_DEFAULT).apply {
          description = "Weekly invitation to share feedback about T1 Arc"
        },
      )
    }
    val next = nextDue(now, preferences.getLong(LAST_DELIVERED, 0L))
    preferences.edit().putLong(NEXT_DUE, next).apply()
    manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, intent)
  }

  @SuppressLint("MissingPermission") // allowed() checks POST_NOTIFICATIONS immediately before notify.
  @Synchronized fun deliver(context: Context) {
    if (clearPendingAlarm(enabled(context), allowed(context))) {
      reconcile(context)
      return
    }
    val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val now = System.currentTimeMillis()
    val lastDelivered = preferences.getLong(LAST_DELIVERED, 0L)
    if (!mayDeliver(now, lastDelivered)) {
      reconcile(context, force = true)
      return
    }
    val openFeedback = Intent(Intent.ACTION_VIEW, Uri.parse("t1arc://feedback")).apply {
      `package` = context.packageName
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    val openIntent = PendingIntent.getActivity(
      context, NOTIFICATION_ID, openFeedback,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notification = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setContentTitle("Help me make T1 Arc better")
      .setContentText("Share what works, what frustrates you, or what is missing.")
      .setContentIntent(openIntent)
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .build()
    try {
      NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
    } catch (_: SecurityException) {
      reconcile(context, force = true)
      return
    }
    preferences.edit().putLong(LAST_DELIVERED, now).apply()
    reconcile(context, force = true)
  }
}

class CommunityReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    CommunityReminder.deliver(context)
  }
}

class CommunityReminderRestartReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_TIME_CHANGED ||
      intent.action == Intent.ACTION_TIMEZONE_CHANGED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
      CommunityReminder.reconcile(context, force = true)
    }
  }
}
