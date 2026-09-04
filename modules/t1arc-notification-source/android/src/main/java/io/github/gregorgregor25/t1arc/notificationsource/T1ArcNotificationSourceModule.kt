package io.github.gregorgregor25.t1arc.notificationsource

import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class T1ArcNotificationSourceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T1ArcNotificationSource")

    AsyncFunction("getStatusAsync") Coroutine { ->
      status()
    }

    AsyncFunction("getConfigurationSnapshotAsync") Coroutine { ->
      configurationSnapshot()
    }

    AsyncFunction("setConfigurationAsync") Coroutine {
        enabled: Boolean,
        rulesJson: String,
      ->
      NotificationCaptureStore.replaceConfigurationAndClear(
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

    AsyncFunction("acknowledgeCapturedAsync") Coroutine { receiptsJson: String ->
      NotificationCaptureStore.acknowledgeCaptured(context(), receiptsJson)
    }

    AsyncFunction("clearPendingAsync") Coroutine { ->
      NotificationCaptureStore.clear(context())
    }

    AsyncFunction("disableAndClearAsync") Coroutine { ->
      NotificationCaptureStore.disableAndClear(context())
    }

    AsyncFunction("openNotificationAccessSettingsAsync") Coroutine { ->
      val context = context()
      val component =
        ComponentName(context, T1ArcNotificationListenerService::class.java)
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
    val configurationSnapshot =
      NotificationCaptureStore.readConfigurationSnapshot(context)
    val configuration = configurationSnapshot.configuration
    // Reading the queue can safely recover an interrupted first write and
    // record a non-sensitive diagnostic; read metadata afterwards so this
    // status response exposes that recovery immediately.
    val pendingCount = NotificationCaptureStore.pendingCount(context)
    val metadata = NotificationCaptureStore.statusMetadata(context)
    return mapOf(
      "supported" to true,
      "accessGranted" to
        NotificationManagerCompat
          .getEnabledListenerPackages(context)
          .contains(context.packageName),
      "enabled" to configuration.enabled,
      "rules" to configuration.rules.map { it.toMap() },
      "configurationRevision" to configurationSnapshot.revision.toDouble(),
      "pendingCount" to pendingCount,
      "lastCapturedAt" to metadata["lastCapturedAt"],
      "lastPackageName" to metadata["lastPackageName"],
      "lastError" to metadata["lastError"],
    )
  }

  private fun configurationSnapshot(): Map<String, Any?> {
    val snapshot =
      NotificationCaptureStore.readConfigurationSnapshot(context())
    return mapOf(
      "enabled" to snapshot.configuration.enabled,
      "rules" to snapshot.configuration.rules.map { it.toMap() },
      "configurationRevision" to snapshot.revision.toDouble(),
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
