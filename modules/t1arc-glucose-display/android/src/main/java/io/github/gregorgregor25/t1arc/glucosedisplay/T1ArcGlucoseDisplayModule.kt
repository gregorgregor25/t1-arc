package io.github.gregorgregor25.t1arc.glucosedisplay

import android.Manifest
import android.accessibilityservice.AccessibilityService
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationChannelGroup
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.Icon
import android.hardware.display.DisplayManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.text.SpannableString
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.StrikethroughSpan
import android.util.Base64
import android.util.Log
import android.view.Display
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.widget.ImageView
import android.widget.RemoteViews
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.DataMap
import com.google.android.gms.wearable.DataItem
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyStore
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private const val PREFERENCES_NAME = "t1arc_glucose_display"
private const val ENABLED_KEY = "enabled"
private const val ALERT_MONITORING_ENABLED_KEY = "glucose_alert_monitoring_enabled"
private const val LOCK_SCREEN_VISIBLE_KEY = "lock_screen_visible"
private const val AOD_DESIRED_KEY = "aod_desired"
private const val AOD_POSITION_KEY = "aod_position"
private const val DEFAULT_AOD_POSITION = "bottomCenter"
private const val AOD_SIZE_KEY = "aod_size"
private const val DEFAULT_AOD_SIZE = "standard"
private const val ANDROID_AUTO_ENABLED_KEY = "android_auto_enabled"
private const val DISPLAY_GLUCOSE_UNIT_KEY = "regional_glucose_unit_v1"
private const val DISPLAY_LOCALE_TAG_KEY = "regional_locale_tag_v1"
private const val DISPLAY_TIME_ZONE_KEY = "regional_time_zone_v1"
private const val SNAPSHOT_PAYLOAD_KEY = "snapshot_encrypted_payload"
private const val SNAPSHOT_IV_KEY = "snapshot_encrypted_iv"
private const val SNAPSHOT_KEY_ALIAS = "t1arc.glucose-display.snapshot.v1"
private const val GLUCOSE_PUBLICATION_EPOCH_KEY = "glucose_publication_epoch_v1"
private const val VERY_LOW_MAX_KEY = "appearance_very_low_max"
private const val TARGET_MIN_KEY = "appearance_target_min"
private const val TARGET_MAX_KEY = "appearance_target_max"
private const val VERY_HIGH_MIN_KEY = "appearance_very_high_min"
private const val COLOR_VERY_LOW_KEY = "appearance_color_very_low"
private const val COLOR_LOW_KEY = "appearance_color_low"
private const val COLOR_TARGET_KEY = "appearance_color_target"
private const val COLOR_HIGH_KEY = "appearance_color_high"
private const val COLOR_VERY_HIGH_KEY = "appearance_color_very_high"
private const val COLOR_STALE_KEY = "appearance_color_stale"
private const val AOD_LAST_EVENT_KEY = "aod_last_event"
private const val AOD_LAST_ERROR_KEY = "aod_last_error"
private const val CHANNEL_ID = "t1arc_current_glucose_prominent_v2"
private const val NOTIFICATION_ID = 6417
private const val REVIEW_CHANNEL_ID = "t1arc_weekly_review_v1"
private const val REVIEW_NOTIFICATION_ID = 6418
private const val CONNECTOR_CHANNEL_ID = "t1arc_data_connections_v1"
private const val GLOOKO_SIGN_IN_NOTIFICATION_ID = 6419
private const val ALERT_CHANNEL_GROUP_ID = "t1arc_glucose_alerts_group_v1"
private const val HEADLESS_TASK_KEY = "T1ArcLibreForegroundSync"
private const val HEADLESS_REASON_EXTRA = "io.github.gregorgregor25.t1arc.glucosedisplay.HEADLESS_REASON"
private const val DISPLAY_SYNC_REASON = "glucose-display"
private const val VALIDATED_NETWORK_SYNC_REASON = "validated-network"
private const val DISPLAY_REFRESH_INTERVAL_MS = 60_000L
private const val GLUCOSE_SYNC_BASE_TICK_MS = 60_000L
private const val GLUCOSE_SYNC_CATCH_UP_TICK_MS = 15_000L
private const val GLUCOSE_SYNC_CATCH_UP_AFTER_MS = 4 * 60_000L + 30_000L
// JS cancels an overlong source owner at 95 seconds. Keep the native task alive
// long enough for the abort and bounded SQLite cleanup to finish, while still
// enforcing an outer lifetime if the JS runtime itself becomes unavailable.
private const val HEADLESS_TIMEOUT_MS = 120_000L
private const val CURRENT_AFTER_MS = 6 * 60_000L
private const val STALE_AFTER_MS = 12 * 60_000L
private const val WEAR_GLUCOSE_PATH = "/t1arc/v1/glucose/current"
private const val WEAR_GLUCOSE_HISTORY_PATH = "/t1arc/v1/glucose/history"
private const val WEAR_GLUCOSE_REQUEST_PATH = "/t1arc/v1/glucose/request"
private const val WEAR_CAPABILITY = "t1arc_glucose_companion_v1"
private const val WEAR_WRITE_EPOCH_FIELD = "localDataWriteEpoch"
private const val WEAR_LOG_TAG = "T1ArcWearSync"

/** Canonical links emitted by native T1 Arc surfaces. Legacy links remain accepted by JS. */
internal object T1ArcAppLinks {
  const val TODAY = "t1arc://today"
  const val LOG_FOOD = "t1arc://today/log-food"
  const val LOG_CONTEXT = "t1arc://today/log-context"
  const val INSIGHTS = "t1arc://insights"
  const val SOURCES = "t1arc://sources"
}

/**
 * Decides when a default-network transition warrants one recovery sync.
 *
 * Android can report several capability changes for the same default network.
 * Only an INTERNET + VALIDATED transition for the current default network is
 * actionable; repeated validated callbacks coalesce until connectivity is lost
 * again. Keeping this Android-free makes the policy deterministic in unit tests.
 */
internal class ValidatedNetworkSyncPolicy {
  private var currentNetworkHandle: Long? = null
  private var currentNetworkWasValidated = false
  private var stopped = false

  @Synchronized
  fun onAvailable(networkHandle: Long) {
    if (stopped || currentNetworkHandle == networkHandle) return
    currentNetworkHandle = networkHandle
    currentNetworkWasValidated = false
  }

  @Synchronized
  fun onCapabilitiesChanged(
    networkHandle: Long,
    hasInternet: Boolean,
    isValidated: Boolean,
  ): Boolean {
    if (stopped || currentNetworkHandle != networkHandle) return false
    val ready = hasInternet && isValidated
    if (!ready) {
      // A validated default network can temporarily lose internet without
      // receiving a new Network handle. Arm exactly one recovery sync for the
      // next unvalidated -> validated transition.
      currentNetworkWasValidated = false
      return false
    }
    if (currentNetworkWasValidated) return false
    currentNetworkWasValidated = true
    return true
  }

  @Synchronized
  fun onLost(networkHandle: Long) {
    if (currentNetworkHandle != networkHandle) return
    currentNetworkHandle = null
    currentNetworkWasValidated = false
  }

  @Synchronized
  fun stop() {
    stopped = true
    currentNetworkHandle = null
    currentNetworkWasValidated = false
  }
}

/** Pure guard against callbacks from an obsolete AOD lifecycle generation. */
internal class AodOverlayLifecyclePolicy {
  private var generation = 0L

  @Synchronized fun token(): Long = generation

  @Synchronized
  fun invalidate(): Long {
    generation += 1L
    return generation
  }

  @Synchronized
  fun shouldRender(
    token: Long,
    interactive: Boolean,
    displayIsDozing: Boolean,
    displayEnabled: Boolean,
    aodDesired: Boolean,
    snapshotAvailable: Boolean,
  ): Boolean =
    token == generation &&
      !interactive &&
      displayIsDozing &&
      displayEnabled &&
      aodDesired &&
      snapshotAvailable
}
private const val MAX_WEAR_HISTORY_POINTS = 144

private val AOD_POSITIONS =
  setOf(
    "topLeft",
    "topCenter",
    "topRight",
    "middleLeft",
    "middleCenter",
    "middleRight",
    "bottomLeft",
    "bottomCenter",
    "bottomRight",
  )

private val AOD_SIZES = setOf("small", "standard", "large")

private data class AodRenderSpec(
  val widthDp: Int,
  val heightDp: Int,
  val valueSp: Int,
  val unitSp: Int,
  val statusSp: Int,
  val valueBaselineDp: Int,
  val unitBaselineDp: Int,
  val statusBaselineDp: Int,
)

private val AOD_COLORS =
  mapOf(
    "rose" to Color.rgb(255, 155, 174),
    "amber" to Color.rgb(241, 182, 111),
    "orange" to Color.rgb(255, 176, 102),
    "cyan" to Color.rgb(101, 210, 231),
    "green" to Color.rgb(105, 213, 172),
    "blue" to Color.rgb(142, 167, 255),
    "purple" to Color.rgb(194, 169, 255),
    "slate" to Color.rgb(169, 189, 194),
  )

internal data class GlucoseAppearance(
  val veryLowMax: Double,
  val targetMin: Double,
  val targetMax: Double,
  val veryHighMin: Double,
  val veryLowColor: String,
  val lowColor: String,
  val targetColor: String,
  val highColor: String,
  val veryHighColor: String,
  val staleColor: String,
) {
  fun asMap(): Map<String, Any> =
    mapOf(
      "veryLowMax" to veryLowMax,
      "targetMin" to targetMin,
      "targetMax" to targetMax,
      "veryHighMin" to veryHighMin,
      "colors" to
        mapOf(
          "veryLow" to veryLowColor,
          "low" to lowColor,
          "target" to targetColor,
          "high" to highColor,
          "veryHigh" to veryHighColor,
          "stale" to staleColor,
        ),
    )

  fun tokenFor(value: Double, freshness: DisplayFreshness): String {
    if (freshness == DisplayFreshness.STALE || freshness == DisplayFreshness.MISSING) {
      return staleColor
    }
    return when {
      value <= veryLowMax -> veryLowColor
      value < targetMin -> lowColor
      value <= targetMax -> targetColor
      value < veryHighMin -> highColor
      else -> veryHighColor
    }
  }

  fun categoryFor(value: Double): String =
    when {
      value <= veryLowMax -> "veryLow"
      value < targetMin -> "low"
      value <= targetMax -> "target"
      value < veryHighMin -> "high"
      else -> "veryHigh"
    }
}

internal data class GlucoseDisplaySnapshot(
  val mmolL: Double,
  val trend: String,
  val trendOrigin: String,
  val timestampMs: Long,
  val sourceLabel: String,
  val sourceHasError: Boolean,
)

internal data class GlucoseHistoryPoint(
  val mmolL: Double,
  val timestampMs: Long,
)

private fun validatedGlucoseSnapshot(
  mmolL: Double,
  trend: String,
  timestampMs: Double,
  sourceLabel: String,
  sourceHasError: Boolean,
  trendOrigin: String,
): GlucoseDisplaySnapshot {
  require(mmolL in 0.5..40.0) { "Glucose value is outside the displayable range." }
  require(timestampMs.isFinite() && timestampMs > 0 && timestampMs.toLong().toDouble() == timestampMs) {
    "Glucose timestamp is invalid."
  }
  require(trendOrigin in setOf("source", "calculated", "unavailable")) {
    "Glucose trend origin is invalid."
  }
  return GlucoseDisplaySnapshot(
    mmolL = mmolL,
    trend = trend,
    trendOrigin = trendOrigin,
    timestampMs = timestampMs.toLong(),
    sourceLabel = sourceLabel.take(80),
    sourceHasError = sourceHasError,
  )
}

private fun snapshotFromBridgeMap(value: Map<String, Any?>?): GlucoseDisplaySnapshot? {
  if (value == null) return null
  return validatedGlucoseSnapshot(
    mmolL = (value["mmolL"] as? Number)?.toDouble() ?: Double.NaN,
    trend = value["trend"] as? String ?: "unknown",
    timestampMs = (value["timestampMs"] as? Number)?.toDouble() ?: Double.NaN,
    sourceLabel = value["sourceLabel"] as? String ?: "Personal glucose source",
    sourceHasError = value["sourceHasError"] as? Boolean ?: false,
    trendOrigin = value["trendOrigin"] as? String ?: "unavailable",
  )
}

private fun historyFromBridgeMaps(
  readings: List<Map<String, Any?>>,
): List<GlucoseHistoryPoint> =
  readings.mapNotNull { reading ->
    val mmolL = (reading["mmolL"] as? Number)?.toDouble()
    val timestampMs = (reading["timestampMs"] as? Number)?.toLong()
    if (
      mmolL == null ||
        !mmolL.isFinite() ||
        mmolL !in 0.5..40.0 ||
        timestampMs == null ||
        timestampMs <= 0L
    ) {
      null
    } else {
      GlucoseHistoryPoint(mmolL, timestampMs)
    }
  }

private object T1ArcSnapshotCipher {
  private fun secretKey(): SecretKey {
    val keyStore =
      KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keyStore.getKey(SNAPSHOT_KEY_ALIAS, null) as? SecretKey)?.let {
      return it
    }
    val generator =
      KeyGenerator.getInstance(
        KeyProperties.KEY_ALGORITHM_AES,
        "AndroidKeyStore",
      )
    generator.init(
      KeyGenParameterSpec.Builder(
          SNAPSHOT_KEY_ALIAS,
          KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true)
        .build()
    )
    return generator.generateKey()
  }

  fun encrypt(value: GlucoseDisplaySnapshot): Pair<String, String> {
    val json =
      JSONObject()
        .put("mmolL", value.mmolL)
        .put("trend", value.trend)
        .put("trendOrigin", value.trendOrigin)
        .put("timestampMs", value.timestampMs)
        .put("sourceLabel", value.sourceLabel)
        .put("sourceHasError", value.sourceHasError)
        .toString()
        .toByteArray(Charsets.UTF_8)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, secretKey())
    return Base64.encodeToString(cipher.doFinal(json), Base64.NO_WRAP) to
      Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
  }

  fun decrypt(payload: String, iv: String): GlucoseDisplaySnapshot? {
    return try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(
        Cipher.DECRYPT_MODE,
        secretKey(),
        GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)),
      )
      val json =
        JSONObject(
          cipher
            .doFinal(Base64.decode(payload, Base64.NO_WRAP))
            .toString(Charsets.UTF_8)
        )
      GlucoseDisplaySnapshot(
        mmolL = json.getDouble("mmolL"),
        trend = json.optString("trend", "unknown"),
        trendOrigin = json.optString("trendOrigin", "source"),
        timestampMs = json.getLong("timestampMs"),
        sourceLabel = json.optString("sourceLabel", "Saved glucose"),
        sourceHasError = json.optBoolean("sourceHasError", false),
      )
    } catch (_: Exception) {
      null
    }
  }
}

internal enum class DisplayFreshness(val wireValue: String, val label: String) {
  CURRENT("current", "Current"),
  DELAYED("delayed", "Delayed"),
  STALE("stale", "Stale"),
  MISSING("missing", "Missing"),
}

internal object DisplayFreshnessPolicy {
  @Suppress("UNUSED_PARAMETER")
  fun resolve(
    timestampMs: Long,
    now: Long,
    sourceHasError: Boolean,
  ): DisplayFreshness {
    // A previous request failure is useful diagnostic metadata, but it must not
    // make a genuinely current reading look delayed. Freshness is a statement
    // about the reading timestamp only.
    val age = max(0L, now - timestampMs)
    return when {
      age <= CURRENT_AFTER_MS -> DisplayFreshness.CURRENT
      age <= STALE_AFTER_MS -> DisplayFreshness.DELAYED
      else -> DisplayFreshness.STALE
    }
  }
}

internal object GlucoseSyncCadencePolicy {
  fun nextDelayMs(timestampMs: Long?, now: Long): Long {
    if (timestampMs == null || timestampMs <= 0L) return GLUCOSE_SYNC_BASE_TICK_MS
    val age = max(0L, now - timestampMs)
    return if (age in GLUCOSE_SYNC_CATCH_UP_AFTER_MS..STALE_AFTER_MS) {
      GLUCOSE_SYNC_CATCH_UP_TICK_MS
    } else {
      GLUCOSE_SYNC_BASE_TICK_MS
    }
  }
}

internal enum class GlucoseCollectorForegroundMode {
  STOPPED,
  PRIVATE_MONITORING,
  GLUCOSE_DISPLAY,
}

internal object GlucoseCollectorOwnershipPolicy {
  fun defaultAlertMonitoringEnabled() = false

  fun resolve(
    displayEnabled: Boolean,
    alertMonitoringEnabled: Boolean,
  ): GlucoseCollectorForegroundMode =
    when {
      displayEnabled -> GlucoseCollectorForegroundMode.GLUCOSE_DISPLAY
      alertMonitoringEnabled -> GlucoseCollectorForegroundMode.PRIVATE_MONITORING
      else -> GlucoseCollectorForegroundMode.STOPPED
    }
}

/**
 * Serializes a display publication with the durable disable-and-cancel fence.
 * The Android-free implementation is intentionally small enough for a
 * deterministic latch test.
 */
internal class GlucoseDisplaySurfaceFence {
  private val lock = Any()

  fun <T> mutate(operation: () -> T): T = synchronized(lock) { operation() }

  fun publishIfEnabled(
    isEnabled: () -> Boolean,
    publish: () -> Unit,
  ): Boolean =
    synchronized(lock) {
      if (!isEnabled()) return@synchronized false
      publish()
      true
    }

  fun disable(
    persistDisabledAndAodOff: () -> Unit,
    cancel: () -> Unit,
  ) {
    synchronized(lock) {
      // Cancellation is deliberately sequenced after the checked disk commit.
      // A successful return therefore means a restarted process also stays off.
      persistDisabledAndAodOff()
      cancel()
    }
  }
}

/** Serializes production glucose-alert delivery with its native owner. */
internal class GlucoseAlertOwnershipFence {
  private val lock = Any()

  fun updateOwner(
    enabled: Boolean,
    persist: () -> Boolean,
    cancel: () -> Unit,
  ): Boolean =
    synchronized(lock) {
      val changed = persist()
      if (!enabled) cancel()
      changed
    }

  fun notifyIfOwned(
    isOwned: () -> Boolean,
    notify: () -> Unit,
  ): Boolean =
    synchronized(lock) {
      if (!isOwned()) return@synchronized false
      notify()
      true
    }

  fun updateLockScreenVisibility(
    visible: Boolean,
    persist: () -> Unit,
    cancelAlertsWhenPrivate: () -> Unit,
  ) {
    synchronized(lock) {
      // The checked preference commit and cleanup share the production alert
      // delivery lock. A delivery already inside the fence completes first and
      // is then cancelled; a deferred delivery sees the newly private value.
      persist()
      if (!visible) cancelAlertsWhenPrivate()
    }
  }

  fun cancelIfUnownedOrPrivate(
    isOwned: () -> Boolean,
    isLockScreenVisible: () -> Boolean,
    cancel: () -> Unit,
  ) {
    synchronized(lock) {
      if (!isOwned() || !isLockScreenVisible()) cancel()
    }
  }
}

internal data class PersistedGlucoseSurfaceState(
  val displayEnabled: Boolean,
  val aodDesired: Boolean,
  val androidAutoEnabled: Boolean,
  val alertMonitoringEnabled: Boolean,
  val lockScreenVisible: Boolean,
)

internal data class GlucoseSurfaceStartupCleanup(
  val cancelDisplayNotification: Boolean,
  val removeAodOverlay: Boolean,
  val cancelAndroidAuto: Boolean,
  val cancelGlucoseAlerts: Boolean,
)

internal object GlucoseSurfaceStartupPolicy {
  fun resolve(state: PersistedGlucoseSurfaceState) =
    GlucoseSurfaceStartupCleanup(
      cancelDisplayNotification = !state.displayEnabled,
      removeAodOverlay = !state.displayEnabled || !state.aodDesired,
      cancelAndroidAuto = !state.androidAutoEnabled,
      cancelGlucoseAlerts = !state.alertMonitoringEnabled || !state.lockScreenVisible,
    )
}

internal fun staleReadingText(
  value: String,
  freshness: DisplayFreshness,
): CharSequence {
  if (freshness != DisplayFreshness.STALE) return value
  return SpannableString(value).apply {
    setSpan(
      StrikethroughSpan(),
      0,
      length,
      Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
    )
  }
}

internal fun glucoseDisplayTitle(
  value: String,
  suffix: String,
  freshness: DisplayFreshness,
): CharSequence =
  SpannableStringBuilder().apply {
    if (freshness == DisplayFreshness.STALE) append("Last known ")
    append(staleReadingText(value, freshness))
    append(suffix)
  }

internal object T1ArcGlucoseDisplayState {
  @Volatile var snapshot: GlucoseDisplaySnapshot? = null
  val headlessTaskActive = AtomicBoolean(false)

  fun preferences(context: Context) =
    context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  fun enabled(context: Context) =
    preferences(context).getBoolean(ENABLED_KEY, false)

  fun alertMonitoringEnabled(context: Context) =
    preferences(context).getBoolean(
      ALERT_MONITORING_ENABLED_KEY,
      GlucoseCollectorOwnershipPolicy.defaultAlertMonitoringEnabled(),
    )

  fun collectorMode(context: Context) =
    GlucoseCollectorOwnershipPolicy.resolve(
      displayEnabled = enabled(context),
      alertMonitoringEnabled = alertMonitoringEnabled(context),
    )

  fun collectorEnabled(context: Context) =
    collectorMode(context) != GlucoseCollectorForegroundMode.STOPPED

  fun lockScreenVisible(context: Context): Boolean {
    val stored = preferences(context)
    return resolveLockScreenVisibility(
      if (stored.contains(LOCK_SCREEN_VISIBLE_KEY)) {
        stored.getBoolean(LOCK_SCREEN_VISIBLE_KEY, false)
      } else {
        null
      }
    )
  }

  fun aodDesired(context: Context) =
    preferences(context).getBoolean(AOD_DESIRED_KEY, false)

  fun aodPosition(context: Context): String {
    val stored =
      preferences(context).getString(AOD_POSITION_KEY, DEFAULT_AOD_POSITION)
    return stored?.takeIf(AOD_POSITIONS::contains) ?: DEFAULT_AOD_POSITION
  }

  fun aodSize(context: Context): String {
    val stored = preferences(context).getString(AOD_SIZE_KEY, DEFAULT_AOD_SIZE)
    return stored?.takeIf(AOD_SIZES::contains) ?: DEFAULT_AOD_SIZE
  }

  fun androidAutoEnabled(context: Context) =
    preferences(context).getBoolean(ANDROID_AUTO_ENABLED_KEY, false)

  fun glucoseUnit(context: Context): String =
    preferences(context)
      .getString(DISPLAY_GLUCOSE_UNIT_KEY, "mmolL")
      .takeIf { it == "mmolL" || it == "mgDl" }
      ?: "mmolL"

  fun displayLocale(context: Context): Locale {
    val tag = preferences(context).getString(DISPLAY_LOCALE_TAG_KEY, null)
    return tag
      ?.takeIf { it.isNotBlank() }
      ?.let(Locale::forLanguageTag)
      ?.takeIf { it.language.isNotBlank() }
      ?: Locale.getDefault()
  }

  fun displayTimeZone(context: Context): TimeZone {
    val id = preferences(context).getString(DISPLAY_TIME_ZONE_KEY, null)
    return id
      ?.takeIf { TimeZone.getAvailableIDs().contains(it) }
      ?.let(TimeZone::getTimeZone)
      ?: TimeZone.getDefault()
  }

  fun displayGlucoseValue(context: Context, mmolL: Double): String =
    if (glucoseUnit(context) == "mgDl") {
      String.format(displayLocale(context), "%.0f", mmolL * 18.016)
    } else {
      String.format(displayLocale(context), "%.1f", mmolL)
    }

  fun displayGlucoseUnit(context: Context): String =
    if (glucoseUnit(context) == "mgDl") "mg/dL" else "mmol/L"

  fun displayGlucoseSpokenUnit(context: Context): String =
    if (glucoseUnit(context) == "mgDl") {
      "milligrams per decilitre"
    } else {
      "millimoles per litre"
    }

  fun setRegionalDisplayPreferences(
    context: Context,
    glucoseUnit: String,
    localeTag: String,
    timeZone: String,
  ) {
    require(glucoseUnit == "mmolL" || glucoseUnit == "mgDl") {
      "Glucose display unit is not supported."
    }
    require(localeTag.isNotBlank() && Locale.forLanguageTag(localeTag).language.isNotBlank()) {
      "Display locale is invalid."
    }
    require(TimeZone.getAvailableIDs().contains(timeZone)) {
      "Display timezone is invalid."
    }
    check(
      preferences(context)
        .edit()
        .putString(DISPLAY_GLUCOSE_UNIT_KEY, glucoseUnit)
        .putString(DISPLAY_LOCALE_TAG_KEY, localeTag)
        .putString(DISPLAY_TIME_ZONE_KEY, timeZone)
        .commit()
    ) {
      "Regional display preferences could not be saved."
    }
  }

  fun snapshot(context: Context): GlucoseDisplaySnapshot? {
    snapshot?.let { return it }
    val stored = preferences(context)
    val payload = stored.getString(SNAPSHOT_PAYLOAD_KEY, null) ?: return null
    val iv = stored.getString(SNAPSHOT_IV_KEY, null) ?: return null
    val restored = T1ArcSnapshotCipher.decrypt(payload, iv) ?: return null
    if (!restored.mmolL.isFinite() || restored.mmolL !in 0.5..40.0) return null
    snapshot = restored
    return restored
  }

  fun setSnapshot(context: Context, value: GlucoseDisplaySnapshot) {
    snapshot = value
    runCatching {
      val (payload, iv) = T1ArcSnapshotCipher.encrypt(value)
      preferences(context)
        .edit()
        .putString(SNAPSHOT_PAYLOAD_KEY, payload)
        .putString(SNAPSHOT_IV_KEY, iv)
        .apply()
    }.onFailure {
      // Never fall back to storing a health reading as plain text. The live
      // process can still display the value while diagnostics explain why it
      // cannot be restored after Android restarts the process.
      preferences(context)
        .edit()
        .remove(SNAPSHOT_PAYLOAD_KEY)
        .remove(SNAPSHOT_IV_KEY)
        .putString(
          AOD_LAST_ERROR_KEY,
          "Secure display recovery is unavailable; live display continues",
        )
        .apply()
    }
  }

  fun clearSnapshot(context: Context) {
    snapshot = null
    preferences(context)
      .edit()
      .remove(SNAPSHOT_PAYLOAD_KEY)
      .remove(SNAPSHOT_IV_KEY)
      .apply()
  }

  fun freshness(
    context: Context,
    now: Long = System.currentTimeMillis(),
  ): DisplayFreshness {
    val value = snapshot(context) ?: return DisplayFreshness.MISSING
    return DisplayFreshnessPolicy.resolve(value.timestampMs, now, value.sourceHasError)
  }

  fun setEnabled(context: Context, enabled: Boolean) {
    check(preferences(context).edit().putBoolean(ENABLED_KEY, enabled).commit()) {
      "Glucose display preference could not be saved."
    }
  }

  fun disableDisplayAndAod(context: Context) {
    check(
      preferences(context)
        .edit()
        .putBoolean(ENABLED_KEY, false)
        .putBoolean(AOD_DESIRED_KEY, false)
        .commit()
    ) {
      "Glucose display privacy preferences could not be saved."
    }
  }

  fun setAlertMonitoringEnabled(context: Context, enabled: Boolean): Boolean {
    val stored = preferences(context)
    if (
      stored.contains(ALERT_MONITORING_ENABLED_KEY) &&
        stored.getBoolean(ALERT_MONITORING_ENABLED_KEY, false) == enabled
    ) {
      return false
    }
    // This mirror is the boot/process-restart owner, so commit it before the
    // service is started or stopped. Existing display and SecureStore keys stay
    // unchanged; an older install with no mirror safely defaults to alerts off.
    check(stored.edit().putBoolean(ALERT_MONITORING_ENABLED_KEY, enabled).commit()) {
      "Glucose alert monitoring ownership could not be saved."
    }
    return true
  }

  fun setLockScreenVisible(context: Context, visible: Boolean) {
    check(
      preferences(context).edit().putBoolean(LOCK_SCREEN_VISIBLE_KEY, visible).commit()
    ) {
      "Lock-screen glucose privacy preference could not be saved."
    }
  }

  fun setAodDesired(context: Context, desired: Boolean) {
    check(preferences(context).edit().putBoolean(AOD_DESIRED_KEY, desired).commit()) {
      "Always-on glucose privacy preference could not be saved."
    }
  }

  fun setAodPosition(context: Context, position: String) {
    require(AOD_POSITIONS.contains(position)) {
      "Always-on display position is not supported."
    }
    check(preferences(context).edit().putString(AOD_POSITION_KEY, position).commit()) {
      "Always-on glucose position could not be saved."
    }
  }

  fun setAodSize(context: Context, size: String) {
    require(AOD_SIZES.contains(size)) {
      "Always-on display size is not supported."
    }
    check(preferences(context).edit().putString(AOD_SIZE_KEY, size).commit()) {
      "Always-on glucose size could not be saved."
    }
  }

  fun setAndroidAutoEnabled(context: Context, enabled: Boolean) {
    check(
      preferences(context).edit().putBoolean(ANDROID_AUTO_ENABLED_KEY, enabled).commit()
    ) {
      "Android Auto glucose privacy preference could not be saved."
    }
  }

  fun appearance(context: Context): GlucoseAppearance {
    val stored = preferences(context)
    return GlucoseAppearance(
      veryLowMax = stored.getFloat(VERY_LOW_MAX_KEY, 3.0f).toDouble(),
      targetMin = stored.getFloat(TARGET_MIN_KEY, 3.9f).toDouble(),
      targetMax = stored.getFloat(TARGET_MAX_KEY, 10.0f).toDouble(),
      veryHighMin = stored.getFloat(VERY_HIGH_MIN_KEY, 13.9f).toDouble(),
      veryLowColor = stored.getString(COLOR_VERY_LOW_KEY, "rose") ?: "rose",
      lowColor = stored.getString(COLOR_LOW_KEY, "amber") ?: "amber",
      targetColor = stored.getString(COLOR_TARGET_KEY, "blue") ?: "blue",
      highColor = stored.getString(COLOR_HIGH_KEY, "orange") ?: "orange",
      veryHighColor = stored.getString(COLOR_VERY_HIGH_KEY, "rose") ?: "rose",
      staleColor = stored.getString(COLOR_STALE_KEY, "slate") ?: "slate",
    )
  }

  fun setAppearance(context: Context, appearance: GlucoseAppearance) {
    preferences(context)
      .edit()
      .putFloat(VERY_LOW_MAX_KEY, appearance.veryLowMax.toFloat())
      .putFloat(TARGET_MIN_KEY, appearance.targetMin.toFloat())
      .putFloat(TARGET_MAX_KEY, appearance.targetMax.toFloat())
      .putFloat(VERY_HIGH_MIN_KEY, appearance.veryHighMin.toFloat())
      .putString(COLOR_VERY_LOW_KEY, appearance.veryLowColor)
      .putString(COLOR_LOW_KEY, appearance.lowColor)
      .putString(COLOR_TARGET_KEY, appearance.targetColor)
      .putString(COLOR_HIGH_KEY, appearance.highColor)
      .putString(COLOR_VERY_HIGH_KEY, appearance.veryHighColor)
      .putString(COLOR_STALE_KEY, appearance.staleColor)
      .apply()
  }

  fun displayColor(
    context: Context,
    snapshot: GlucoseDisplaySnapshot?,
    freshness: DisplayFreshness,
  ): Int {
    val appearance = appearance(context)
    val token =
      if (snapshot == null) appearance.staleColor
      else appearance.tokenFor(snapshot.mmolL, freshness)
    return AOD_COLORS[token] ?: AOD_COLORS.getValue("blue")
  }
}

/**
 * One process-wide mutation gate is shared by foreground and Headless JS module
 * instances plus native Wear callbacks. The durable epoch remains authoritative
 * after process death; a stale bridge call can never lower it.
 */
internal object T1ArcGlucosePublicationGate {
  private val arbiter = GlucosePublicationEpochArbiter()

  private fun storedEpoch(context: Context): Long {
    val epoch =
      T1ArcGlucoseDisplayState.preferences(context)
        .getLong(GLUCOSE_PUBLICATION_EPOCH_KEY, 0L)
    check(epoch >= 0L) { "The native glucose privacy epoch is invalid." }
    return epoch
  }

  private fun bridgeEpoch(value: Double): Long =
    requireNotNull(GlucosePublicationEpochPolicy.parseBridgeEpoch(value)) {
      "The glucose publication epoch is invalid."
    }

  fun <T> mutateForEpoch(
    context: Context,
    requestedEpoch: Double,
    mutation: (Long) -> T,
  ): T =
    arbiter.mutate(
      requested = bridgeEpoch(requestedEpoch),
      readCurrent = { storedEpoch(context) },
      mutation = mutation,
    )

  fun <T> clearForEpoch(
    context: Context,
    requestedEpoch: Double,
    mutation: (Long) -> T,
  ): T =
    arbiter.clear(
      requested = bridgeEpoch(requestedEpoch),
      readCurrent = { storedEpoch(context) },
      persistEpochAndClearSnapshot = { next ->
        T1ArcGlucoseDisplayState.preferences(context)
          .edit()
          .putLong(GLUCOSE_PUBLICATION_EPOCH_KEY, next)
          // Persist the epoch and remove the recoverable private snapshot in
          // one disk commit. A process death before the remaining surface
          // cleanup can therefore lose display state, but cannot resurrect a
          // snapshot from the preceding privacy epoch.
          .remove(SNAPSHOT_PAYLOAD_KEY)
          .remove(SNAPSHOT_IV_KEY)
          .commit()
      },
      mutation = mutation,
    )

  fun <T> mutateLegacy(context: Context, mutation: (Long) -> T): T =
    arbiter.mutateLegacy({ storedEpoch(context) }, mutation)

  fun <T> observeCurrent(context: Context, operation: (Long) -> T): T =
    arbiter.observe({ storedEpoch(context) }, operation)

  fun ifCurrent(context: Context, epoch: Long, operation: () -> Unit) {
    arbiter.ifCurrent({ storedEpoch(context) }, epoch, operation)
  }
}

/** Serializes only the short phone-surface commit, never the bounded Wear I/O. */
private object T1ArcGlucosePhoneSurfaceGate {
  private val fence = GlucoseDisplaySurfaceFence()

  fun <T> mutate(operation: () -> T): T = fence.mutate(operation)

  fun publishIfEnabled(context: Context, publication: () -> Unit): Boolean =
    fence.publishIfEnabled(
      isEnabled = { T1ArcGlucoseDisplayState.enabled(context) },
      publish = publication,
    )

  fun disable(context: Context, cancel: () -> Unit) {
    fence.disable(
      persistDisabledAndAodOff = {
        T1ArcGlucoseDisplayState.disableDisplayAndAod(context)
      },
      cancel = cancel,
    )
  }
}

private object T1ArcGlucoseAlertOwnershipGate {
  private val fence = GlucoseAlertOwnershipFence()

  fun updateOwner(context: Context, enabled: Boolean): Boolean =
    fence.updateOwner(
      enabled = enabled,
      persist = {
        T1ArcGlucoseDisplayState.setAlertMonitoringEnabled(context, enabled)
      },
      cancel = { T1ArcGlucoseAlertNotification.cancelAll(context) },
    )

  fun notifyIfOwned(context: Context, notify: () -> Unit): Boolean =
    fence.notifyIfOwned(
      isOwned = { T1ArcGlucoseDisplayState.alertMonitoringEnabled(context) },
      notify = notify,
    )

  fun updateLockScreenVisibility(context: Context, visible: Boolean) {
    fence.updateLockScreenVisibility(
      visible = visible,
      persist = {
        // Lock ordering is always alert-delivery then phone-surface. No phone
        // path acquires the alert fence, which keeps the two fences deadlock-free.
        T1ArcGlucosePhoneSurfaceGate.mutate {
          T1ArcGlucoseDisplayState.setLockScreenVisible(context, visible)
        }
      },
      cancelAlertsWhenPrivate = { T1ArcGlucoseAlertNotification.cancelAll(context) },
    )
  }

  fun cancelIfUnownedOrPrivate(context: Context) {
    fence.cancelIfUnownedOrPrivate(
      isOwned = { T1ArcGlucoseDisplayState.alertMonitoringEnabled(context) },
      isLockScreenVisible = { T1ArcGlucoseDisplayState.lockScreenVisible(context) },
      cancel = { T1ArcGlucoseAlertNotification.cancelAll(context) },
    )
  }
}

private object T1ArcGlucoseWidget {
  private fun pendingIntent(context: Context): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: return null
    launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context,
      6420,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun trendPresentation(trend: String): Pair<String, String> =
    when (trend) {
      "doubleDown" -> "⇊" to "Falling quickly"
      "down" -> "↓" to "Falling"
      "slightDown" -> "↘" to "Falling slowly"
      "flat" -> "→" to "Steady"
      "slightUp" -> "↗" to "Rising slowly"
      "up" -> "↑" to "Rising"
      "doubleUp" -> "⇈" to "Rising quickly"
      else -> "?" to "Direction unavailable"
    }

  private fun ageCopy(timestampMs: Long, now: Long, locale: Locale): String {
    val minutes = floor(max(0L, now - timestampMs) / 60_000.0).toInt()
    return when (minutes) {
      0 -> "JUST NOW"
      1 -> "${RegionalNumberFormatter.integer(1L, locale)} MIN AGO"
      in 2..59 -> "${RegionalNumberFormatter.integer(minutes.toLong(), locale)} MIN AGO"
      else -> "${RegionalNumberFormatter.integer((minutes / 60).toLong(), locale)} HR AGO"
    }
  }

  fun render(context: Context): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.t1arc_glucose_widget)
    val snapshot = T1ArcGlucoseDisplayState.snapshot(context)
    val now = System.currentTimeMillis()
    val freshness = T1ArcGlucoseDisplayState.freshness(context, now)
    val color =
      T1ArcGlucoseDisplayState.displayColor(context, snapshot, freshness)
    views.setTextViewText(
      R.id.t1arc_widget_unit,
      T1ArcGlucoseDisplayState.displayGlucoseUnit(context),
    )
    if (snapshot == null) {
      views.setTextViewText(R.id.t1arc_widget_value, "—")
      views.setInt(R.id.t1arc_widget_value, "setPaintFlags", Paint.ANTI_ALIAS_FLAG)
      views.setTextViewText(R.id.t1arc_widget_trend, "")
      views.setInt(R.id.t1arc_widget_trend, "setPaintFlags", Paint.ANTI_ALIAS_FLAG)
      views.setTextViewText(R.id.t1arc_widget_age, "NO DATA")
      views.setTextViewText(
        R.id.t1arc_widget_status,
        "Waiting for personal glucose",
      )
      views.setContentDescription(
        R.id.t1arc_widget_root,
        "T1 Arc. No personal glucose available.",
      )
    } else {
      val (arrow, direction) = trendPresentation(snapshot.trend)
      val directionCopy =
        if (snapshot.trendOrigin == "calculated") "$direction (calculated)" else direction
      val value = T1ArcGlucoseDisplayState.displayGlucoseValue(context, snapshot.mmolL)
      views.setTextViewText(R.id.t1arc_widget_value, value)
      val readingPaintFlags =
        Paint.ANTI_ALIAS_FLAG or
          (if (freshness == DisplayFreshness.STALE) Paint.STRIKE_THRU_TEXT_FLAG else 0)
      views.setInt(R.id.t1arc_widget_value, "setPaintFlags", readingPaintFlags)
      views.setTextViewText(R.id.t1arc_widget_trend, arrow)
      views.setInt(R.id.t1arc_widget_trend, "setPaintFlags", readingPaintFlags)
      views.setTextViewText(
        R.id.t1arc_widget_age,
        ageCopy(snapshot.timestampMs, now, T1ArcGlucoseDisplayState.displayLocale(context)),
      )
      views.setTextViewText(
        R.id.t1arc_widget_status,
        if (freshness == DisplayFreshness.STALE) {
          "Last known · Stale · ${snapshot.sourceLabel}"
        } else {
          "$directionCopy · ${freshness.label} · ${snapshot.sourceLabel}"
        },
      )
      views.setContentDescription(
        R.id.t1arc_widget_root,
        if (freshness == DisplayFreshness.STALE) {
          "Last known stale glucose, $value ${T1ArcGlucoseDisplayState.displayGlucoseSpokenUnit(context)}, shown struck through. ${ageCopy(snapshot.timestampMs, now, T1ArcGlucoseDisplayState.displayLocale(context)).lowercase(T1ArcGlucoseDisplayState.displayLocale(context))}."
        } else {
          "$value ${T1ArcGlucoseDisplayState.displayGlucoseSpokenUnit(context)}. $directionCopy. ${freshness.label}. ${ageCopy(snapshot.timestampMs, now, T1ArcGlucoseDisplayState.displayLocale(context)).lowercase(T1ArcGlucoseDisplayState.displayLocale(context))}."
        },
      )
    }
    views.setTextColor(R.id.t1arc_widget_value, color)
    views.setTextColor(R.id.t1arc_widget_trend, color)
    pendingIntent(context)?.let {
      views.setOnClickPendingIntent(R.id.t1arc_widget_root, it)
    }
    return views
  }

  fun update(context: Context, ids: IntArray) {
    val manager = AppWidgetManager.getInstance(context)
    ids.forEach { id -> manager.updateAppWidget(id, render(context)) }
  }

  fun updateAll(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    val ids =
      manager.getAppWidgetIds(
        ComponentName(context, T1ArcGlucoseWidgetProvider::class.java)
      )
    if (ids.isNotEmpty()) update(context, ids)
  }

  fun status(context: Context): Map<String, Any> {
    val manager = AppWidgetManager.getInstance(context)
    val ids =
      manager.getAppWidgetIds(
        ComponentName(context, T1ArcGlucoseWidgetProvider::class.java)
      )
    return mapOf(
      "supported" to true,
      "pinningSupported" to manager.isRequestPinAppWidgetSupported,
      "installedCount" to ids.size,
    )
  }

  fun requestPin(context: Context): Boolean {
    val manager = AppWidgetManager.getInstance(context)
    if (!manager.isRequestPinAppWidgetSupported) return false
    return manager.requestPinAppWidget(
      ComponentName(context, T1ArcGlucoseWidgetProvider::class.java),
      null,
      null,
    )
  }
}

class T1ArcGlucoseWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray,
  ) {
    T1ArcGlucosePhoneSurfaceGate.mutate {
      T1ArcGlucoseWidget.update(context, appWidgetIds)
    }
  }

  override fun onEnabled(context: Context) {
    T1ArcGlucosePhoneSurfaceGate.mutate {
      T1ArcGlucoseWidget.updateAll(context)
    }
  }
}

/**
 * Publishes only the normalised display snapshot to T1 Arc's Wear OS
 * companion. LibreLinkUp credentials and session material never leave the
 * phone. Google Play services accepts the payload only for a watch app with
 * the same package name and signing certificate.
 */
internal object T1ArcWearSync {
  @Volatile private var latestHistory: List<GlucoseHistoryPoint> = emptyList()

  fun history(): List<GlucoseHistoryPoint> = latestHistory

  fun clearHistory() {
    latestHistory = emptyList()
  }

  private fun snapshotData(
    context: Context,
    snapshot: GlucoseDisplaySnapshot,
    writeEpoch: Long,
    deliveryToken: Long? = null,
  ): DataMap {
    val appearance = T1ArcGlucoseDisplayState.appearance(context)
    val category = appearance.categoryFor(snapshot.mmolL)
    val colorToken = appearance.tokenFor(snapshot.mmolL, DisplayFreshness.CURRENT)
    return DataMap().apply {
      putInt("schemaVersion", 1)
      putBoolean("available", true)
      putDouble("mmolL", snapshot.mmolL)
      putString("trend", snapshot.trend)
      putString("trendOrigin", snapshot.trendOrigin)
      putLong("timestampMs", snapshot.timestampMs)
      putString("sourceLabel", snapshot.sourceLabel)
      putBoolean("sourceHasError", snapshot.sourceHasError)
      putString("category", category)
      putString("colorToken", colorToken)
      putString("staleColorToken", appearance.staleColor)
      putString("glucoseUnit", T1ArcGlucoseDisplayState.glucoseUnit(context))
      putString("localeTag", T1ArcGlucoseDisplayState.displayLocale(context).toLanguageTag())
      putString("timeZone", T1ArcGlucoseDisplayState.displayTimeZone(context).id)
      putLong(WEAR_WRITE_EPOCH_FIELD, writeEpoch)
      deliveryToken?.let { putLong("deliveryToken", it) }
    }
  }

  private fun missingData(sourceLabel: String, writeEpoch: Long) =
    DataMap().apply {
      putInt("schemaVersion", 1)
      putBoolean("available", false)
      putString("sourceLabel", sourceLabel.take(80))
      putLong(WEAR_WRITE_EPOCH_FIELD, writeEpoch)
    }

  private fun historyData(
    context: Context,
    readings: List<GlucoseHistoryPoint>,
    writeEpoch: Long,
    deliveryToken: Long? = null,
  ) =
    DataMap().apply {
      val appearance = T1ArcGlucoseDisplayState.appearance(context)
      putInt("schemaVersion", 1)
      putLongArray(
        "timestampMs",
        readings.map(GlucoseHistoryPoint::timestampMs).toLongArray(),
      )
      putFloatArray(
        "mmolL",
        readings.map { it.mmolL.toFloat() }.toFloatArray(),
      )
      putStringArray(
        "colorToken",
        readings.map { appearance.tokenFor(it.mmolL, DisplayFreshness.CURRENT) }.toTypedArray(),
      )
      putLong(WEAR_WRITE_EPOCH_FIELD, writeEpoch)
      deliveryToken?.let { putLong("deliveryToken", it) }
    }

  private fun sendImmediate(
    context: Context,
    data: DataMap,
    writeEpoch: Long,
    path: String = WEAR_GLUCOSE_PATH,
  ) {
    // MessageClient is the real-time path while the watch is reachable.
    // The retained Data Item below remains the disconnected/reinstall fallback.
    Wearable.getNodeClient(context).connectedNodes.addOnSuccessListener { nodes ->
      T1ArcGlucosePublicationGate.ifCurrent(context, writeEpoch) {
        nodes.forEach { node ->
          Wearable.getMessageClient(context)
            .sendMessage(node.id, path, data.toByteArray())
            .addOnSuccessListener {
              Log.i(WEAR_LOG_TAG, "Immediate glucose message sent")
            }
            .addOnFailureListener { error ->
              Log.w(WEAR_LOG_TAG, "Immediate glucose message failed", error)
            }
        }
      }
    }
  }

  fun publish(
    context: Context,
    snapshot: GlucoseDisplaySnapshot,
    writeEpoch: Long,
    deliveryToken: Long? = null,
  ): Task<DataItem> {
    val data = snapshotData(context, snapshot, writeEpoch, deliveryToken)
    sendImmediate(context, data, writeEpoch)
    val request =
      PutDataMapRequest.create(WEAR_GLUCOSE_PATH).apply {
        dataMap.putAll(data)
      }.asPutDataRequest().setUrgent()
    // Data items are retained for a temporarily disconnected watch. Routine
    // updates remain idempotent; an explicit connection check adds a delivery
    // token so a freshly sideloaded companion receives a new change event.
    return Wearable.getDataClient(context).putDataItem(request)
  }

  fun publishMissing(
    context: Context,
    sourceLabel: String,
    writeEpoch: Long,
  ): Task<DataItem> {
    val data = missingData(sourceLabel, writeEpoch)
    sendImmediate(context, data, writeEpoch)
    val request =
      PutDataMapRequest.create(WEAR_GLUCOSE_PATH).apply {
        dataMap.putAll(data)
      }.asPutDataRequest().setUrgent()
    return Wearable.getDataClient(context).putDataItem(request)
  }

  fun publishHistory(
    context: Context,
    readings: List<GlucoseHistoryPoint>,
    writeEpoch: Long,
    deliveryToken: Long? = null,
  ): Task<DataItem> {
    val normalised =
      readings
        .asSequence()
        .filter { it.mmolL.isFinite() && it.mmolL in 0.5..40.0 && it.timestampMs > 0L }
        .distinctBy(GlucoseHistoryPoint::timestampMs)
        .sortedBy(GlucoseHistoryPoint::timestampMs)
        .toList()
        .takeLast(MAX_WEAR_HISTORY_POINTS)
    latestHistory = normalised
    Log.i(WEAR_LOG_TAG, "Publishing ${normalised.size} glucose history points to Wear")
    val data = historyData(context, normalised, writeEpoch, deliveryToken)
    sendImmediate(context, data, writeEpoch, WEAR_GLUCOSE_HISTORY_PATH)
    val request =
      PutDataMapRequest.create(WEAR_GLUCOSE_HISTORY_PATH).apply {
        dataMap.putAll(data)
      }.asPutDataRequest().setUrgent()
    return Wearable.getDataClient(context).putDataItem(request)
  }
}

private fun applyPrivateGlucosePublication(
  context: Context,
  writeEpoch: Long,
  snapshot: GlucoseDisplaySnapshot?,
  history: List<GlucoseHistoryPoint>,
  missingSourceLabel: String,
): Boolean {
  T1ArcGlucosePhoneSurfaceGate.mutate {
    if (snapshot == null) {
      T1ArcGlucoseDisplayState.clearSnapshot(context)
    } else {
      T1ArcGlucoseDisplayState.setSnapshot(context, snapshot)
    }
    // The phone and Android Auto are authoritative even when Wearable Play
    // Services is slow or unavailable. Refresh them before any bounded await.
    T1ArcAndroidAuto.refresh(context)
    if (T1ArcGlucoseDisplayState.enabled(context)) {
      T1ArcGlucoseDisplayService.ensureRunning(context)
      T1ArcGlucoseNotification.notify(context)
    }
    T1ArcGlucoseWidget.updateAll(context)
    T1ArcAodAccessibilityService.snapshotChanged()
  }

  val currentTask = runCatching {
    if (snapshot == null) {
      T1ArcWearSync.publishMissing(context, missingSourceLabel, writeEpoch)
    } else {
      T1ArcWearSync.publish(context, snapshot, writeEpoch)
    }
  }.getOrNull()
  val historyTask = runCatching {
    T1ArcWearSync.publishHistory(context, history, writeEpoch)
  }.getOrNull()
  val currentPublished =
    currentTask != null && runCatching {
      Tasks.await(currentTask, 5, TimeUnit.SECONDS)
    }.isSuccess
  val historyPublished =
    historyTask != null && runCatching {
      Tasks.await(historyTask, 5, TimeUnit.SECONDS)
    }.isSuccess
  return currentPublished && historyPublished
}

private fun clearPrivateGlucosePublication(
  context: Context,
  writeEpoch: Long,
  missingSourceLabel: String,
) {
  T1ArcGlucosePhoneSurfaceGate.mutate {
    T1ArcGlucoseDisplayState.clearSnapshot(context)
    T1ArcWearSync.clearHistory()
    // Phone-local surfaces clear synchronously before either fallible Play
    // Services write. A Wear timeout must retain the erase intent for retry, but
    // must not leave an old Auto card, notification, widget or AOD value visible.
    T1ArcAndroidAuto.refresh(context)
    T1ArcGlucoseNotification.cancel(context)
    T1ArcGlucoseWidget.updateAll(context)
    T1ArcAodAccessibilityService.snapshotChanged()
  }
  // These retained, non-personal payloads clear a disconnected watch when it
  // next reconnects. Await both writes before allowing the DB erase to commit.
  val currentTask = runCatching {
    T1ArcWearSync.publishMissing(context, missingSourceLabel, writeEpoch)
  }
  val historyTask = runCatching {
    T1ArcWearSync.publishHistory(context, emptyList(), writeEpoch)
  }
  val currentClear = currentTask.mapCatching {
    Tasks.await(it, 5, TimeUnit.SECONDS)
  }
  val historyClear = historyTask.mapCatching {
    Tasks.await(it, 5, TimeUnit.SECONDS)
  }
  val currentFailure = currentClear.exceptionOrNull()
  val historyFailure = historyClear.exceptionOrNull()
  if (
    RetainedWearClearFailurePolicy.acceptsAggregate(
      currentFailure,
      historyFailure,
    )
  ) {
    return
  }
  // Prefer the actionable non-absence failure when only one retained write
  // proves the API is present or fails for another reason. Any mixed outcome
  // keeps the durable erase intent pending for an exact retry.
  throw listOfNotNull(currentFailure, historyFailure).firstOrNull {
    !RetainedWearClearFailurePolicy.isAbsentWearApi(it)
  } ?: requireNotNull(currentFailure ?: historyFailure)
}

class T1ArcWearRequestService : WearableListenerService() {
  override fun onMessageReceived(messageEvent: MessageEvent) {
    if (messageEvent.path != WEAR_GLUCOSE_REQUEST_PATH) return
    Log.i(WEAR_LOG_TAG, "Watch requested current glucose and history")
    T1ArcGlucosePublicationGate.observeCurrent(this) { writeEpoch ->
      val deliveryToken = System.currentTimeMillis()
      val snapshot = T1ArcGlucoseDisplayState.snapshot(this)
      if (snapshot != null) {
        runCatching {
          Tasks.await(
            T1ArcWearSync.publish(this, snapshot, writeEpoch, deliveryToken),
            5,
            TimeUnit.SECONDS,
          )
        }
      } else if (writeEpoch > 0L) {
        runCatching {
          Tasks.await(
            T1ArcWearSync.publishMissing(
              this,
              "No personal glucose reading",
              writeEpoch,
            ),
            5,
            TimeUnit.SECONDS,
          )
        }
      }
      val history = T1ArcWearSync.history()
      if (
        WearRequestHistoryPolicy.shouldPublish(
          hasSnapshot = snapshot != null,
          hasInMemoryHistory = history.isNotEmpty(),
          writeEpoch = writeEpoch,
        )
      ) {
        runCatching {
          Tasks.await(
            T1ArcWearSync.publishHistory(
              this,
              history,
              writeEpoch,
              deliveryToken,
            ),
            5,
            TimeUnit.SECONDS,
          )
        }
      } else {
        // An empty in-memory cache with a restored snapshot means Android
        // restarted after a valid publication. Preserve retained same-epoch
        // history until JS repopulates it; only a cleared/missing snapshot
        // emits an authoritative empty history payload.
        Log.i(WEAR_LOG_TAG, "No in-memory history; preserving retained Wear history")
      }
    }
  }
}

private object T1ArcAodDiagnostics {
  @Volatile var overlayVisible = false

  fun recordEvent(context: Context, value: String) {
    T1ArcGlucoseDisplayState.preferences(context)
      .edit()
      .putString(AOD_LAST_EVENT_KEY, value)
      .remove(AOD_LAST_ERROR_KEY)
      .apply()
  }

  fun recordError(context: Context, value: String) {
    T1ArcGlucoseDisplayState.preferences(context)
      .edit()
      .putString(AOD_LAST_ERROR_KEY, value.take(180))
      .apply()
  }

  fun lastEvent(context: Context) =
    T1ArcGlucoseDisplayState.preferences(context).getString(AOD_LAST_EVENT_KEY, null)

  fun lastError(context: Context) =
    T1ArcGlucoseDisplayState.preferences(context).getString(AOD_LAST_ERROR_KEY, null)
}

private object T1ArcGlucoseNotification {
  fun permissionGranted(context: Context): Boolean =
    !(
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
          PackageManager.PERMISSION_GRANTED
    )

  fun appNotificationsEnabled(context: Context): Boolean =
    NotificationManagerCompat.from(context).areNotificationsEnabled()

  fun notificationsAllowed(context: Context): Boolean =
    permissionGranted(context) && appNotificationsEnabled(context)

  fun currentGlucoseNotificationsAllowed(context: Context): Boolean {
    val appNotificationsAllowed = notificationsAllowed(context)
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return effectiveCurrentGlucoseNotificationsAllowed(
        appNotificationsAllowed = appNotificationsAllowed,
        channelSettingsSupported = false,
        currentChannelEnabled = true,
      )
    }
    ensureChannel(context)
    val manager = context.getSystemService(NotificationManager::class.java)
    val channel = manager.getNotificationChannel(CHANNEL_ID)
    return effectiveCurrentGlucoseNotificationsAllowed(
      appNotificationsAllowed = appNotificationsAllowed,
      channelSettingsSupported = true,
      currentChannelEnabled =
        channel != null && channel.importance != NotificationManager.IMPORTANCE_NONE,
    )
  }

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    val channel =
      NotificationChannel(
        CHANNEL_ID,
        context.getString(R.string.t1arc_glucose_channel_name),
        NotificationManager.IMPORTANCE_DEFAULT,
      ).apply {
        description = context.getString(R.string.t1arc_glucose_channel_description)
        setSound(null, null)
        enableLights(false)
        enableVibration(false)
        setShowBadge(false)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      }
    manager.createNotificationChannel(channel)
  }

  private fun formatTime(context: Context, timestampMs: Long): String =
    RegionalTimeFormatter.format(
      timestampMs,
      T1ArcGlucoseDisplayState.displayLocale(context),
      T1ArcGlucoseDisplayState.displayTimeZone(context),
    )

  private fun ageCopy(timestampMs: Long, now: Long, locale: Locale): String {
    val minutes = floor(max(0L, now - timestampMs) / 60_000.0).toInt()
    return when (minutes) {
      0 -> "just now"
      1 -> "${RegionalNumberFormatter.integer(1L, locale)} min ago"
      else -> "${RegionalNumberFormatter.integer(minutes.toLong(), locale)} min ago"
    }
  }

  private fun trendPresentation(trend: String): Pair<String, String> =
    when (trend) {
      "doubleDown" -> "⇊" to "Falling quickly"
      "down" -> "↓" to "Falling"
      "slightDown" -> "↘" to "Falling slowly"
      "flat" -> "→" to "Steady"
      "slightUp" -> "↗" to "Rising slowly"
      "up" -> "↑" to "Rising"
      "doubleUp" -> "⇈" to "Rising quickly"
      else -> "?" to "Direction unavailable"
    }

  private fun pendingIntent(context: Context): PendingIntent? {
    val launch =
      Intent(Intent.ACTION_VIEW, Uri.parse(T1ArcAppLinks.TODAY)).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      }
    return PendingIntent.getActivity(
      context,
      0,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun foodLogPendingIntent(context: Context): PendingIntent =
    PendingIntent.getActivity(
      context,
      10,
      Intent(Intent.ACTION_VIEW, Uri.parse(T1ArcAppLinks.LOG_FOOD)).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      },
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  private fun contextLogPendingIntent(context: Context): PendingIntent =
    PendingIntent.getActivity(
      context,
      11,
      Intent(Intent.ACTION_VIEW, Uri.parse(T1ArcAppLinks.LOG_CONTEXT)).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      },
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  private fun valueIcon(
    context: Context,
    snapshot: GlucoseDisplaySnapshot?,
    freshness: DisplayFreshness,
  ): Icon {
    if (snapshot == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
      return Icon.createWithResource(context, R.drawable.t1arc_notification_pulse)
    }
    return try {
      val text = T1ArcGlucoseDisplayState.displayGlucoseValue(context, snapshot.mmolL)
      val bitmap = Bitmap.createBitmap(96, 64, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(bitmap)
      val paint =
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
          color = Color.WHITE
          typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
          textAlign = Paint.Align.CENTER
          textSize = if (text.length <= 3) 48f else 41f
        }
      val bounds = Rect()
      paint.getTextBounds(text, 0, text.length, bounds)
      val baseline = bitmap.height / 2f - bounds.exactCenterY()
      canvas.drawText(text, bitmap.width / 2f, baseline, paint)
      if (freshness == DisplayFreshness.STALE) {
        val halfWidth = paint.measureText(text) / 2f
        canvas.drawLine(
          bitmap.width / 2f - halfWidth,
          baseline - paint.textSize * 0.31f,
          bitmap.width / 2f + halfWidth,
          baseline - paint.textSize * 0.31f,
          Paint(paint).apply {
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
            strokeWidth = 4f
          },
        )
      }
      Icon.createWithBitmap(bitmap)
    } catch (_: Exception) {
      Icon.createWithResource(context, R.drawable.t1arc_notification_pulse)
    }
  }

  private fun historyBitmap(
    context: Context,
    snapshot: GlucoseDisplaySnapshot,
  ): Bitmap? {
    val allPoints = T1ArcWearSync.history()
    val latestTimestamp = allPoints.maxOfOrNull(GlucoseHistoryPoint::timestampMs) ?: return null
    val points =
      allPoints.filter { it.timestampMs >= latestTimestamp - 3 * 60 * 60_000L }
    if (points.size < 2) return null

    return try {
      val width = 720
      val height = 280
      val left = 42f
      val top = 34f
      val right = width - 28f
      val bottom = height - 48f
      val appearance = T1ArcGlucoseDisplayState.appearance(context)
      val measuredMin = points.minOf(GlucoseHistoryPoint::mmolL)
      val measuredMax = points.maxOf(GlucoseHistoryPoint::mmolL)
      val chartMin = max(2.0, min(measuredMin - 1.0, appearance.targetMin - 0.5))
      val chartMax = min(22.0, max(measuredMax + 1.0, appearance.targetMax + 0.5))
      val range = max(1.0, chartMax - chartMin)
      val startTimestamp = points.first().timestampMs
      val duration = max(1L, latestTimestamp - startTimestamp)
      fun x(point: GlucoseHistoryPoint) =
        left + (point.timestampMs - startTimestamp).toFloat() / duration * (right - left)
      fun y(value: Double) =
        bottom - ((value - chartMin) / range).toFloat() * (bottom - top)

      Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also { bitmap ->
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.rgb(8, 22, 26))
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.style = Paint.Style.FILL
        paint.color = Color.argb(42, 101, 210, 231)
        val targetTop = y(appearance.targetMax).coerceIn(top, bottom)
        val targetBottom = y(appearance.targetMin).coerceIn(top, bottom)
        canvas.drawRoundRect(
          RectF(left, targetTop, right, targetBottom),
          12f,
          12f,
          paint,
        )
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 2f
        paint.color = Color.rgb(39, 69, 75)
        canvas.drawLine(left, targetTop, right, targetTop, paint)
        canvas.drawLine(left, targetBottom, right, targetBottom, paint)

        paint.strokeWidth = 6f
        paint.strokeCap = Paint.Cap.ROUND
        paint.strokeJoin = Paint.Join.ROUND
        for (index in 1 until points.size) {
          paint.color =
            AOD_COLORS[
              appearance.tokenFor(
                (points[index - 1].mmolL + points[index].mmolL) / 2.0,
                DisplayFreshness.CURRENT,
              ),
            ] ?: AOD_COLORS.getValue("slate")
          canvas.drawLine(
            x(points[index - 1]),
            y(points[index - 1].mmolL),
            x(points[index]),
            y(points[index].mmolL),
            paint,
          )
        }
        val last = points.last()
        paint.color =
          AOD_COLORS[
            appearance.tokenFor(last.mmolL, DisplayFreshness.CURRENT),
          ] ?: AOD_COLORS.getValue("slate")
        paint.style = Paint.Style.FILL
        canvas.drawCircle(x(last), y(last.mmolL), 10f, paint)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 4f
        paint.color = Color.WHITE
        canvas.drawCircle(x(last), y(last.mmolL), 10f, paint)

        paint.style = Paint.Style.FILL
        paint.textSize = 25f
        paint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        paint.color = Color.rgb(169, 189, 194)
        paint.textAlign = Paint.Align.LEFT
        canvas.drawText(
          "LAST ${RegionalNumberFormatter.integer(3L, T1ArcGlucoseDisplayState.displayLocale(context))} HOURS",
          left,
          26f,
          paint,
        )
        paint.textAlign = Paint.Align.RIGHT
        canvas.drawText(formatTime(context, latestTimestamp), right, height - 15f, paint)
      }
    } catch (_: Exception) {
      null
    }
  }

  private fun builder(context: Context): Notification.Builder =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context).setPriority(Notification.PRIORITY_DEFAULT)
    }

  private fun redactedNotification(
    context: Context,
    freshness: DisplayFreshness,
    timestampMs: Long?,
  ): Notification =
    builder(context)
      .setSmallIcon(R.drawable.t1arc_notification_pulse)
      .setContentTitle("T1 Arc glucose")
      .setContentText(
        if (freshness == DisplayFreshness.STALE) {
          "Last known glucose is stale"
        } else {
          "${freshness.label} reading available"
        }
      )
      .setCategory(Notification.CATEGORY_STATUS)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setOnlyAlertOnce(true)
      .setOngoing(true)
      .setShowWhen(timestampMs != null)
      .setWhen(timestampMs ?: System.currentTimeMillis())
      .build()

  fun buildPrivateMonitoring(context: Context): Notification {
    ensureChannel(context)
    val publicVersion =
      builder(context)
        .setSmallIcon(R.drawable.t1arc_notification_pulse)
        .setContentTitle("T1 Arc monitoring active")
        .setContentText("Open T1 Arc to review monitoring settings.")
        .setCategory(Notification.CATEGORY_SERVICE)
        .setVisibility(Notification.VISIBILITY_PUBLIC)
        .setOnlyAlertOnce(true)
        .setOngoing(true)
        .setShowWhen(false)
        .build()
    val notification =
      builder(context)
        .setSmallIcon(R.drawable.t1arc_notification_pulse)
        .setContentTitle("T1 Arc private monitoring")
        .setContentText("Your chosen alerts are being checked on this phone.")
        .setContentIntent(pendingIntent(context))
        .setCategory(Notification.CATEGORY_SERVICE)
        .setVisibility(Notification.VISIBILITY_PRIVATE)
        .setPublicVersion(publicVersion)
        .setOngoing(true)
        .setAutoCancel(false)
        .setOnlyAlertOnce(true)
        .setShowWhen(false)
        .setColor(Color.rgb(8, 127, 153))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      notification.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    }
    return notification.build()
  }

  fun build(context: Context): Notification {
    ensureChannel(context)
    val snapshot = T1ArcGlucoseDisplayState.snapshot(context)
    val now = System.currentTimeMillis()
    val freshness = T1ArcGlucoseDisplayState.freshness(context, now)
    val notification =
      if (snapshot == null) {
        builder(context)
          .setSmallIcon(R.drawable.t1arc_notification_pulse)
          .setContentTitle("Waiting for personal glucose")
          .setContentText("T1 Arc is checking your saved LibreLinkUp connection.")
          .setStyle(
            Notification.BigTextStyle().bigText(
              "T1 Arc is checking your saved LibreLinkUp connection. The notification will update when a reading is available."
            )
          )
          .setShowWhen(false)
      } else {
        val (arrow, direction) = trendPresentation(snapshot.trend)
        val directionCopy =
          if (snapshot.trendOrigin == "calculated") "$direction (calculated)" else direction
        val value = T1ArcGlucoseDisplayState.displayGlucoseValue(context, snapshot.mmolL)
        val unit = T1ArcGlucoseDisplayState.displayGlucoseUnit(context)
        val age =
          ageCopy(
            snapshot.timestampMs,
            now,
            T1ArcGlucoseDisplayState.displayLocale(context),
          )
        val status =
          if (freshness == DisplayFreshness.STALE) {
            "Stale · Last known · $age · ${formatTime(context, snapshot.timestampMs)}"
          } else {
            "${freshness.label} · $age · ${formatTime(context, snapshot.timestampMs)}"
          }
        val readingBuilder =
          builder(context)
          .setSmallIcon(valueIcon(context, snapshot, freshness))
          .setContentTitle(
            glucoseDisplayTitle(value, " $arrow  $directionCopy", freshness)
          )
          .setContentText("$unit · $status")
          .setShowWhen(true)
          .setWhen(snapshot.timestampMs)
        val chart = historyBitmap(context, snapshot)
        if (chart != null) {
          readingBuilder.setStyle(
            Notification.BigPictureStyle()
              .bigPicture(chart)
              .setBigContentTitle(
                glucoseDisplayTitle(
                  value,
                  " $unit $arrow · $directionCopy",
                  freshness,
                )
              )
              .setSummaryText("$status · ${snapshot.sourceLabel}")
          )
        } else {
          readingBuilder.setStyle(
            Notification.BigTextStyle().bigText(
              SpannableStringBuilder()
                .append(
                  glucoseDisplayTitle(
                    value,
                    " $unit $arrow · $directionCopy",
                    freshness,
                  )
                )
                .append("\n$status\n${snapshot.sourceLabel} · Tap to inspect the timeline.")
            )
          )
        }
        readingBuilder
      }

    notification
      .setContentIntent(pendingIntent(context))
      .setCategory(Notification.CATEGORY_STATUS)
      .setOngoing(true)
      .setAutoCancel(false)
      .setOnlyAlertOnce(true)
      .setColor(
        T1ArcGlucoseDisplayState.displayColor(context, snapshot, freshness)
      )
      .setSortKey("00-current-glucose")
      .addAction(
        Notification.Action.Builder(
          null,
          "Log food",
          foodLogPendingIntent(context),
        ).build()
      )
      .addAction(
        Notification.Action.Builder(
          null,
          "Log context",
          contextLogPendingIntent(context),
        ).build()
      )

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      notification.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    }

    if (T1ArcGlucoseDisplayState.lockScreenVisible(context)) {
      notification.setVisibility(Notification.VISIBILITY_PUBLIC)
    } else {
      notification
        .setVisibility(Notification.VISIBILITY_PRIVATE)
        .setPublicVersion(
          redactedNotification(context, freshness, snapshot?.timestampMs)
        )
    }
    return notification.build()
  }

  fun notify(context: Context) {
    T1ArcGlucosePhoneSurfaceGate.publishIfEnabled(context) {
      val manager = context.getSystemService(NotificationManager::class.java)
      manager.notify(NOTIFICATION_ID, build(context))
      T1ArcGlucoseWidget.updateAll(context)
      T1ArcAodAccessibilityService.snapshotChanged()
    }
  }

  fun cancel(context: Context) {
    T1ArcGlucosePhoneSurfaceGate.mutate {
      context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
      T1ArcAodAccessibilityService.snapshotChanged()
    }
  }
}

private object T1ArcReviewNotification {
  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    context.getSystemService(NotificationManager::class.java)
      .createNotificationChannel(
        NotificationChannel(
          REVIEW_CHANNEL_ID,
          context.getString(R.string.t1arc_review_channel_name),
          NotificationManager.IMPORTANCE_LOW,
        ).apply {
          description = context.getString(R.string.t1arc_review_channel_description)
          setSound(null, null)
          enableLights(false)
          enableVibration(false)
          setShowBadge(true)
          lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        }
      )
  }

  fun allowed(context: Context): Boolean {
    if (!T1ArcGlucoseNotification.notificationsAllowed(context)) return false
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
    ensureChannel(context)
    val channel =
      context.getSystemService(NotificationManager::class.java)
        .getNotificationChannel(REVIEW_CHANNEL_ID)
    return channel != null && channel.importance != NotificationManager.IMPORTANCE_NONE
  }

  private fun pendingIntent(context: Context): PendingIntent {
    val launch =
      Intent(Intent.ACTION_VIEW, Uri.parse(T1ArcAppLinks.INSIGHTS)).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      }
    return PendingIntent.getActivity(
      context,
      REVIEW_NOTIFICATION_ID,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  fun show(context: Context): Boolean {
    ensureChannel(context)
    if (!allowed(context)) return false
    val builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(context, REVIEW_CHANNEL_ID)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(context).setPriority(Notification.PRIORITY_LOW)
      }
    val notification =
      builder
        .setSmallIcon(R.drawable.t1arc_notification_pulse)
        .setContentTitle("Your weekly T1 Arc review is ready")
        .setContentText("Open the evidence linked to your on-device history.")
        .setContentIntent(pendingIntent(context))
        .setCategory(Notification.CATEGORY_REMINDER)
        .setVisibility(Notification.VISIBILITY_PRIVATE)
        .setAutoCancel(true)
        .setOnlyAlertOnce(true)
        .setColor(Color.rgb(8, 127, 153))
        .setShowWhen(true)
        .setWhen(System.currentTimeMillis())
        .build()
    context.getSystemService(NotificationManager::class.java)
      .notify(REVIEW_NOTIFICATION_ID, notification)
    return true
  }

  fun cancel(context: Context) {
    context.getSystemService(NotificationManager::class.java)
      .cancel(REVIEW_NOTIFICATION_ID)
  }
}

private object T1ArcConnectorNotification {
  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    context.getSystemService(NotificationManager::class.java)
      .createNotificationChannel(
        NotificationChannel(
          CONNECTOR_CHANNEL_ID,
          context.getString(R.string.t1arc_connector_channel_name),
          NotificationManager.IMPORTANCE_LOW,
        ).apply {
          description = context.getString(R.string.t1arc_connector_channel_description)
          setSound(null, null)
          enableLights(false)
          enableVibration(false)
          setShowBadge(true)
          lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        }
      )
  }

  private fun allowed(context: Context): Boolean {
    if (!T1ArcGlucoseNotification.notificationsAllowed(context)) return false
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
    ensureChannel(context)
    val channel =
      context.getSystemService(NotificationManager::class.java)
        .getNotificationChannel(CONNECTOR_CHANNEL_ID)
    return channel != null && channel.importance != NotificationManager.IMPORTANCE_NONE
  }

  private fun pendingIntent(context: Context): PendingIntent {
    val launch =
      Intent(Intent.ACTION_VIEW, Uri.parse(T1ArcAppLinks.SOURCES)).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      }
    return PendingIntent.getActivity(
      context,
      GLOOKO_SIGN_IN_NOTIFICATION_ID,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  fun showGlookoSignInRequired(context: Context): Boolean {
    ensureChannel(context)
    if (!allowed(context)) return false
    val builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(context, CONNECTOR_CHANNEL_ID)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(context).setPriority(Notification.PRIORITY_LOW)
      }
    val notification =
      builder
        .setSmallIcon(R.drawable.t1arc_notification_pulse)
        .setContentTitle("Sign into Glooko again")
        .setContentText("T1 Arc paused automatic Glooko refresh until you reconnect.")
        .setContentIntent(pendingIntent(context))
        .setCategory(Notification.CATEGORY_STATUS)
        .setVisibility(Notification.VISIBILITY_PRIVATE)
        .setAutoCancel(true)
        .setOnlyAlertOnce(true)
        .setColor(Color.rgb(8, 127, 153))
        .setShowWhen(true)
        .setWhen(System.currentTimeMillis())
        .build()
    context.getSystemService(NotificationManager::class.java)
      .notify(GLOOKO_SIGN_IN_NOTIFICATION_ID, notification)
    return true
  }

  fun cancelGlookoSignInRequired(context: Context) {
    context.getSystemService(NotificationManager::class.java)
      .cancel(GLOOKO_SIGN_IN_NOTIFICATION_ID)
  }
}

private object T1ArcGlucoseAlertNotification {
  fun ensureChannel(context: Context) = ensureChannels(context)

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannelGroup(
      NotificationChannelGroup(
        ALERT_CHANNEL_GROUP_ID,
        context.getString(R.string.t1arc_alert_channel_group_name),
      )
    )
    manager.createNotificationChannels(
      GlucoseAlertChannelKind.entries.map { kind ->
        NotificationChannel(
          kind.channelId,
          channelName(context, kind),
          NotificationManager.IMPORTANCE_HIGH,
        ).apply {
          group = ALERT_CHANNEL_GROUP_ID
          description = channelDescription(context, kind)
          enableLights(true)
          setShowBadge(true)
          lockscreenVisibility = Notification.VISIBILITY_PRIVATE
          enableVibration(true)
        }
      }
    )
  }

  private fun channelName(context: Context, kind: GlucoseAlertChannelKind): String =
    context.getString(
      when (kind) {
        GlucoseAlertChannelKind.LOW -> R.string.t1arc_low_alert_channel_name
        GlucoseAlertChannelKind.HIGH -> R.string.t1arc_high_alert_channel_name
        GlucoseAlertChannelKind.STALE -> R.string.t1arc_freshness_alert_channel_name
      }
    )

  private fun channelDescription(context: Context, kind: GlucoseAlertChannelKind): String =
    context.getString(
      when (kind) {
        GlucoseAlertChannelKind.LOW -> R.string.t1arc_low_alert_channel_description
        GlucoseAlertChannelKind.HIGH -> R.string.t1arc_high_alert_channel_description
        GlucoseAlertChannelKind.STALE -> R.string.t1arc_freshness_alert_channel_description
      }
    )

  private fun lockScreenVisibility(value: Int): String =
    when (value) {
      Notification.VISIBILITY_PUBLIC -> "public"
      Notification.VISIBILITY_PRIVATE -> "private"
      Notification.VISIBILITY_SECRET -> "secret"
      else -> "default"
    }

  fun channelIdForSettings(kind: GlucoseAlertChannelKind): String = kind.channelId

  private fun independentGroupBlocked(manager: NotificationManager): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
      manager.getNotificationChannelGroup(ALERT_CHANNEL_GROUP_ID)?.isBlocked == true

  fun statuses(context: Context): List<Map<String, Any?>> {
    ensureChannels(context)
    val permissionGranted = T1ArcGlucoseNotification.permissionGranted(context)
    val appNotificationsEnabled = T1ArcGlucoseNotification.appNotificationsEnabled(context)
    val appNotificationsAllowed = permissionGranted && appNotificationsEnabled
    val manager = context.getSystemService(NotificationManager::class.java)
    val groupBlocked = independentGroupBlocked(manager)
    val payloadGlucoseVisibleOnLockScreen =
      T1ArcGlucoseDisplayState.lockScreenVisible(context)
    return GlucoseAlertChannelKind.entries.map { kind ->
      val channelId = kind.channelId
      val channel =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          manager.getNotificationChannel(channelId)
        } else {
          null
        }
      val availability =
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
          if (appNotificationsAllowed) {
            GlucoseAlertChannelAvailability.ALLOWED
          } else {
            GlucoseAlertChannelAvailability.BLOCKED
          }
        } else {
          GlucoseAlertChannelPolicy.availability(
            appNotificationsAllowed = appNotificationsAllowed,
            groupBlocked = groupBlocked,
            channelExists = channel != null,
            channelImportance = channel?.importance,
          )
        }
      mapOf(
        "kind" to kind.wireValue,
        "channelId" to channelId,
        "state" to availability.wireValue,
        "permissionGranted" to permissionGranted,
        "appNotificationsEnabled" to appNotificationsEnabled,
        "appNotificationsAllowed" to appNotificationsAllowed,
        "channelExists" to (channel != null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O),
        "groupBlocked" to groupBlocked,
        "importance" to (channel?.importance ?: NotificationManager.IMPORTANCE_HIGH),
        "soundConfigured" to (channel?.sound != null),
        "vibrationConfigured" to (channel?.shouldVibrate() ?: true),
        "lockScreenVisibility" to
          lockScreenVisibility(channel?.lockscreenVisibility ?: Notification.VISIBILITY_PRIVATE),
        "payloadGlucoseVisibleOnLockScreen" to payloadGlucoseVisibleOnLockScreen,
        "bypassesDoNotDisturb" to (channel?.canBypassDnd() ?: false),
      )
    }
  }

  fun allowed(context: Context): Boolean {
    return statuses(context).any { it["state"] == GlucoseAlertChannelAvailability.ALLOWED.wireValue }
  }

  private fun allowed(context: Context, kind: GlucoseAlertChannelKind): Boolean {
    if (!T1ArcGlucoseNotification.notificationsAllowed(context)) return false
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
    ensureChannels(context)
    val manager = context.getSystemService(NotificationManager::class.java)
    if (independentGroupBlocked(manager)) return false
    val channel = manager.getNotificationChannel(kind.channelId)
    return channel != null && channel.importance > NotificationManager.IMPORTANCE_NONE
  }

  private fun pendingIntent(context: Context, requestCode: Int): PendingIntent {
    val launch =
      Intent(Intent.ACTION_VIEW, Uri.parse(T1ArcAppLinks.TODAY)).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      }
    return PendingIntent.getActivity(
      context,
      requestCode,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun builder(
    context: Context,
    kind: GlucoseAlertChannelKind,
  ): Notification.Builder =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(
        context,
        kind.channelId,
      )
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context)
        .setPriority(Notification.PRIORITY_HIGH)
        .setDefaults(Notification.DEFAULT_ALL)
    }

  private fun arrow(trend: String): String =
    when (trend) {
      "doubleDown" -> "⇊"
      "down" -> "↓"
      "slightDown" -> "↘"
      "flat" -> "→"
      "slightUp" -> "↗"
      "up" -> "↑"
      "doubleUp" -> "⇈"
      else -> ""
    }

  fun show(
    context: Context,
    kind: String,
    mmolL: Double,
    trend: String,
    timestampMs: Long,
  ): Boolean {
    val alertKind = GlucoseAlertChannelPolicy.kindFor(kind) ?: return false
    if (!mmolL.isFinite() || mmolL !in 0.5..40.0 || timestampMs <= 0L) return false
    if (!T1ArcGlucoseDisplayState.alertMonitoringEnabled(context)) return false
    ensureChannels(context)
    if (!allowed(context, alertKind)) return false

    val title =
      when (alertKind) {
        GlucoseAlertChannelKind.LOW -> "Low glucose reading"
        GlucoseAlertChannelKind.HIGH -> "High glucose reading"
        GlucoseAlertChannelKind.STALE -> "Glucose updates are stale"
      }
    val value = T1ArcGlucoseDisplayState.displayGlucoseValue(context, mmolL)
    val unit = T1ArcGlucoseDisplayState.displayGlucoseUnit(context)
    val direction = arrow(trend)
    val ageMinutes =
      floor(max(0L, System.currentTimeMillis() - timestampMs) / 60_000.0).toInt()
    val age =
      if (ageMinutes == 0) {
        "just now"
      } else {
        "${RegionalNumberFormatter.integer(ageMinutes.toLong(), T1ArcGlucoseDisplayState.displayLocale(context))} min ago"
      }
    val detail =
      if (alertKind == GlucoseAlertChannelKind.STALE) {
        "Last reading $value $unit was $age. Open T1 Arc to inspect freshness."
      } else {
        "$value $unit $direction · $age. Open T1 Arc to inspect the reading."
      }
    val notification =
      builder(context, alertKind)
        .setSmallIcon(R.drawable.t1arc_notification_pulse)
        .setContentTitle(title)
        .setContentText(detail)
        .setStyle(
          Notification.BigTextStyle().bigText(
            "$detail No dose or treatment calculation is included."
          )
        )
        .setContentIntent(pendingIntent(context, alertKind.notificationId))
        .setCategory(Notification.CATEGORY_ALARM)
        .setAutoCancel(true)
        .setOnlyAlertOnce(false)
        .setColor(
          if (alertKind == GlucoseAlertChannelKind.HIGH) {
            Color.rgb(152, 82, 10)
          } else {
            Color.rgb(180, 35, 58)
          }
        )
        .setShowWhen(true)
        .setWhen(System.currentTimeMillis())
        .setTimeoutAfter(if (kind == "stale") 4 * 60 * 60_000L else 2 * 60 * 60_000L)

    // Both owner and lock-screen visibility remain stable until notify returns.
    // A private transition waits, commits, and cancels this post before it can
    // return; a delivery deferred outside the fence builds the private form.
    return T1ArcGlucoseAlertOwnershipGate.notifyIfOwned(context) {
      if (T1ArcGlucoseDisplayState.lockScreenVisible(context)) {
        notification.setVisibility(Notification.VISIBILITY_PUBLIC)
      } else {
        val redacted =
          builder(context, alertKind)
            .setSmallIcon(R.drawable.t1arc_notification_pulse)
            .setContentTitle("T1 Arc glucose alert")
            .setContentText("Open T1 Arc to review a private glucose alert.")
            .setCategory(Notification.CATEGORY_ALARM)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .build()
        notification
          .setVisibility(Notification.VISIBILITY_PRIVATE)
          .setPublicVersion(redacted)
      }
      context.getSystemService(NotificationManager::class.java)
        .notify(alertKind.notificationId, notification.build())
    }
  }

  fun showTest(context: Context, kind: String): Boolean {
    val alertKind = GlucoseAlertChannelPolicy.kindFor(kind) ?: return false
    ensureChannels(context)
    if (!allowed(context, alertKind)) return false

    val title =
      when (alertKind) {
        GlucoseAlertChannelKind.LOW -> "Test low glucose alert"
        GlucoseAlertChannelKind.HIGH -> "Test high glucose alert"
        GlucoseAlertChannelKind.STALE -> "Test data freshness alert"
      }
    val unit = T1ArcGlucoseDisplayState.displayGlucoseUnit(context)
    val lowExample = T1ArcGlucoseDisplayState.displayGlucoseValue(context, 3.4)
    val highExample = T1ArcGlucoseDisplayState.displayGlucoseValue(context, 15.0)
    val detail =
      when (alertKind) {
        GlucoseAlertChannelKind.LOW ->
          "Example: $lowExample $unit. This is a sound, vibration and privacy test only."
        GlucoseAlertChannelKind.HIGH ->
          "Example: $highExample $unit. This is a sound, vibration and privacy test only."
        GlucoseAlertChannelKind.STALE ->
          "Example: the last reading was ${RegionalNumberFormatter.integer(18L, T1ArcGlucoseDisplayState.displayLocale(context))} minutes ago. This is a test only."
      }
    val notification =
      builder(context, alertKind)
        .setSmallIcon(R.drawable.t1arc_notification_pulse)
        .setContentTitle(title)
        .setContentText(detail)
        .setStyle(Notification.BigTextStyle().bigText(detail))
        .setContentIntent(pendingIntent(context, alertKind.testNotificationId))
        .setCategory(Notification.CATEGORY_ALARM)
        .setAutoCancel(true)
        .setOnlyAlertOnce(false)
        .setColor(
          if (alertKind == GlucoseAlertChannelKind.HIGH) {
            Color.rgb(152, 82, 10)
          } else {
            Color.rgb(180, 35, 58)
          }
        )
        .setShowWhen(true)
        .setWhen(System.currentTimeMillis())
        .setTimeoutAfter(10 * 60_000L)

    return T1ArcGlucoseAlertOwnershipGate.notifyIfOwned(context) {
      if (T1ArcGlucoseDisplayState.lockScreenVisible(context)) {
        notification.setVisibility(Notification.VISIBILITY_PUBLIC)
      } else {
        val redacted =
          builder(context, alertKind)
            .setSmallIcon(R.drawable.t1arc_notification_pulse)
            .setContentTitle("T1 Arc glucose alert test")
            .setContentText("Unlock to review the private example alert.")
            .setCategory(Notification.CATEGORY_ALARM)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .build()
        notification
          .setVisibility(Notification.VISIBILITY_PRIVATE)
          .setPublicVersion(redacted)
      }
      context.getSystemService(NotificationManager::class.java)
        .notify(alertKind.testNotificationId, notification.build())
    }
  }

  fun cancelAll(context: Context) {
    context.getSystemService(NotificationManager::class.java).apply {
      GlucoseAlertChannelKind.entries.forEach { kind ->
        cancel(kind.notificationId)
        cancel(kind.testNotificationId)
      }
    }
  }
}

class T1ArcGlucoseDisplayService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private val networkSyncPolicy = ValidatedNetworkSyncPolicy()
  private lateinit var connectivityManager: ConnectivityManager
  private var networkCallbackRegistered = false
  private var serviceAlive = false
  private var validatedNetworkSyncPending = false
  private val networkCallback =
    object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) {
        networkSyncPolicy.onAvailable(network.networkHandle)
      }

      override fun onCapabilitiesChanged(
        network: Network,
        networkCapabilities: NetworkCapabilities,
      ) {
        if (
          networkSyncPolicy.onCapabilitiesChanged(
            networkHandle = network.networkHandle,
            hasInternet =
              networkCapabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET),
            isValidated =
              networkCapabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED),
          )
        ) {
          handler.post {
            if (serviceAlive) enqueueValidatedNetworkSync()
          }
        }
      }

      override fun onLost(network: Network) {
        networkSyncPolicy.onLost(network.networkHandle)
      }
    }
  private val renderRunnable =
    object : Runnable {
      override fun run() {
        if (
          T1ArcGlucoseDisplayState.collectorMode(this@T1ArcGlucoseDisplayService) !=
            GlucoseCollectorForegroundMode.GLUCOSE_DISPLAY
        ) {
          return
        }
        T1ArcGlucoseNotification.notify(this@T1ArcGlucoseDisplayService)
        handler.postDelayed(this, DISPLAY_REFRESH_INTERVAL_MS)
      }
    }
  private val syncRunnable =
    object : Runnable {
      override fun run() {
        if (!T1ArcGlucoseDisplayState.collectorEnabled(this@T1ArcGlucoseDisplayService)) {
          return
        }
        requestHeadlessSync(DISPLAY_SYNC_REASON)
        val nextDelay =
          GlucoseSyncCadencePolicy.nextDelayMs(
            T1ArcGlucoseDisplayState.snapshot(this@T1ArcGlucoseDisplayService)?.timestampMs,
            System.currentTimeMillis(),
          )
        handler.postDelayed(this, nextDelay)
      }
    }

  override fun onCreate() {
    super.onCreate()
    serviceAlive = true
    running = true
    instance = this
    T1ArcAndroidAuto.initialize(this)
    connectivityManager = getSystemService(ConnectivityManager::class.java)
    try {
      connectivityManager.registerDefaultNetworkCallback(networkCallback)
      networkCallbackRegistered = true
    } catch (_: Exception) {
      // The 15-second refresh tick remains available if Android cannot expose
      // default-network transitions on this device.
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Resolve ownership inside the publication fence. A service start that was
    // queued while display was on must not publish the old glucose foreground
    // notification after disable has committed and cancelled it.
    val foregroundMode =
      T1ArcGlucosePhoneSurfaceGate.mutate {
        val resolvedMode = T1ArcGlucoseDisplayState.collectorMode(this)
        if (resolvedMode == GlucoseCollectorForegroundMode.STOPPED) {
          return@mutate null
        }
        val notification =
          when (resolvedMode) {
            GlucoseCollectorForegroundMode.GLUCOSE_DISPLAY ->
              T1ArcGlucoseNotification.build(this)
            GlucoseCollectorForegroundMode.PRIVATE_MONITORING ->
              T1ArcGlucoseNotification.buildPrivateMonitoring(this)
            GlucoseCollectorForegroundMode.STOPPED -> error("Stopped collector has no notification")
          }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
          startForeground(
            NOTIFICATION_ID,
            notification,
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
          )
        } else {
          startForeground(NOTIFICATION_ID, notification)
        }
        resolvedMode
      }
    if (foregroundMode == null) {
      stopSelf()
      return START_NOT_STICKY
    }

    handler.removeCallbacks(renderRunnable)
    handler.removeCallbacks(syncRunnable)
    if (foregroundMode == GlucoseCollectorForegroundMode.GLUCOSE_DISPLAY) {
      handler.post(renderRunnable)
    }
    if (T1ArcGlucoseNotification.notificationsAllowed(this)) {
      // Avoid racing a React context that exists but is not fully active while
      // the app UI is starting. Cold boot still initializes Headless JS itself.
      handler.postDelayed(syncRunnable, 10_000L)
    }
    return START_STICKY
  }

  private fun requestHeadlessSync(reason: String): Boolean {
    if (!T1ArcGlucoseDisplayState.headlessTaskActive.compareAndSet(false, true)) {
      return false
    }
    try {
      startService(
        Intent(this, T1ArcLibreHeadlessService::class.java)
          .putExtra(HEADLESS_REASON_EXTRA, reason)
      )
      return true
    } catch (_: Exception) {
      T1ArcGlucoseDisplayState.headlessTaskActive.set(false)
      return false
    }
  }

  private fun enqueueValidatedNetworkSync() {
    if (!serviceAlive || validatedNetworkSyncPending) return
    validatedNetworkSyncPending = true
    drainValidatedNetworkSync()
  }

  private fun drainValidatedNetworkSync() {
    if (!serviceAlive || !validatedNetworkSyncPending) return
    if (requestHeadlessSync(VALIDATED_NETWORK_SYNC_REASON)) {
      validatedNetworkSyncPending = false
    }
  }

  override fun onDestroy() {
    serviceAlive = false
    validatedNetworkSyncPending = false
    networkSyncPolicy.stop()
    if (networkCallbackRegistered && this::connectivityManager.isInitialized) {
      try {
        connectivityManager.unregisterNetworkCallback(networkCallback)
      } catch (_: Exception) {
        // Android may already have released the callback with the process.
      }
    }
    networkCallbackRegistered = false
    handler.removeCallbacksAndMessages(null)
    running = false
    if (instance === this) instance = null
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  companion object {
    @Volatile var running = false
    @Volatile private var instance: T1ArcGlucoseDisplayService? = null

    fun headlessTaskFinished() {
      instance?.let { service ->
        service.handler.post {
          if (service.serviceAlive) service.drainValidatedNetworkSync()
        }
      }
    }

    fun ensureRunning(context: Context) {
      if (!T1ArcGlucoseDisplayState.collectorEnabled(context) || running) return
      ContextCompat.startForegroundService(
        context,
        Intent(context, T1ArcGlucoseDisplayService::class.java),
      )
    }

    fun reconcile(context: Context) {
      if (!T1ArcGlucoseDisplayState.collectorEnabled(context)) {
        stop(context)
        return
      }
      // Starting an already-running service is intentional: onStartCommand
      // swaps the foreground notification immediately when ownership changes.
      ContextCompat.startForegroundService(
        context,
        Intent(context, T1ArcGlucoseDisplayService::class.java),
      )
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, T1ArcGlucoseDisplayService::class.java))
      T1ArcGlucoseNotification.cancel(context)
    }
  }
}

class T1ArcLibreHeadlessService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig {
    val reason =
      intent
        ?.getStringExtra(HEADLESS_REASON_EXTRA)
        ?.takeIf { it == VALIDATED_NETWORK_SYNC_REASON }
        ?: DISPLAY_SYNC_REASON
    return HeadlessJsTaskConfig(
      HEADLESS_TASK_KEY,
      Arguments.createMap().apply { putString("reason", reason) },
      HEADLESS_TIMEOUT_MS,
      true,
    )
  }

  override fun onDestroy() {
    T1ArcGlucoseDisplayState.headlessTaskActive.set(false)
    T1ArcGlucoseDisplayService.headlessTaskFinished()
    super.onDestroy()
  }
}

class T1ArcGlucoseDisplayBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (intent?.action in setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED)) {
      try {
        T1ArcGlucoseSurfaceStartupReconciler.reconcileOnce(context)
      } catch (_: Exception) {
        // Android can defer foreground starts. Opening T1 Arc retries both
        // cleanup of persisted-off surfaces and restoration of active owners.
      }
    }
  }
}

class T1ArcAodAccessibilityService : AccessibilityService() {
  private lateinit var displayManager: DisplayManager
  private lateinit var powerManager: PowerManager
  private lateinit var windowManager: WindowManager
  private val handler = Handler(Looper.getMainLooper())
  private val overlayLifecycle = AodOverlayLifecyclePolicy()
  private var currentState = Display.STATE_UNKNOWN
  private var overlay: ImageView? = null
  private var overlayBitmap: Bitmap? = null
  private var pendingOverlayRunnable: Runnable? = null
  private var minuteRefreshRunnable: Runnable? = null
  private var receiverRegistered = false
  private var initialized = false

  private val displayListener =
    object : DisplayManager.DisplayListener {
      override fun onDisplayAdded(displayId: Int) = Unit
      override fun onDisplayRemoved(displayId: Int) = Unit
      override fun onDisplayChanged(displayId: Int) {
        if (displayId != Display.DEFAULT_DISPLAY) return
        val state =
          displayManager.getDisplay(Display.DEFAULT_DISPLAY)?.state
            ?: Display.STATE_UNKNOWN
        displayStateChanged(state, 250L)
      }
    }

  private val screenReceiver =
    object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
        when (intent?.action) {
          Intent.ACTION_SCREEN_OFF ->
            displayStateChanged(Display.STATE_OFF, 1_000L)
          Intent.ACTION_SCREEN_ON ->
            displayStateChanged(Display.STATE_ON, 0L)
          Intent.ACTION_USER_PRESENT -> removeOverlay()
        }
      }
    }

  override fun onServiceConnected() {
    super.onServiceConnected()
    if (initialized) return
    initialized = true
    instance = this
    displayManager = getSystemService(DISPLAY_SERVICE) as DisplayManager
    powerManager = getSystemService(POWER_SERVICE) as PowerManager
    windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
    displayManager.registerDisplayListener(displayListener, handler)
    val filter =
      IntentFilter().apply {
        addAction(Intent.ACTION_SCREEN_ON)
        addAction(Intent.ACTION_SCREEN_OFF)
        addAction(Intent.ACTION_USER_PRESENT)
      }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(screenReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("DEPRECATION")
      registerReceiver(screenReceiver, filter)
    }
    receiverRegistered = true
    T1ArcAodDiagnostics.recordEvent(
      this,
      "T1 Arc service connected · lock your Pixel to test",
    )
    handler.postDelayed({ triggerDisplayCheck() }, 500L)
  }

  private fun triggerDisplayCheck() {
    val state =
      displayManager.getDisplay(Display.DEFAULT_DISPLAY)?.state
        ?: Display.STATE_UNKNOWN
    if (state != Display.STATE_ON) displayStateChanged(state, 600L)
    else currentState = state
  }

  private fun displayStateChanged(state: Int, delayMillis: Long) {
    if (!initialized) return
    currentState = state
    when (state) {
      Display.STATE_OFF,
      Display.STATE_DOZE,
      Display.STATE_DOZE_SUSPEND -> checkAndCreateOverlay(delayMillis)
      else -> removeOverlay()
    }
  }

  private fun displayIsDozing(): Boolean =
    currentState == Display.STATE_OFF ||
      currentState == Display.STATE_DOZE ||
      currentState == Display.STATE_DOZE_SUSPEND

  private fun isDozing(): Boolean {
    if (!initialized || powerManager.isInteractive) return false
    val state =
      displayManager.getDisplay(Display.DEFAULT_DISPLAY)?.state
        ?: currentState
    currentState = state
    return displayIsDozing()
  }

  private fun checkAndCreateOverlay(delayMillis: Long = 1_000L) {
    if (pendingOverlayRunnable != null) return
    val lifecycleToken = overlayLifecycle.token()
    val runnable =
      Runnable {
        pendingOverlayRunnable = null
        if (overlayLifecycle.token() != lifecycleToken) return@Runnable
        if (isDozing()) updateOverlay(lifecycleToken)
        else removeOverlay()
      }
    pendingOverlayRunnable = runnable
    handler.postDelayed(runnable, delayMillis)
  }

  private fun updateOverlay(lifecycleToken: Long = overlayLifecycle.token()) {
    minuteRefreshRunnable?.let(handler::removeCallbacks)
    minuteRefreshRunnable = null
    val snapshot = T1ArcGlucoseDisplayState.snapshot(this)
    if (
      !overlayLifecycle.shouldRender(
        token = lifecycleToken,
        interactive = powerManager.isInteractive,
        displayIsDozing = isDozing(),
        displayEnabled = T1ArcGlucoseDisplayState.enabled(this),
        aodDesired = T1ArcGlucoseDisplayState.aodDesired(this),
        snapshotAvailable = snapshot != null,
      )
    ) {
      removeOverlay()
      return
    }

    try {
      val previousBitmap = overlayBitmap
      val bitmap = renderBitmap(requireNotNull(snapshot))
      val layout = overlayLayoutParams(bitmap)
      val existing = overlay
      if (existing == null) {
        val image =
          ImageView(this).apply {
            setImageBitmap(bitmap)
            contentDescription = null
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
          }
        windowManager.addView(image, layout)
        overlay = image
        overlayBitmap = bitmap
        T1ArcAodDiagnostics.overlayVisible = true
        T1ArcAodDiagnostics.recordEvent(
          this,
          "Always-on glucose rendered successfully",
        )
      } else {
        // Android's rendering pipeline may still reference the previous
        // BitmapDrawable after this frame. Replace it, but never recycle its
        // bitmap manually; the GC releases it once every renderer is done.
        val sizeChanged =
          previousBitmap == null ||
            previousBitmap.width != bitmap.width ||
            previousBitmap.height != bitmap.height
        existing.setImageBitmap(bitmap)
        overlayBitmap = bitmap
        existing.invalidate()
        val current = existing.layoutParams as? WindowManager.LayoutParams
        if (
          current == null ||
            current.x != layout.x ||
            current.y != layout.y ||
            sizeChanged
        ) {
          windowManager.updateViewLayout(existing, layout)
        }
      }
      val refreshRunnable =
        Runnable {
          minuteRefreshRunnable = null
          if (overlayLifecycle.token() != lifecycleToken) return@Runnable
          if (isDozing()) updateOverlay(lifecycleToken)
          else removeOverlay()
        }
      minuteRefreshRunnable = refreshRunnable
      handler.postDelayed(refreshRunnable, DISPLAY_REFRESH_INTERVAL_MS)
    } catch (error: Exception) {
      removeOverlay()
      T1ArcAodDiagnostics.recordError(
        this,
        "${error.javaClass.simpleName}: ${error.message ?: "overlay could not be added"}",
      )
    }
  }

  private fun overlayLayoutParams(bitmap: Bitmap): WindowManager.LayoutParams {
    val screenBounds =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        windowManager.currentWindowMetrics.bounds
      } else {
        @Suppress("DEPRECATION")
        Rect().also { windowManager.defaultDisplay.getRectSize(it) }
      }
    val position = T1ArcGlucoseDisplayState.aodPosition(this)
    val margin = dp(16)
    val maxX = max(0, screenBounds.width() - bitmap.width)
    val x =
      when {
        position.endsWith("Left") -> margin
        position.endsWith("Right") -> maxX - margin
        else -> maxX / 2
      }.coerceIn(0, maxX)
    val maxY = max(0, screenBounds.height() - bitmap.height)
    val yFraction =
      when {
        position.startsWith("top") -> 0.22f
        position.startsWith("middle") -> 0.50f
        else -> 0.78f
      }
    val y = (maxY * yFraction).roundToInt().coerceIn(0, maxY)

    return WindowManager.LayoutParams().apply {
      type = WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY
      format = PixelFormat.TRANSLUCENT
      flags =
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
          WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
      width = WindowManager.LayoutParams.WRAP_CONTENT
      height = WindowManager.LayoutParams.WRAP_CONTENT
      gravity = Gravity.TOP or Gravity.START
      this.x = x
      this.y = y
    }
  }

  private fun renderBitmap(snapshot: GlucoseDisplaySnapshot): Bitmap {
    val spec =
      when (T1ArcGlucoseDisplayState.aodSize(this)) {
        "small" ->
          AodRenderSpec(
            widthDp = 188,
            heightDp = 80,
            valueSp = 28,
            unitSp = 8,
            statusSp = 9,
            valueBaselineDp = 34,
            unitBaselineDp = 51,
            statusBaselineDp = 69,
          )
        "large" ->
          AodRenderSpec(
            widthDp = 312,
            heightDp = 136,
            valueSp = 48,
            unitSp = 11,
            statusSp = 13,
            valueBaselineDp = 58,
            unitBaselineDp = 86,
            statusBaselineDp = 117,
          )
        else ->
          AodRenderSpec(
            widthDp = 248,
            heightDp = 104,
            valueSp = 36,
            unitSp = 9,
            statusSp = 11,
            valueBaselineDp = 45,
            unitBaselineDp = 65,
            statusBaselineDp = 88,
          )
      }
    val freshness = T1ArcGlucoseDisplayState.freshness(this)
    val tone =
      T1ArcGlucoseDisplayState.displayColor(this, snapshot, freshness)
    val arrow =
      when (snapshot.trend) {
        "doubleDown" -> "⇊"
        "down" -> "↓"
        "slightDown" -> "↘"
        "flat" -> "→"
        "slightUp" -> "↗"
        "up" -> "↑"
        "doubleUp" -> "⇈"
        else -> "?"
      }
    val value = T1ArcGlucoseDisplayState.displayGlucoseValue(this, snapshot.mmolL)
    val ageMinutes =
      floor(max(0L, System.currentTimeMillis() - snapshot.timestampMs) / 60_000.0)
        .toInt()
    val age =
      if (ageMinutes == 0) {
        "JUST NOW"
      } else {
        "${RegionalNumberFormatter.integer(ageMinutes.toLong(), T1ArcGlucoseDisplayState.displayLocale(this))} MIN AGO"
      }
    val trendBasis = if (snapshot.trendOrigin == "calculated") " · CALC" else ""
    val status =
      if (freshness == DisplayFreshness.STALE) {
        "STALE · LAST KNOWN · $age$trendBasis"
      } else {
        "${freshness.label.uppercase(T1ArcGlucoseDisplayState.displayLocale(this))} · $age$trendBasis"
      }
    val width = dp(spec.widthDp)
    val height = dp(spec.heightDp)
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    bitmap.eraseColor(Color.TRANSPARENT)
    val canvas = Canvas(bitmap)
    val valuePaint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = tone
        textAlign = Paint.Align.CENTER
        textSize = sp(spec.valueSp)
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      }
    val statusPaint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(205, 222, 226)
        textAlign = Paint.Align.CENTER
        textSize = sp(spec.statusSp)
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        letterSpacing = 0.08f
      }
    val unitPaint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(169, 189, 194)
        textAlign = Paint.Align.CENTER
        textSize = sp(spec.unitSp)
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      }
    val readingText = "$value  $arrow"
    val readingBaseline = dp(spec.valueBaselineDp).toFloat()
    canvas.drawText(
      readingText,
      width / 2f,
      readingBaseline,
      valuePaint,
    )
    if (freshness == DisplayFreshness.STALE) {
      val halfWidth = valuePaint.measureText(readingText) / 2f
      canvas.drawLine(
        width / 2f - halfWidth,
        readingBaseline - valuePaint.textSize * 0.31f,
        width / 2f + halfWidth,
        readingBaseline - valuePaint.textSize * 0.31f,
        Paint(valuePaint).apply {
          style = Paint.Style.STROKE
          strokeCap = Paint.Cap.ROUND
          strokeWidth = max(dp(2).toFloat(), valuePaint.textSize * 0.055f)
        },
      )
    }
    canvas.drawText(
      T1ArcGlucoseDisplayState.displayGlucoseUnit(this),
      width / 2f,
      dp(spec.unitBaselineDp).toFloat(),
      unitPaint,
    )
    canvas.drawText(
      status,
      width / 2f,
      dp(spec.statusBaselineDp).toFloat(),
      statusPaint,
    )
    return bitmap
  }

  private fun removeOverlay() {
    overlayLifecycle.invalidate()
    pendingOverlayRunnable?.let(handler::removeCallbacks)
    pendingOverlayRunnable = null
    minuteRefreshRunnable?.let(handler::removeCallbacks)
    minuteRefreshRunnable = null
    val view = overlay
    overlay = null
    overlayBitmap = null
    view?.setImageDrawable(null)
    if (view != null && this::windowManager.isInitialized) {
      try {
        windowManager.removeViewImmediate(view)
      } catch (_: Exception) {
        // System UI may already have removed the doze overlay.
      }
    }
    T1ArcAodDiagnostics.overlayVisible = false
  }

  private fun dp(value: Int) =
    (value * resources.displayMetrics.density).roundToInt()

  private fun sp(value: Int) =
    value * resources.displayMetrics.scaledDensity

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (this::powerManager.isInitialized && powerManager.isInteractive) {
      removeOverlay()
      return
    }
    if (
      event != null &&
        (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
          event.eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) &&
        !powerManager.isInteractive
    ) {
      // System UI emits frequent content changes while AOD is active. They are
      // only a recovery signal if Android has actually detached our window;
      // rebuilding a healthy overlay here causes visible blinking.
      if (overlay?.isAttachedToWindow != true) {
        removeOverlay()
        checkAndCreateOverlay(150L)
      }
    }
  }

  override fun onInterrupt() {
    removeOverlay()
  }

  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    pendingOverlayRunnable = null
    if (initialized) removeOverlay()
    if (this::displayManager.isInitialized) {
      displayManager.unregisterDisplayListener(displayListener)
    }
    if (receiverRegistered) {
      try {
        unregisterReceiver(screenReceiver)
      } catch (_: Exception) {
        // Already released by Android.
      }
    }
    if (instance === this) instance = null
    initialized = false
    super.onDestroy()
  }

  companion object {
    @Volatile private var instance: T1ArcAodAccessibilityService? = null

    fun snapshotChanged() {
      val service = instance ?: return
      val lifecycleToken = service.overlayLifecycle.token()
      service.handler.post {
        if (service.overlayLifecycle.token() != lifecycleToken) return@post
        if (
          service.isDozing() &&
            T1ArcGlucoseDisplayState.enabled(service) &&
            T1ArcGlucoseDisplayState.aodDesired(service)
        ) {
          service.updateOverlay(lifecycleToken)
        } else {
          service.removeOverlay()
        }
      }
    }
  }
}

private object T1ArcGlucoseSurfaceStartupReconciler {
  private val reconciled = AtomicBoolean(false)

  fun reconcileOnce(context: Context) {
    if (!reconciled.compareAndSet(false, true)) return
    try {
      val cleanup =
        GlucoseSurfaceStartupPolicy.resolve(
          PersistedGlucoseSurfaceState(
            displayEnabled = T1ArcGlucoseDisplayState.enabled(context),
            aodDesired = T1ArcGlucoseDisplayState.aodDesired(context),
            androidAutoEnabled = T1ArcGlucoseDisplayState.androidAutoEnabled(context),
            alertMonitoringEnabled = T1ArcGlucoseDisplayState.alertMonitoringEnabled(context),
            lockScreenVisible = T1ArcGlucoseDisplayState.lockScreenVisible(context),
          )
        )
      T1ArcGlucosePhoneSurfaceGate.mutate {
        if (cleanup.cancelDisplayNotification) {
          T1ArcGlucoseNotification.cancel(context)
        }
        if (cleanup.removeAodOverlay) {
          T1ArcAodAccessibilityService.snapshotChanged()
        }
      }
      if (cleanup.cancelGlucoseAlerts) {
        T1ArcGlucoseAlertOwnershipGate.cancelIfUnownedOrPrivate(context)
      }
      if (cleanup.cancelAndroidAuto) {
        T1ArcAndroidAuto.settingChanged(context)
      }
      T1ArcGlucoseDisplayService.reconcile(context)
    } catch (error: Exception) {
      reconciled.set(false)
      throw error
    }
  }
}

class T1ArcGlucoseDisplayModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T1ArcGlucoseDisplay")

    OnCreate {
      appContext.reactContext?.let(T1ArcGlucoseSurfaceStartupReconciler::reconcileOnce)
    }

    OnActivityEntersForeground {
      // OnCreate may run before React has a usable context. Once startup cleanup
      // has run, foreground entries retain the existing lightweight owner repair.
      appContext.reactContext?.let { context ->
        T1ArcGlucoseSurfaceStartupReconciler.reconcileOnce(context)
        T1ArcGlucoseDisplayService.ensureRunning(context)
      }
    }

    AsyncFunction("getStatusAsync") Coroutine { ->
      status(requireNotNull(appContext.reactContext))
    }

    AsyncFunction("getPrivateGlucoseWriteEpochAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      T1ArcGlucosePublicationGate.observeCurrent(context) { it.toDouble() }
    }

    AsyncFunction("getWatchFaceStatusAsync") Coroutine { ->
      T1ArcWatchFaceClient.status(requireNotNull(appContext.reactContext))
    }

    AsyncFunction("installBundledWatchFaceAsync") Coroutine { nodeId: String, faceId: String ->
      T1ArcWatchFaceClient.install(requireNotNull(appContext.reactContext), nodeId, faceId)
    }

    AsyncFunction("openWatchFaceActivationAsync") Coroutine { nodeId: String ->
      T1ArcWatchFaceClient.openActivation(requireNotNull(appContext.reactContext), nodeId)
    }

    AsyncFunction("getWearStatusAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      try {
        val connectedNodes =
          Tasks.await(
            Wearable.getNodeClient(context).connectedNodes,
            5,
            TimeUnit.SECONDS,
          )
        val capability =
          Tasks.await(
            Wearable.getCapabilityClient(context).getCapability(
              WEAR_CAPABILITY,
              CapabilityClient.FILTER_REACHABLE,
            ),
            5,
            TimeUnit.SECONDS,
          )
        var latestReadingAvailable = false
        var republishAttempted = false
        var republishSucceeded = false
        var republishError: String? = null
        T1ArcGlucosePublicationGate.observeCurrent(context) { writeEpoch ->
          val snapshot = T1ArcGlucoseDisplayState.snapshot(context)
          latestReadingAvailable = snapshot != null
          if (capability.nodes.isNotEmpty() && snapshot != null) {
            republishAttempted = true
            try {
              Tasks.await(
                T1ArcWearSync.publish(
                  context,
                  snapshot,
                  writeEpoch,
                  System.currentTimeMillis(),
                ),
                5,
                TimeUnit.SECONDS,
              )
              republishSucceeded = true
            } catch (error: Exception) {
              republishError =
                "The watch was found, but the latest glucose could not be queued: " +
                  (error.message ?: "unknown Data Layer error")
            }
          }
        }
        mapOf(
          "supported" to true,
          "querySucceeded" to true,
          "pairedWatchCount" to connectedNodes.size,
          "companionWatchCount" to capability.nodes.size,
          "companionAvailable" to capability.nodes.isNotEmpty(),
          "watchNames" to capability.nodes.map { it.displayName }.sorted(),
          "latestReadingAvailable" to latestReadingAvailable,
          "republishAttempted" to republishAttempted,
          "republishSucceeded" to republishSucceeded,
          "error" to republishError,
        )
      } catch (error: Exception) {
        mapOf(
          "supported" to true,
          "querySucceeded" to false,
          "pairedWatchCount" to 0,
          "companionWatchCount" to 0,
          "companionAvailable" to false,
          "watchNames" to emptyList<String>(),
          "error" to (error.message ?: "Wear OS status is temporarily unavailable."),
        )
      }
    }

    AsyncFunction("getHomeWidgetStatusAsync") Coroutine { ->
      T1ArcGlucoseWidget.status(requireNotNull(appContext.reactContext))
    }

    AsyncFunction("requestPinHomeWidgetAsync") Coroutine { ->
      T1ArcGlucoseWidget.requestPin(requireNotNull(appContext.reactContext))
    }

    AsyncFunction("enableAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      T1ArcGlucosePhoneSurfaceGate.mutate {
        T1ArcGlucoseDisplayState.setEnabled(context, true)
      }
      T1ArcGlucoseDisplayService.reconcile(context)
      status(context)
    }

    AsyncFunction("disableAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      T1ArcGlucosePhoneSurfaceGate.disable(context) {
        T1ArcGlucoseNotification.cancel(context)
      }
      T1ArcGlucoseDisplayService.reconcile(context)
      status(context)
    }

    AsyncFunction("setLockScreenVisibleAsync") Coroutine { visible: Boolean ->
      val context = requireNotNull(appContext.reactContext)
      T1ArcGlucoseAlertOwnershipGate.updateLockScreenVisibility(context, visible)
      T1ArcGlucoseNotification.notify(context)
      status(context)
    }

    AsyncFunction("setAodDesiredAsync") Coroutine { desired: Boolean ->
      val context = requireNotNull(appContext.reactContext)
      T1ArcGlucosePhoneSurfaceGate.mutate {
        T1ArcGlucoseDisplayState.setAodDesired(context, desired)
        T1ArcAodAccessibilityService.snapshotChanged()
      }
      status(context)
    }

    AsyncFunction("setAodPositionAsync") Coroutine { position: String ->
      val context = requireNotNull(appContext.reactContext)
      T1ArcGlucosePhoneSurfaceGate.mutate {
        T1ArcGlucoseDisplayState.setAodPosition(context, position)
        T1ArcAodAccessibilityService.snapshotChanged()
      }
      status(context)
    }

    AsyncFunction("setAodSizeAsync") Coroutine { size: String ->
      val context = requireNotNull(appContext.reactContext)
      T1ArcGlucosePhoneSurfaceGate.mutate {
        T1ArcGlucoseDisplayState.setAodSize(context, size)
        T1ArcAodAccessibilityService.snapshotChanged()
      }
      status(context)
    }

    AsyncFunction("setAndroidAutoEnabledAsync") Coroutine { enabled: Boolean ->
      val context = requireNotNull(appContext.reactContext)
      T1ArcGlucoseDisplayState.setAndroidAutoEnabled(context, enabled)
      T1ArcAndroidAuto.settingChanged(context)
      status(context)
    }

    AsyncFunction("setRegionalDisplayPreferencesAsync") Coroutine {
        glucoseUnit: String,
        localeTag: String,
        timeZone: String,
      ->
      val context = requireNotNull(appContext.reactContext)
      T1ArcGlucoseDisplayState.setRegionalDisplayPreferences(
        context,
        glucoseUnit,
        localeTag,
        timeZone,
      )
      T1ArcGlucosePublicationGate.observeCurrent(context) { writeEpoch ->
        T1ArcGlucoseDisplayState.snapshot(context)?.let { snapshot ->
          runCatching {
            Tasks.await(
              T1ArcWearSync.publish(context, snapshot, writeEpoch),
              5,
              TimeUnit.SECONDS,
            )
          }
        }
      }
      T1ArcAndroidAuto.refresh(context)
      if (T1ArcGlucoseDisplayState.enabled(context)) {
        T1ArcGlucoseNotification.notify(context)
      }
      T1ArcGlucoseWidget.updateAll(context)
      T1ArcAodAccessibilityService.snapshotChanged()
      true
    }

    AsyncFunction("getAppearanceSettingsAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      T1ArcGlucoseDisplayState.appearance(context).asMap()
    }

    AsyncFunction("setAppearanceSettingsAsync") Coroutine {
        settings: Map<String, Any?>,
      ->
      val context = requireNotNull(appContext.reactContext)
      val appearance = appearanceFromMap(settings)
      T1ArcGlucoseDisplayState.setAppearance(context, appearance)
      T1ArcGlucosePublicationGate.observeCurrent(context) { writeEpoch ->
        if (T1ArcGlucoseDisplayState.enabled(context)) {
          T1ArcGlucoseNotification.notify(context)
        }
        T1ArcGlucoseDisplayState.snapshot(context)?.let {
          runCatching {
            Tasks.await(
              T1ArcWearSync.publish(context, it, writeEpoch),
              5,
              TimeUnit.SECONDS,
            )
          }
        }
        runCatching {
          Tasks.await(
            T1ArcWearSync.publishHistory(
              context,
              T1ArcWearSync.history(),
              writeEpoch,
            ),
            5,
            TimeUnit.SECONDS,
          )
        }
        T1ArcGlucoseWidget.updateAll(context)
        T1ArcAodAccessibilityService.snapshotChanged()
      }
      appearance.asMap()
    }

    AsyncFunction("updateReadingAsync") Coroutine {
        mmolL: Double,
        trend: String,
        timestampMs: Double,
        sourceLabel: String,
        sourceHasError: Boolean,
        trendOrigin: String,
      ->
      val context = requireNotNull(appContext.reactContext)
      val snapshot =
        validatedGlucoseSnapshot(
          mmolL,
          trend,
          timestampMs,
          sourceLabel,
          sourceHasError,
          trendOrigin,
        )
      T1ArcGlucosePublicationGate.mutateLegacy(context) { writeEpoch ->
        T1ArcGlucoseDisplayState.setSnapshot(context, snapshot)
        runCatching {
          Tasks.await(
            T1ArcWearSync.publish(context, snapshot, writeEpoch),
            5,
            TimeUnit.SECONDS,
          )
        }
        T1ArcAndroidAuto.refresh(context)
        if (T1ArcGlucoseDisplayState.enabled(context)) {
          T1ArcGlucoseDisplayService.ensureRunning(context)
          T1ArcGlucoseNotification.notify(context)
        }
        T1ArcGlucoseWidget.updateAll(context)
        status(context)
      }
    }

    AsyncFunction("updatePrivateGlucoseForWriteEpochAsync") Coroutine {
        writeEpoch: Double,
        snapshot: Map<String, Any?>?,
        readings: List<Map<String, Any?>>,
        missingSourceLabel: String,
      ->
      val context = requireNotNull(appContext.reactContext)
      val parsedSnapshot = snapshotFromBridgeMap(snapshot)
      val history = historyFromBridgeMaps(readings)
      T1ArcGlucosePublicationGate.mutateForEpoch(context, writeEpoch) { epoch ->
        applyPrivateGlucosePublication(
          context,
          epoch,
          parsedSnapshot,
          history,
          missingSourceLabel,
        )
      }
    }

    AsyncFunction("clearPrivateGlucoseForWriteEpochAsync") Coroutine {
        writeEpoch: Double,
        missingSourceLabel: String,
      ->
      val context = requireNotNull(appContext.reactContext)
      T1ArcGlucosePublicationGate.clearForEpoch(context, writeEpoch) { epoch ->
        clearPrivateGlucosePublication(context, epoch, missingSourceLabel)
        status(context)
      }
    }

    AsyncFunction("updateMissingAsync") Coroutine { sourceLabel: String ->
      val context = requireNotNull(appContext.reactContext)
      T1ArcGlucosePublicationGate.mutateLegacy(context) { writeEpoch ->
        T1ArcGlucoseDisplayState.clearSnapshot(context)
        runCatching {
          Tasks.await(
            T1ArcWearSync.publishMissing(context, sourceLabel, writeEpoch),
            5,
            TimeUnit.SECONDS,
          )
        }
        T1ArcAndroidAuto.refresh(context)
        T1ArcGlucoseNotification.notify(context)
        T1ArcGlucoseWidget.updateAll(context)
        status(context)
      }
    }

    AsyncFunction("updateHistoryAsync") Coroutine {
        readings: List<Map<String, Any?>>,
      ->
      val context = requireNotNull(appContext.reactContext)
      val history = historyFromBridgeMaps(readings)
      T1ArcGlucosePublicationGate.mutateLegacy(context) { writeEpoch ->
        // A phone without Wearable Play Services, or a temporarily disconnected
        // watch, must not turn a successful glucose refresh into a failed
        // background job. The latest phone snapshot remains authoritative and
        // the next successful watch connection will publish history again.
        val published =
          runCatching {
            Tasks.await(
              T1ArcWearSync.publishHistory(context, history, writeEpoch),
              5,
              TimeUnit.SECONDS,
            )
            true
          }.getOrDefault(false)
        T1ArcAndroidAuto.refresh(context)
        if (T1ArcGlucoseDisplayState.enabled(context)) {
          T1ArcGlucoseNotification.notify(context)
        }
        published
      }
    }

    AsyncFunction("showGlucoseAlertAsync") Coroutine {
        kind: String,
        mmolL: Double,
        trend: String,
        timestampMs: Double,
      ->
      T1ArcGlucoseAlertNotification.show(
        requireNotNull(appContext.reactContext),
        kind,
        mmolL,
        trend,
        timestampMs.toLong(),
      )
    }

    AsyncFunction("setGlucoseAlertMonitoringEnabledAsync") Coroutine {
        enabled: Boolean,
      ->
      val context = requireNotNull(appContext.reactContext)
      if (T1ArcGlucoseAlertOwnershipGate.updateOwner(context, enabled)) {
        T1ArcGlucoseDisplayService.reconcile(context)
      } else {
        T1ArcGlucoseDisplayService.ensureRunning(context)
      }
      true
    }

    AsyncFunction("cancelGlucoseAlertsAsync") Coroutine { ->
      T1ArcGlucoseAlertNotification.cancelAll(
        requireNotNull(appContext.reactContext)
      )
      true
    }

    AsyncFunction("glucoseAlertsAllowedAsync") Coroutine { ->
      T1ArcGlucoseAlertNotification.allowed(
        requireNotNull(appContext.reactContext)
      )
    }

    AsyncFunction("openGlucoseAlertSettingsAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      T1ArcGlucoseAlertNotification.ensureChannels(context)
      val intent =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).apply {
            putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            putExtra(
              Settings.EXTRA_CHANNEL_ID,
              T1ArcGlucoseAlertNotification.channelIdForSettings(
                GlucoseAlertChannelKind.LOW,
              ),
            )
          }
        } else {
          Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
            putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
          }
        }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      true
    }

    AsyncFunction("getGlucoseAlertChannelStatusesAsync") Coroutine { ->
      T1ArcGlucoseAlertNotification.statuses(
        requireNotNull(appContext.reactContext)
      )
    }

    AsyncFunction("showGlucoseTestAlertAsync") Coroutine { kind: String ->
      T1ArcGlucoseAlertNotification.showTest(
        requireNotNull(appContext.reactContext),
        kind,
      )
    }

    AsyncFunction("openGlucoseAlertChannelSettingsAsync") Coroutine { kind: String ->
      val context = requireNotNull(appContext.reactContext)
      val alertKind = GlucoseAlertChannelPolicy.kindFor(kind) ?: return@Coroutine false
      T1ArcGlucoseAlertNotification.ensureChannels(context)
      val intent =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).apply {
            putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            putExtra(
              Settings.EXTRA_CHANNEL_ID,
              T1ArcGlucoseAlertNotification.channelIdForSettings(alertKind),
            )
          }
        } else {
          Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
            putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
          }
        }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      true
    }

    AsyncFunction("openGlucoseAlertAppSettingsAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      context.startActivity(
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
          putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
      )
      true
    }

    AsyncFunction("openNotificationSettingsAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      T1ArcGlucoseNotification.ensureChannel(context)
      val intent =
        when (
          notificationSettingsDestination(
            appNotificationsAllowed =
              NotificationManagerCompat.from(context).areNotificationsEnabled(),
            channelSettingsSupported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O,
          )
        ) {
          NotificationSettingsDestination.APP ->
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
              putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            }
          NotificationSettingsDestination.CHANNEL ->
            Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).apply {
              putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
              putExtra(Settings.EXTRA_CHANNEL_ID, CHANNEL_ID)
            }
        }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      true
    }

    AsyncFunction("openAppDetailsSettingsAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      context.startActivity(
        Intent(
          Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
          Uri.parse("package:${context.packageName}"),
        ).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
      )
      true
    }

    AsyncFunction("openAccessibilitySettingsAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      context.startActivity(
        Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
          }
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
      )
      true
    }

    AsyncFunction("showReviewReadyNotificationAsync") Coroutine { ->
      T1ArcReviewNotification.show(requireNotNull(appContext.reactContext))
    }

    AsyncFunction("cancelReviewReadyNotificationAsync") Coroutine { ->
      T1ArcReviewNotification.cancel(requireNotNull(appContext.reactContext))
      true
    }

    AsyncFunction("showGlookoSignInRequiredAsync") Coroutine { ->
      T1ArcConnectorNotification.showGlookoSignInRequired(
        requireNotNull(appContext.reactContext)
      )
    }

    AsyncFunction("cancelGlookoSignInRequiredAsync") Coroutine { ->
      T1ArcConnectorNotification.cancelGlookoSignInRequired(
        requireNotNull(appContext.reactContext)
      )
      true
    }

    AsyncFunction("reviewNotificationsAllowedAsync") Coroutine { ->
      T1ArcReviewNotification.allowed(requireNotNull(appContext.reactContext))
    }

    AsyncFunction("openReviewNotificationSettingsAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      T1ArcReviewNotification.ensureChannel(context)
      val intent =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).apply {
            putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            putExtra(Settings.EXTRA_CHANNEL_ID, REVIEW_CHANNEL_ID)
          }
        } else {
          Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
            putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
          }
        }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      true
    }
  }

  private fun status(context: Context): Map<String, Any?> {
    val snapshot = T1ArcGlucoseDisplayState.snapshot(context)
    return mapOf(
      "supported" to true,
      "enabled" to T1ArcGlucoseDisplayState.enabled(context),
      "notificationsAllowed" to
        T1ArcGlucoseNotification.currentGlucoseNotificationsAllowed(context),
      "lockScreenVisible" to T1ArcGlucoseDisplayState.lockScreenVisible(context),
      "serviceRunning" to T1ArcGlucoseDisplayService.running,
      "aodDesired" to T1ArcGlucoseDisplayState.aodDesired(context),
      "aodPosition" to T1ArcGlucoseDisplayState.aodPosition(context),
      "aodSize" to T1ArcGlucoseDisplayState.aodSize(context),
      "aodServiceEnabled" to isAccessibilityServiceEnabled(context),
      "aodOverlayVisible" to T1ArcAodDiagnostics.overlayVisible,
      "androidAutoEnabled" to T1ArcGlucoseDisplayState.androidAutoEnabled(context),
      "androidAutoProjected" to T1ArcAndroidAuto.isProjected(),
      "aodLastEvent" to T1ArcAodDiagnostics.lastEvent(context),
      "aodLastError" to T1ArcAodDiagnostics.lastError(context),
      "latestMmolL" to snapshot?.mmolL,
      "latestTimestamp" to snapshot?.timestampMs?.toDouble(),
      "latestTrend" to snapshot?.trend,
      "latestTrendOrigin" to snapshot?.trendOrigin,
      "latestSourceLabel" to snapshot?.sourceLabel,
      "freshness" to T1ArcGlucoseDisplayState.freshness(context).wireValue,
    )
  }

  private fun appearanceFromMap(settings: Map<String, Any?>): GlucoseAppearance {
    fun number(key: String): Double =
      (settings[key] as? Number)?.toDouble()
        ?: throw IllegalArgumentException("$key must be a number.")

    val colors =
      settings["colors"] as? Map<*, *>
        ?: throw IllegalArgumentException("Display colours are missing.")

    fun color(key: String): String {
      val token = colors[key] as? String
        ?: throw IllegalArgumentException("$key colour is missing.")
      require(AOD_COLORS.containsKey(token)) { "$key colour is not supported." }
      return token
    }

    val appearance =
      GlucoseAppearance(
        veryLowMax = number("veryLowMax"),
        targetMin = number("targetMin"),
        targetMax = number("targetMax"),
        veryHighMin = number("veryHighMin"),
        veryLowColor = color("veryLow"),
        lowColor = color("low"),
        targetColor = color("target"),
        highColor = color("high"),
        veryHighColor = color("veryHigh"),
        staleColor = color("stale"),
      )
    require(
      appearance.veryLowMax in 1.0..30.0 &&
        appearance.targetMin in 1.0..30.0 &&
        appearance.targetMax in 1.0..30.0 &&
        appearance.veryHighMin in 1.0..30.0
    ) {
      "Glucose boundaries are outside the supported range."
    }
    require(
      appearance.veryLowMax < appearance.targetMin &&
        appearance.targetMin < appearance.targetMax &&
        appearance.targetMax < appearance.veryHighMin
    ) {
      "Glucose boundaries must increase from very low through very high."
    }
    return appearance
  }

  private fun isAccessibilityServiceEnabled(context: Context): Boolean {
    val expected = ComponentName(context, T1ArcAodAccessibilityService::class.java)
    val enabled =
      Settings.Secure.getString(
        context.contentResolver,
        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
      ) ?: return false
    return enabled
      .split(':')
      .mapNotNull(ComponentName::unflattenFromString)
      .any { it == expected }
  }
}
