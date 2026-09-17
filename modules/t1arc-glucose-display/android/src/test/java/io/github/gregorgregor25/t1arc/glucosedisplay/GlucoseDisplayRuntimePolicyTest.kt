package io.github.gregorgregor25.t1arc.glucosedisplay

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

private fun glucoseDisplayModuleSource(): String {
  val relative =
    "modules/t1arc-glucose-display/android/src/main/java/" +
      "io/github/gregorgregor25/t1arc/glucosedisplay/T1ArcGlucoseDisplayModule.kt"
  return listOf(
      File(relative),
      File("../$relative"),
      File("src/main/java/io/github/gregorgregor25/t1arc/glucosedisplay/T1ArcGlucoseDisplayModule.kt"),
    )
    .firstOrNull(File::isFile)
    ?.readText()
    ?: error("Could not locate T1ArcGlucoseDisplayModule.kt")
}

class ValidatedNetworkSyncPolicyTest {
  @Test
  fun `validated default network triggers once while repeated capabilities coalesce`() {
    val policy = ValidatedNetworkSyncPolicy()

    policy.onAvailable(11L)

    assertFalse(policy.onCapabilitiesChanged(11L, hasInternet = true, isValidated = false))
    assertTrue(policy.onCapabilitiesChanged(11L, hasInternet = true, isValidated = true))
    assertFalse(policy.onCapabilitiesChanged(11L, hasInternet = true, isValidated = true))
  }

  @Test
  fun `distinct validated default networks each trigger a recovery sync`() {
    val policy = ValidatedNetworkSyncPolicy()

    policy.onAvailable(11L)
    assertTrue(policy.onCapabilitiesChanged(11L, hasInternet = true, isValidated = true))

    policy.onLost(11L)
    policy.onAvailable(22L)
    assertTrue(policy.onCapabilitiesChanged(22L, hasInternet = true, isValidated = true))
  }

  @Test
  fun `same network revalidation triggers once after internet loss`() {
    val policy = ValidatedNetworkSyncPolicy()

    policy.onAvailable(11L)
    assertTrue(policy.onCapabilitiesChanged(11L, hasInternet = true, isValidated = true))
    assertFalse(policy.onCapabilitiesChanged(11L, hasInternet = false, isValidated = false))
    assertTrue(policy.onCapabilitiesChanged(11L, hasInternet = true, isValidated = true))
    assertFalse(policy.onCapabilitiesChanged(11L, hasInternet = true, isValidated = true))
  }

  @Test
  fun `captive unvalidated and obsolete networks never trigger`() {
    val policy = ValidatedNetworkSyncPolicy()

    policy.onAvailable(11L)
    assertFalse(policy.onCapabilitiesChanged(11L, hasInternet = true, isValidated = false))
    policy.onLost(11L)
    assertFalse(policy.onCapabilitiesChanged(11L, hasInternet = true, isValidated = true))

    policy.onAvailable(22L)
    policy.stop()
    assertFalse(policy.onCapabilitiesChanged(22L, hasInternet = true, isValidated = true))
  }
}

class AodOverlayLifecyclePolicyTest {
  @Test
  fun `unlock invalidates queued AOD work`() {
    val policy = AodOverlayLifecyclePolicy()
    val queuedToken = policy.token()

    policy.invalidate()

    assertFalse(
      policy.shouldRender(
        token = queuedToken,
        interactive = false,
        displayIsDozing = true,
        displayEnabled = true,
        aodDesired = true,
        snapshotAvailable = true,
      )
    )
  }

  @Test
  fun `AOD renders only while noninteractive doze is fully eligible`() {
    val policy = AodOverlayLifecyclePolicy()
    val token = policy.token()

    assertTrue(
      policy.shouldRender(token, false, true, true, true, true)
    )
    assertFalse(policy.shouldRender(token, true, true, true, true, true))
    assertFalse(policy.shouldRender(token, false, false, true, true, true))
    assertFalse(policy.shouldRender(token, false, true, false, true, true))
    assertFalse(policy.shouldRender(token, false, true, true, false, true))
    assertFalse(policy.shouldRender(token, false, true, true, true, false))
  }
}

class DisplayFreshnessPolicyTest {
  private val now = 20 * 60_000L

  @Test
  fun `current timestamp remains current when source has a previous error`() {
    assertEquals(
      DisplayFreshness.CURRENT,
      DisplayFreshnessPolicy.resolve(
        timestampMs = now,
        now = now,
        sourceHasError = true,
      ),
    )
  }

  @Test
  fun `timestamp thresholds still distinguish current delayed and stale`() {
    assertEquals(
      DisplayFreshness.CURRENT,
      DisplayFreshnessPolicy.resolve(now - 6 * 60_000L, now, sourceHasError = false),
    )
    assertEquals(
      DisplayFreshness.DELAYED,
      DisplayFreshnessPolicy.resolve(now - 6 * 60_000L - 1L, now, sourceHasError = true),
    )
    assertEquals(
      DisplayFreshness.DELAYED,
      DisplayFreshnessPolicy.resolve(now - 12 * 60_000L, now, sourceHasError = false),
    )
    assertEquals(
      DisplayFreshness.STALE,
      DisplayFreshnessPolicy.resolve(now - 12 * 60_000L - 1L, now, sourceHasError = false),
    )
  }
}

class GlucoseSyncCadencePolicyTest {
  private val now = 1_800_000_000_000L

  @Test
  fun `uses one minute baseline before the next reading is expected`() {
    assertEquals(60_000L, GlucoseSyncCadencePolicy.nextDelayMs(now - 4 * 60_000L, now))
  }

  @Test
  fun `uses fifteen second catch up near the expected reading window`() {
    assertEquals(
      15_000L,
      GlucoseSyncCadencePolicy.nextDelayMs(now - (4 * 60_000L + 30_000L), now),
    )
    assertEquals(15_000L, GlucoseSyncCadencePolicy.nextDelayMs(now - 12 * 60_000L, now))
  }

  @Test
  fun `returns to one minute when missing or genuinely stale`() {
    assertEquals(60_000L, GlucoseSyncCadencePolicy.nextDelayMs(null, now))
    assertEquals(60_000L, GlucoseSyncCadencePolicy.nextDelayMs(now - 12 * 60_000L - 1L, now))
  }
}

class GlucoseCollectorOwnershipPolicyTest {
  @Test
  fun `collector stops only when display and alerts are both disabled`() {
    assertEquals(
      GlucoseCollectorForegroundMode.STOPPED,
      GlucoseCollectorOwnershipPolicy.resolve(
        displayEnabled = false,
        alertMonitoringEnabled = false,
      ),
    )
  }

  @Test
  fun `display alone owns the glucose foreground notification`() {
    assertEquals(
      GlucoseCollectorForegroundMode.GLUCOSE_DISPLAY,
      GlucoseCollectorOwnershipPolicy.resolve(
        displayEnabled = true,
        alertMonitoringEnabled = false,
      ),
    )
  }

  @Test
  fun `alerts alone own a private monitoring foreground notification`() {
    assertEquals(
      GlucoseCollectorForegroundMode.PRIVATE_MONITORING,
      GlucoseCollectorOwnershipPolicy.resolve(
        displayEnabled = false,
        alertMonitoringEnabled = true,
      ),
    )
  }

  @Test
  fun `display takes presentation precedence when both owners are enabled`() {
    assertEquals(
      GlucoseCollectorForegroundMode.GLUCOSE_DISPLAY,
      GlucoseCollectorOwnershipPolicy.resolve(
        displayEnabled = true,
        alertMonitoringEnabled = true,
      ),
    )
  }
}

class GlucoseCollectorRestartOwnershipContractTest {
  @Test
  fun `legacy installs default only the new alert owner while preserving display ownership`() {
    assertFalse(GlucoseCollectorOwnershipPolicy.defaultAlertMonitoringEnabled())
    assertEquals(
      GlucoseCollectorForegroundMode.GLUCOSE_DISPLAY,
      GlucoseCollectorOwnershipPolicy.resolve(
        displayEnabled = true,
        alertMonitoringEnabled =
          GlucoseCollectorOwnershipPolicy.defaultAlertMonitoringEnabled(),
      ),
    )
  }

  @Test
  fun `startup service and boot receiver restore either persisted owner`() {
    val source = glucoseDisplayModuleSource()
    val serviceStart =
      source
        .substringAfter("override fun onStartCommand")
        .substringBefore("private fun requestHeadlessSync")
    val bootReceiver =
      source
        .substringAfter("class T1ArcGlucoseDisplayBootReceiver")
        .substringBefore("class T1ArcAodAccessibilityService")
    val startupReconciler =
      source
        .substringAfter("private object T1ArcGlucoseSurfaceStartupReconciler")
        .substringBefore("class T1ArcGlucoseDisplayModule")
    val alertOwnershipGate =
      source
        .substringAfter("private object T1ArcGlucoseAlertOwnershipGate")
        .substringBefore("private object T1ArcGlucoseWidget")
    val moduleStartup =
      source
        .substringAfter("class T1ArcGlucoseDisplayModule")
        .substringBefore("AsyncFunction(\"getStatusAsync\")")

    assertTrue(source.contains("ALERT_MONITORING_ENABLED_KEY"))
    assertTrue(source.contains("fun alertMonitoringEnabled(context: Context)"))
    assertTrue(serviceStart.contains("collectorMode(this)"))
    assertTrue(bootReceiver.contains("T1ArcGlucoseSurfaceStartupReconciler.reconcileOnce(context)"))
    assertFalse(bootReceiver.contains("T1ArcGlucoseDisplayState.enabled(context)"))
    assertTrue(startupReconciler.contains("displayEnabled = T1ArcGlucoseDisplayState.enabled(context)"))
    assertTrue(
      startupReconciler.contains(
        "alertMonitoringEnabled = T1ArcGlucoseDisplayState.alertMonitoringEnabled(context)"
      )
    )
    assertTrue(
      startupReconciler.contains(
        "lockScreenVisible = T1ArcGlucoseDisplayState.lockScreenVisible(context)"
      )
    )
    assertTrue(startupReconciler.contains("T1ArcGlucoseNotification.cancel(context)"))
    assertTrue(startupReconciler.contains("T1ArcAodAccessibilityService.snapshotChanged()"))
    assertTrue(
      startupReconciler.contains(
        "T1ArcGlucoseAlertOwnershipGate.cancelIfUnownedOrPrivate(context)"
      )
    )
    assertTrue(alertOwnershipGate.contains("fun cancelIfUnownedOrPrivate(context: Context)"))
    assertTrue(
      alertOwnershipGate.contains(
        "isLockScreenVisible = { T1ArcGlucoseDisplayState.lockScreenVisible(context) }"
      )
    )
    assertTrue(startupReconciler.contains("T1ArcAndroidAuto.settingChanged(context)"))
    assertTrue(startupReconciler.contains("T1ArcGlucoseDisplayService.reconcile(context)"))
    assertTrue(
      moduleStartup.contains(
        "appContext.reactContext?.let(T1ArcGlucoseSurfaceStartupReconciler::reconcileOnce)"
      )
    )
  }

  @Test
  fun `alerts-only foreground notification is private and contains no reading`() {
    val monitoringNotification =
      glucoseDisplayModuleSource()
        .substringAfter("fun buildPrivateMonitoring(context: Context)")
        .substringBefore("fun build(context: Context)")

    assertTrue(monitoringNotification.contains("Notification.VISIBILITY_PRIVATE"))
    assertTrue(monitoringNotification.contains("setPublicVersion(publicVersion)"))
    assertFalse(monitoringNotification.contains("T1ArcGlucoseDisplayState.snapshot"))
    assertFalse(monitoringNotification.contains("mmol"))
    assertFalse(monitoringNotification.contains("glucoseDisplayTitle"))
  }
}

class AodBitmapOwnershipContractTest {
  @Test
  fun `AOD source never manually recycles bitmaps still owned by Android rendering`() {
    assertFalse(glucoseDisplayModuleSource().contains(".recycle("))
  }
}

class AodDisableCleanupContractTest {
  @Test
  fun `disabling live display atomically persists AOD off before cancel and reconcile`() {
    val source = glucoseDisplayModuleSource()
    val durableDisable =
      source
        .substringAfter("fun disableDisplayAndAod(context: Context)")
        .substringBefore("fun setAlertMonitoringEnabled")
    val disableBlock =
      source
        .substringAfter("AsyncFunction(\"disableAsync\")")
        .substringBefore("AsyncFunction(\"setLockScreenVisibleAsync\")")
    val disableFence = disableBlock.indexOf("T1ArcGlucosePhoneSurfaceGate.disable(context)")
    val cancelNotification = disableBlock.indexOf("T1ArcGlucoseNotification.cancel(context)")
    val reconcileService =
      disableBlock.indexOf("T1ArcGlucoseDisplayService.reconcile(context)")

    assertTrue(durableDisable.contains("putBoolean(ENABLED_KEY, false)"))
    assertTrue(durableDisable.contains("putBoolean(AOD_DESIRED_KEY, false)"))
    assertTrue(durableDisable.contains(".commit()"))
    assertTrue(disableFence >= 0)
    assertTrue(cancelNotification > disableFence)
    assertTrue(reconcileService > cancelNotification)
  }
}

class GlucosePrivacyPreferenceDurabilityContractTest {
  @Test
  fun `android auto is private by default until the user opts in`() {
    val source = glucoseDisplayModuleSource()
    val getter =
      source
        .substringAfter("fun androidAutoEnabled(context: Context)")
        .substringBefore("fun glucoseUnit")

    assertTrue(getter.contains("getBoolean(ANDROID_AUTO_ENABLED_KEY, false)"))
  }

  @Test
  fun `each glucose surface privacy setter uses a checked synchronous commit`() {
    val source = glucoseDisplayModuleSource()
    val blocks =
      listOf(
        source.substringAfter("fun setEnabled(context: Context").substringBefore("fun disableDisplayAndAod"),
        source.substringAfter("fun setLockScreenVisible(context: Context").substringBefore("fun setAodDesired"),
        source.substringAfter("fun setAodDesired(context: Context").substringBefore("fun setAodPosition"),
        source.substringAfter("fun setAodPosition(context: Context").substringBefore("fun setAodSize"),
        source.substringAfter("fun setAodSize(context: Context").substringBefore("fun setAndroidAutoEnabled"),
        source.substringAfter("fun setAndroidAutoEnabled(context: Context").substringBefore("fun appearance"),
      )

    blocks.forEach { block ->
      assertTrue(block.contains("check("))
      assertTrue(block.contains(".commit()"))
      assertFalse(block.contains(".apply()"))
    }
  }

  @Test
  fun `production and test alert posts share the native ownership and privacy fence`() {
    val source = glucoseDisplayModuleSource()
    val productionShow =
      source
        .substringAfter("private object T1ArcGlucoseAlertNotification")
        .substringAfter("fun show(")
        .substringBefore("fun showTest")
    val testShow =
      source
        .substringAfter("fun showTest(")
        .substringBefore("fun cancelAll")
    val ownerBridge =
      source
        .substringAfter("AsyncFunction(\"setGlucoseAlertMonitoringEnabledAsync\")")
        .substringBefore("AsyncFunction(\"cancelGlucoseAlertsAsync\")")
    val privacyBridge =
      source
        .substringAfter("AsyncFunction(\"setLockScreenVisibleAsync\")")
        .substringBefore("AsyncFunction(\"setAodDesiredAsync\")")
    val guardedDelivery =
      productionShow.substringAfter(
        "return T1ArcGlucoseAlertOwnershipGate.notifyIfOwned(context)"
      )
    val guardedTestDelivery =
      testShow.substringAfter(
        "return T1ArcGlucoseAlertOwnershipGate.notifyIfOwned(context)"
      )

    assertTrue(productionShow.contains("T1ArcGlucoseAlertOwnershipGate.notifyIfOwned(context)"))
    assertTrue(guardedDelivery.contains("T1ArcGlucoseDisplayState.lockScreenVisible(context)"))
    assertTrue(guardedDelivery.contains(".notify(alertKind.notificationId, notification.build())"))
    assertTrue(testShow.contains("T1ArcGlucoseAlertOwnershipGate.notifyIfOwned(context)"))
    assertTrue(guardedTestDelivery.contains("T1ArcGlucoseDisplayState.lockScreenVisible(context)"))
    assertTrue(
      guardedTestDelivery.contains(".notify(alertKind.testNotificationId, notification.build())")
    )
    assertTrue(ownerBridge.contains("T1ArcGlucoseAlertOwnershipGate.updateOwner(context, enabled)"))
    assertTrue(
      privacyBridge.contains(
        "T1ArcGlucoseAlertOwnershipGate.updateLockScreenVisibility(context, visible)"
      )
    )
  }
}
