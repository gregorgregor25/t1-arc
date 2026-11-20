package io.github.gregorgregor25.t1arc.communityreminder

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Quiet "a new version is out" notice, posted by the JavaScript daily update
 * check after it has verified a newer public GitHub release. It opens About
 * T1 Arc, where the release notes and download link are shown. Nothing is
 * downloaded or installed from here.
 */
internal object UpdateNotice {
  private const val CHANNEL = "t1arc-app-updates"
  private const val NOTIFICATION_ID = 71041
  private const val ABOUT_LINK = "t1arc://sources/about"
  private val PUBLIC_VERSION = Regex("^\\d{1,3}\\.\\d{1,3}\\.\\d{1,4}$")

  /** Only a plain public version such as 1.7.22 is ever shown in the notice. */
  internal fun isPublicVersion(version: String): Boolean = PUBLIC_VERSION.matches(version)

  internal fun title(version: String): String = "T1 Arc $version is available"

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    context.getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(CHANNEL, "App updates", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Tells you once when a new T1 Arc version is published on GitHub"
      },
    )
  }

  private fun allowed(context: Context): Boolean {
    val channel = if (Build.VERSION.SDK_INT >= 26) {
      context.getSystemService(NotificationManager::class.java).getNotificationChannel(CHANNEL)
    } else {
      null
    }
    return (Build.VERSION.SDK_INT < 33 ||
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
      NotificationManagerCompat.from(context).areNotificationsEnabled() &&
      (channel == null || channel.importance != NotificationManager.IMPORTANCE_NONE)
  }

  @SuppressLint("MissingPermission") // allowed() checks POST_NOTIFICATIONS immediately before notify.
  @Synchronized fun show(context: Context, version: String): Boolean {
    if (!isPublicVersion(version)) return false
    ensureChannel(context)
    if (!allowed(context)) return false
    val openAbout = Intent(Intent.ACTION_VIEW, Uri.parse(ABOUT_LINK)).apply {
      `package` = context.packageName
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    val openIntent = PendingIntent.getActivity(
      context, NOTIFICATION_ID, openAbout,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notification = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setContentTitle(title(version))
      .setContentText("Tap to see what's changed. Nothing installs automatically.")
      .setStyle(NotificationCompat.BigTextStyle().bigText(
        "Tap to see what's changed and how to update. Make an encrypted backup first. Nothing downloads or installs automatically.",
      ))
      .setContentIntent(openIntent)
      .setAutoCancel(true)
      .setOnlyAlertOnce(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
    return try {
      NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
      true
    } catch (_: SecurityException) {
      false
    }
  }

  @Synchronized fun cancel(context: Context) {
    context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
  }
}
