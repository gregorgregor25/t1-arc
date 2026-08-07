package app.daymark.notificationsource

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class DaymarkNotificationListenerService : NotificationListenerService() {
  override fun onNotificationPosted(statusBarNotification: StatusBarNotification?) {
    val notification = statusBarNotification ?: return
    if (notification.packageName == packageName) return
    NotificationCaptureStore.append(applicationContext, notification)
  }
}
