package io.github.gregorgregor25.t1arc.communityreminder

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import android.content.ClipData
import android.content.ClipboardManager

class T1ArcCommunityReminderModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T1ArcCommunityReminder")

    AsyncFunction("getStatusAsync") {
      CommunityReminder.status(requireNotNull(appContext.reactContext))
    }
    AsyncFunction("setEnabledAsync") { enabled: Boolean ->
      val context = requireNotNull(appContext.reactContext)
      CommunityReminder.setEnabled(context, enabled)
      CommunityReminder.status(context)
    }
    AsyncFunction("reconcileAsync") {
      val context = requireNotNull(appContext.reactContext)
      CommunityReminder.reconcile(context)
      CommunityReminder.status(context)
    }
    AsyncFunction("eraseAsync") {
      CommunityReminder.erase(requireNotNull(appContext.reactContext))
    }
    AsyncFunction("copySupportEmailAsync") {
      val context = requireNotNull(appContext.reactContext)
      context.getSystemService(ClipboardManager::class.java).setPrimaryClip(
        ClipData.newPlainText("T1 Arc support", "support@t1arc.com"),
      )
    }
    AsyncFunction("shouldRequestPermissionAsync") {
      CommunityReminder.shouldRequestPermission(requireNotNull(appContext.reactContext))
    }
    AsyncFunction("markPermissionRequestedAsync") {
      CommunityReminder.markPermissionRequested(requireNotNull(appContext.reactContext))
    }
  }
}
