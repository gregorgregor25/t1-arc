package app.daymark.notificationsource

import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class DaymarkNotificationSourceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DaymarkNotificationSource")

    AsyncFunction("getStatusAsync") Coroutine { ->
      status()
    }

    AsyncFunction("setConfigurationAsync") Coroutine {
        enabled: Boolean,
        rulesJson: String,
      ->
      NotificationCaptureStore.saveConfiguration(
        context(),
        enabled,
        rulesJson,
      )
      status()
    }

    AsyncFunction("peekAsync") Coroutine { limit: Int ->
      NotificationCaptureStore.peek(context(), limit).map { it.toMap() }
    }

    AsyncFunction("acknowledgeAsync") Coroutine { ids: List<String> ->
      NotificationCaptureStore.acknowledge(context(), ids)
    }

    AsyncFunction("clearPendingAsync") Coroutine { ->
      NotificationCaptureStore.clear(context())
    }

    AsyncFunction("openNotificationAccessSettingsAsync") Coroutine { ->
      val context = context()
      val component =
        ComponentName(context, DaymarkNotificationListenerService::class.java)
      val detail =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
            .putExtra(
              Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,
              component.flattenToString(),
            )
        } else {
          Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        }
      detail.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      val resolved =
        if (detail.resolveActivity(context.packageManager) != null) {
          detail
        } else {
          Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
      context.startActivity(resolved)
      true
    }

    AsyncFunction("isPackageInstalledAsync") Coroutine { packageName: String ->
      isPackageInstalled(packageName)
    }
  }

  private fun status(): Map<String, Any?> {
    val context = context()
    val configuration = NotificationCaptureStore.readConfiguration(context)
    val metadata = NotificationCaptureStore.statusMetadata(context)
    return mapOf(
      "supported" to true,
      "accessGranted" to
        NotificationManagerCompat
          .getEnabledListenerPackages(context)
          .contains(context.packageName),
      "enabled" to configuration.enabled,
      "rules" to configuration.rules.map { it.toMap() },
      "pendingCount" to NotificationCaptureStore.pendingCount(context),
      "lastCapturedAt" to metadata["lastCapturedAt"],
      "lastPackageName" to metadata["lastPackageName"],
      "lastError" to metadata["lastError"],
    )
  }

  private fun isPackageInstalled(packageName: String): Boolean {
    if (!Regex("^[A-Za-z0-9_.]{3,200}$").matches(packageName)) return false
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context().packageManager.getApplicationInfo(
          packageName,
          PackageManager.ApplicationInfoFlags.of(0),
        )
      } else {
        @Suppress("DEPRECATION")
        context().packageManager.getApplicationInfo(packageName, 0)
      }
      true
    } catch (_: PackageManager.NameNotFoundException) {
      false
    }
  }

  private fun context() =
    requireNotNull(appContext.reactContext) {
      "T1 Arc notification source requires an Android context."
    }
}
