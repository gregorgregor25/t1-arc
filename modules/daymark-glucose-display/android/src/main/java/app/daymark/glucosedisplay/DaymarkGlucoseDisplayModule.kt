package app.daymark.glucosedisplay

import android.Manifest
import android.accessibilityservice.AccessibilityService
import android.app.Notification
import android.app.NotificationChannel
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
import java.text.SimpleDateFormat
import java.security.KeyStore
import java.util.Date
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

private const val PREFERENCES_NAME = "daymark_glucose_display"
private const val ENABLED_KEY = "enabled"
private const val LOCK_SCREEN_VISIBLE_KEY = "lock_screen_visible"
private const val AOD_DESIRED_KEY = "aod_desired"
private const val AOD_POSITION_KEY = "aod_position"
private const val DEFAULT_AOD_POSITION = "bottomCenter"
private const val AOD_SIZE_KEY = "aod_size"
private const val DEFAULT_AOD_SIZE = "standard"
private const val ANDROID_AUTO_ENABLED_KEY = "android_auto_enabled"
private const val SNAPSHOT_PAYLOAD_KEY = "snapshot_encrypted_payload"
private const val SNAPSHOT_IV_KEY = "snapshot_encrypted_iv"
private const val SNAPSHOT_KEY_ALIAS = "daymark_glucose_display_snapshot_v1"
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
private const val CHANNEL_ID = "daymark_current_glucose_prominent_v2"
private const val LEGACY_CHANNEL_ID = "daymark_current_glucose_v1"
private const val NOTIFICATION_ID = 6417
private const val REVIEW_CHANNEL_ID = "daymark_weekly_review_v1"
private const val REVIEW_NOTIFICATION_ID = 6418
private const val CONNECTOR_CHANNEL_ID = "daymark_data_connections_v1"
private const val GLOOKO_SIGN_IN_NOTIFICATION_ID = 6419
private const val ALERT_CHANNEL_ID = "daymark_user_glucose_alerts_v1"
private const val LOW_ALERT_NOTIFICATION_ID = 6421
private const val HIGH_ALERT_NOTIFICATION_ID = 6422
private const val STALE_ALERT_NOTIFICATION_ID = 6423
private const val HEADLESS_TASK_KEY = "DaymarkLibreForegroundSync"
private const val DISPLAY_REFRESH_INTERVAL_MS = 60_000L
private const val GLUCOSE_SYNC_TICK_MS = 15_000L
private const val HEADLESS_TIMEOUT_MS = 55_000L
private const val CURRENT_AFTER_MS = 6 * 60_000L
private const val STALE_AFTER_MS = 12 * 60_000L
private const val LONDON_TIME_ZONE = "Europe/London"
private const val WEAR_GLUCOSE_PATH = "/daymark/glucose/current"
private const val WEAR_GLUCOSE_HISTORY_PATH = "/daymark/glucose/history"
private const val WEAR_GLUCOSE_REQUEST_PATH = "/daymark/glucose/request"
private const val WEAR_LOG_TAG = "DaymarkWearSync"
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
    "blue" to Color.rgb(130, 183, 255),
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

private object DaymarkSnapshotCipher {
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

internal object DaymarkGlucoseDisplayState {
  @Volatile var snapshot: GlucoseDisplaySnapshot? = null
  val headlessTaskActive = AtomicBoolean(false)

  fun preferences(context: Context) =
    context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  fun enabled(context: Context) =
    preferences(context).getBoolean(ENABLED_KEY, false)

  fun lockScreenVisible(context: Context) =
    preferences(context).getBoolean(LOCK_SCREEN_VISIBLE_KEY, true)

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
    preferences(context).getBoolean(ANDROID_AUTO_ENABLED_KEY, true)

  fun snapshot(context: Context): GlucoseDisplaySnapshot? {
    snapshot?.let { return it }
    val stored = preferences(context)
    val payload = stored.getString(SNAPSHOT_PAYLOAD_KEY, null) ?: return null
    val iv = stored.getString(SNAPSHOT_IV_KEY, null) ?: return null
    val restored = DaymarkSnapshotCipher.decrypt(payload, iv) ?: return null
    if (!restored.mmolL.isFinite() || restored.mmolL !in 0.5..40.0) return null
    snapshot = restored
    return restored
  }

  fun setSnapshot(context: Context, value: GlucoseDisplaySnapshot) {
    snapshot = value
    runCatching {
      val (payload, iv) = DaymarkSnapshotCipher.encrypt(value)
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
    val age = max(0L, now - value.timestampMs)
    val measured =
      when {
        age <= CURRENT_AFTER_MS -> DisplayFreshness.CURRENT
        age <= STALE_AFTER_MS -> DisplayFreshness.DELAYED
        else -> DisplayFreshness.STALE
      }
    return if (value.sourceHasError && measured == DisplayFreshness.CURRENT) {
      DisplayFreshness.DELAYED
    } else {
      measured
    }
  }

  fun setEnabled(context: Context, enabled: Boolean) {
    preferences(context).edit().putBoolean(ENABLED_KEY, enabled).apply()
  }

  fun setLockScreenVisible(context: Context, visible: Boolean) {
    preferences(context).edit().putBoolean(LOCK_SCREEN_VISIBLE_KEY, visible).apply()
  }

  fun setAodDesired(context: Context, desired: Boolean) {
    preferences(context).edit().putBoolean(AOD_DESIRED_KEY, desired).apply()
  }

  fun setAodPosition(context: Context, position: String) {
    require(AOD_POSITIONS.contains(position)) {
      "Always-on display position is not supported."
    }
    preferences(context).edit().putString(AOD_POSITION_KEY, position).apply()
  }

  fun setAodSize(context: Context, size: String) {
    require(AOD_SIZES.contains(size)) {
      "Always-on display size is not supported."
    }
    preferences(context).edit().putString(AOD_SIZE_KEY, size).apply()
  }

  fun setAndroidAutoEnabled(context: Context, enabled: Boolean) {
    preferences(context).edit().putBoolean(ANDROID_AUTO_ENABLED_KEY, enabled).apply()
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
      targetColor = stored.getString(COLOR_TARGET_KEY, "cyan") ?: "cyan",
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
    return AOD_COLORS[token] ?: AOD_COLORS.getValue("cyan")
  }
}

private object DaymarkGlucoseWidget {
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

  private fun ageCopy(timestampMs: Long, now: Long): String {
    val minutes = floor(max(0L, now - timestampMs) / 60_000.0).toInt()
    return when (minutes) {
      0 -> "JUST NOW"
      1 -> "1 MIN AGO"
      in 2..59 -> "$minutes MIN AGO"
      else -> "${minutes / 60} HR AGO"
    }
  }

  fun render(context: Context): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.daymark_glucose_widget)
    val snapshot = DaymarkGlucoseDisplayState.snapshot(context)
    val now = System.currentTimeMillis()
    val freshness = DaymarkGlucoseDisplayState.freshness(context, now)
    val color =
      DaymarkGlucoseDisplayState.displayColor(context, snapshot, freshness)
    if (snapshot == null) {
      views.setTextViewText(R.id.daymark_widget_value, "—")
      views.setInt(R.id.daymark_widget_value, "setPaintFlags", Paint.ANTI_ALIAS_FLAG)
      views.setTextViewText(R.id.daymark_widget_trend, "")
      views.setInt(R.id.daymark_widget_trend, "setPaintFlags", Paint.ANTI_ALIAS_FLAG)
      views.setTextViewText(R.id.daymark_widget_age, "NO DATA")
      views.setTextViewText(
        R.id.daymark_widget_status,
        "Waiting for personal glucose",
      )
      views.setContentDescription(
        R.id.daymark_widget_root,
        "T1 Arc. No personal glucose available.",
      )
    } else {
      val (arrow, direction) = trendPresentation(snapshot.trend)
      val directionCopy =
        if (snapshot.trendOrigin == "calculated") "$direction (calculated)" else direction
      val value = String.format(Locale.UK, "%.1f", snapshot.mmolL)
      views.setTextViewText(R.id.daymark_widget_value, value)
      val readingPaintFlags =
        Paint.ANTI_ALIAS_FLAG or
          (if (freshness == DisplayFreshness.STALE) Paint.STRIKE_THRU_TEXT_FLAG else 0)
      views.setInt(R.id.daymark_widget_value, "setPaintFlags", readingPaintFlags)
      views.setTextViewText(R.id.daymark_widget_trend, arrow)
      views.setInt(R.id.daymark_widget_trend, "setPaintFlags", readingPaintFlags)
      views.setTextViewText(
        R.id.daymark_widget_age,
        ageCopy(snapshot.timestampMs, now),
      )
      views.setTextViewText(
        R.id.daymark_widget_status,
        if (freshness == DisplayFreshness.STALE) {
          "Last known · Stale · ${snapshot.sourceLabel}"
        } else {
          "$directionCopy · ${freshness.label} · ${snapshot.sourceLabel}"
        },
      )
      views.setContentDescription(
        R.id.daymark_widget_root,
        if (freshness == DisplayFreshness.STALE) {
          "Last known stale glucose, $value millimoles per litre, shown struck through. ${ageCopy(snapshot.timestampMs, now).lowercase(Locale.UK)}."
        } else {
          "$value millimoles per litre. $directionCopy. ${freshness.label}. ${ageCopy(snapshot.timestampMs, now).lowercase(Locale.UK)}."
        },
      )
    }
    views.setTextColor(R.id.daymark_widget_value, color)
    views.setTextColor(R.id.daymark_widget_trend, color)
    pendingIntent(context)?.let {
      views.setOnClickPendingIntent(R.id.daymark_widget_root, it)
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
        ComponentName(context, DaymarkGlucoseWidgetProvider::class.java)
      )
    if (ids.isNotEmpty()) update(context, ids)
  }

  fun status(context: Context): Map<String, Any> {
    val manager = AppWidgetManager.getInstance(context)
    val ids =
      manager.getAppWidgetIds(
        ComponentName(context, DaymarkGlucoseWidgetProvider::class.java)
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
      ComponentName(context, DaymarkGlucoseWidgetProvider::class.java),
      null,
      null,
    )
  }
}

class DaymarkGlucoseWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray,
  ) {
    DaymarkGlucoseWidget.update(context, appWidgetIds)
  }

  override fun onEnabled(context: Context) {
    DaymarkGlucoseWidget.updateAll(context)
  }
}

/**
 * Publishes only the normalised display snapshot to T1 Arc's Wear OS
 * companion. LibreLinkUp credentials and session material never leave the
 * phone. Google Play services accepts the payload only for a watch app with
 * the same package name and signing certificate.
 */
internal object DaymarkWearSync {
  @Volatile private var latestHistory: List<GlucoseHistoryPoint> = emptyList()

  fun history(): List<GlucoseHistoryPoint> = latestHistory

  private fun snapshotData(
    context: Context,
    snapshot: GlucoseDisplaySnapshot,
    deliveryToken: Long? = null,
  ): DataMap {
    val appearance = DaymarkGlucoseDisplayState.appearance(context)
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
      deliveryToken?.let { putLong("deliveryToken", it) }
    }
  }

  private fun missingData(sourceLabel: String) =
    DataMap().apply {
      putInt("schemaVersion", 1)
      putBoolean("available", false)
      putString("sourceLabel", sourceLabel.take(80))
    }

  private fun historyData(
    context: Context,
    readings: List<GlucoseHistoryPoint>,
    deliveryToken: Long? = null,
  ) =
    DataMap().apply {
      val appearance = DaymarkGlucoseDisplayState.appearance(context)
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
      deliveryToken?.let { putLong("deliveryToken", it) }
    }

  private fun sendImmediate(
    context: Context,
    data: DataMap,
    path: String = WEAR_GLUCOSE_PATH,
  ) {
    // MessageClient is the real-time path while the watch is reachable.
    // The retained Data Item below remains the disconnected/reinstall fallback.
    Wearable.getNodeClient(context).connectedNodes.addOnSuccessListener { nodes ->
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

  fun publish(
    context: Context,
    snapshot: GlucoseDisplaySnapshot,
    deliveryToken: Long? = null,
  ): Task<DataItem> {
    val data = snapshotData(context, snapshot, deliveryToken)
    sendImmediate(context, data)
    val request =
      PutDataMapRequest.create(WEAR_GLUCOSE_PATH).apply {
        dataMap.putAll(data)
      }.asPutDataRequest().setUrgent()
    // Data items are retained for a temporarily disconnected watch. Routine
    // updates remain idempotent; an explicit connection check adds a delivery
    // token so a freshly sideloaded companion receives a new change event.
    return Wearable.getDataClient(context).putDataItem(request)
  }

  fun publishMissing(context: Context, sourceLabel: String) {
    val data = missingData(sourceLabel)
    sendImmediate(context, data)
    val request =
      PutDataMapRequest.create(WEAR_GLUCOSE_PATH).apply {
        dataMap.putAll(data)
      }.asPutDataRequest().setUrgent()
    Wearable.getDataClient(context).putDataItem(request)
  }

  fun publishHistory(
    context: Context,
    readings: List<GlucoseHistoryPoint>,
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
    val data = historyData(context, normalised, deliveryToken)
    sendImmediate(context, data, WEAR_GLUCOSE_HISTORY_PATH)
    val request =
      PutDataMapRequest.create(WEAR_GLUCOSE_HISTORY_PATH).apply {
        dataMap.putAll(data)
      }.asPutDataRequest().setUrgent()
    return Wearable.getDataClient(context).putDataItem(request)
  }
}

class DaymarkWearRequestService : WearableListenerService() {
  override fun onMessageReceived(messageEvent: MessageEvent) {
    if (messageEvent.path != WEAR_GLUCOSE_REQUEST_PATH) return
    Log.i(WEAR_LOG_TAG, "Watch requested current glucose and history")
    DaymarkGlucoseDisplayState.snapshot(this)?.let { snapshot ->
      DaymarkWearSync.publish(
        this,
        snapshot,
        System.currentTimeMillis(),
      )
    }
    val history = DaymarkWearSync.history()
    if (history.isNotEmpty()) {
      DaymarkWearSync.publishHistory(
        this,
        history,
        System.currentTimeMillis(),
      )
    } else {
      // The retained Data Item is the recovery source after a process restart.
      // Never replace it with an empty payload just because this in-memory
      // cache has not yet been repopulated by the JavaScript coordinator.
      Log.i(WEAR_LOG_TAG, "No in-memory history; preserving retained Wear history")
    }
  }
}

private object DaymarkAodDiagnostics {
  @Volatile var overlayVisible = false

  fun recordEvent(context: Context, value: String) {
    DaymarkGlucoseDisplayState.preferences(context)
      .edit()
      .putString(AOD_LAST_EVENT_KEY, value)
      .remove(AOD_LAST_ERROR_KEY)
      .apply()
  }

  fun recordError(context: Context, value: String) {
    DaymarkGlucoseDisplayState.preferences(context)
      .edit()
      .putString(AOD_LAST_ERROR_KEY, value.take(180))
      .apply()
  }

  fun lastEvent(context: Context) =
    DaymarkGlucoseDisplayState.preferences(context).getString(AOD_LAST_EVENT_KEY, null)

  fun lastError(context: Context) =
    DaymarkGlucoseDisplayState.preferences(context).getString(AOD_LAST_ERROR_KEY, null)
}

private object DaymarkGlucoseNotification {
  fun notificationsAllowed(context: Context): Boolean {
    if (
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
          PackageManager.PERMISSION_GRANTED
    ) {
      return false
    }
    return NotificationManagerCompat.from(context).areNotificationsEnabled()
  }

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    val channel =
      NotificationChannel(
        CHANNEL_ID,
        context.getString(R.string.daymark_glucose_channel_name),
        NotificationManager.IMPORTANCE_DEFAULT,
      ).apply {
        description = context.getString(R.string.daymark_glucose_channel_description)
        setSound(null, null)
        enableLights(false)
        enableVibration(false)
        setShowBadge(false)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      }
    manager.createNotificationChannel(channel)
    manager.deleteNotificationChannel(LEGACY_CHANNEL_ID)
  }

  private fun formatTime(timestampMs: Long): String =
    SimpleDateFormat("HH:mm", Locale.UK)
      .apply { timeZone = TimeZone.getTimeZone(LONDON_TIME_ZONE) }
      .format(Date(timestampMs))

  private fun ageCopy(timestampMs: Long, now: Long): String {
    val minutes = floor(max(0L, now - timestampMs) / 60_000.0).toInt()
    return when (minutes) {
      0 -> "just now"
      1 -> "1 min ago"
      else -> "$minutes min ago"
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
      Intent(Intent.ACTION_VIEW, Uri.parse("daymark://today")).apply {
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
      Intent(Intent.ACTION_VIEW, Uri.parse("daymark://today/log-food")).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      },
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  private fun contextLogPendingIntent(context: Context): PendingIntent =
    PendingIntent.getActivity(
      context,
      11,
      Intent(Intent.ACTION_VIEW, Uri.parse("daymark://today/log-context")).apply {
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
      return Icon.createWithResource(context, R.drawable.daymark_notification_pulse)
    }
    return try {
      val text = String.format(Locale.UK, "%.1f", snapshot.mmolL)
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
      Icon.createWithResource(context, R.drawable.daymark_notification_pulse)
    }
  }

  private fun historyBitmap(
    context: Context,
    snapshot: GlucoseDisplaySnapshot,
  ): Bitmap? {
    val allPoints = DaymarkWearSync.history()
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
      val appearance = DaymarkGlucoseDisplayState.appearance(context)
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
        canvas.drawText("LAST 3 HOURS", left, 26f, paint)
        paint.textAlign = Paint.Align.RIGHT
        canvas.drawText(formatTime(latestTimestamp), right, height - 15f, paint)
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
      .setSmallIcon(R.drawable.daymark_notification_pulse)
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

  fun build(context: Context): Notification {
    ensureChannel(context)
    val snapshot = DaymarkGlucoseDisplayState.snapshot(context)
    val now = System.currentTimeMillis()
    val freshness = DaymarkGlucoseDisplayState.freshness(context, now)
    val notification =
      if (snapshot == null) {
        builder(context)
          .setSmallIcon(R.drawable.daymark_notification_pulse)
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
        val value = String.format(Locale.UK, "%.1f", snapshot.mmolL)
        val age = ageCopy(snapshot.timestampMs, now)
        val status =
          if (freshness == DisplayFreshness.STALE) {
            "Stale · Last known · $age · ${formatTime(snapshot.timestampMs)}"
          } else {
            "${freshness.label} · $age · ${formatTime(snapshot.timestampMs)}"
          }
        val readingBuilder =
          builder(context)
          .setSmallIcon(valueIcon(context, snapshot, freshness))
          .setContentTitle(
            glucoseDisplayTitle(value, " $arrow  $directionCopy", freshness)
          )
          .setContentText("mmol/L · $status")
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
                  " mmol/L $arrow · $directionCopy",
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
                    " mmol/L $arrow · $directionCopy",
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
        DaymarkGlucoseDisplayState.displayColor(context, snapshot, freshness)
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

    if (DaymarkGlucoseDisplayState.lockScreenVisible(context)) {
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
    if (!DaymarkGlucoseDisplayState.enabled(context)) return
    val manager = context.getSystemService(NotificationManager::class.java)
    manager.notify(NOTIFICATION_ID, build(context))
    DaymarkGlucoseWidget.updateAll(context)
    DaymarkAodAccessibilityService.snapshotChanged()
  }

  fun cancel(context: Context) {
    context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
    DaymarkAodAccessibilityService.snapshotChanged()
  }
}

private object DaymarkReviewNotification {
  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    context.getSystemService(NotificationManager::class.java)
      .createNotificationChannel(
        NotificationChannel(
          REVIEW_CHANNEL_ID,
          context.getString(R.string.daymark_review_channel_name),
          NotificationManager.IMPORTANCE_LOW,
        ).apply {
          description = context.getString(R.string.daymark_review_channel_description)
          setSound(null, null)
          enableLights(false)
          enableVibration(false)
          setShowBadge(true)
          lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        }
      )
  }

  fun allowed(context: Context): Boolean {
    if (!DaymarkGlucoseNotification.notificationsAllowed(context)) return false
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
    ensureChannel(context)
    val channel =
      context.getSystemService(NotificationManager::class.java)
        .getNotificationChannel(REVIEW_CHANNEL_ID)
    return channel != null && channel.importance != NotificationManager.IMPORTANCE_NONE
  }

  private fun pendingIntent(context: Context): PendingIntent {
    val launch =
      Intent(Intent.ACTION_VIEW, Uri.parse("daymark://insights")).apply {
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
        .setSmallIcon(R.drawable.daymark_notification_pulse)
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

private object DaymarkConnectorNotification {
  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    context.getSystemService(NotificationManager::class.java)
      .createNotificationChannel(
        NotificationChannel(
          CONNECTOR_CHANNEL_ID,
          context.getString(R.string.daymark_connector_channel_name),
          NotificationManager.IMPORTANCE_LOW,
        ).apply {
          description = context.getString(R.string.daymark_connector_channel_description)
          setSound(null, null)
          enableLights(false)
          enableVibration(false)
          setShowBadge(true)
          lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        }
      )
  }

  private fun allowed(context: Context): Boolean {
    if (!DaymarkGlucoseNotification.notificationsAllowed(context)) return false
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
    ensureChannel(context)
    val channel =
      context.getSystemService(NotificationManager::class.java)
        .getNotificationChannel(CONNECTOR_CHANNEL_ID)
    return channel != null && channel.importance != NotificationManager.IMPORTANCE_NONE
  }

  private fun pendingIntent(context: Context): PendingIntent {
    val launch =
      Intent(Intent.ACTION_VIEW, Uri.parse("daymark://sources")).apply {
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
        .setSmallIcon(R.drawable.daymark_notification_pulse)
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

private object DaymarkGlucoseAlertNotification {
  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    context.getSystemService(NotificationManager::class.java)
      .createNotificationChannel(
        NotificationChannel(
          ALERT_CHANNEL_ID,
          context.getString(R.string.daymark_alert_channel_name),
          NotificationManager.IMPORTANCE_HIGH,
        ).apply {
          description = context.getString(R.string.daymark_alert_channel_description)
          enableLights(true)
          enableVibration(true)
          setShowBadge(true)
          lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        }
      )
  }

  fun allowed(context: Context): Boolean {
    if (!DaymarkGlucoseNotification.notificationsAllowed(context)) return false
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
    ensureChannel(context)
    val channel =
      context.getSystemService(NotificationManager::class.java)
        .getNotificationChannel(ALERT_CHANNEL_ID)
    return channel != null && channel.importance != NotificationManager.IMPORTANCE_NONE
  }

  private fun pendingIntent(context: Context): PendingIntent {
    val launch =
      Intent(Intent.ACTION_VIEW, Uri.parse("daymark://today")).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      }
    return PendingIntent.getActivity(
      context,
      LOW_ALERT_NOTIFICATION_ID,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun builder(context: Context): Notification.Builder =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, ALERT_CHANNEL_ID)
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
    if (kind !in setOf("low", "high", "stale")) return false
    if (!mmolL.isFinite() || mmolL !in 0.5..40.0 || timestampMs <= 0L) return false
    ensureChannel(context)
    if (!allowed(context)) return false

    val notificationId =
      when (kind) {
        "low" -> LOW_ALERT_NOTIFICATION_ID
        "high" -> HIGH_ALERT_NOTIFICATION_ID
        else -> STALE_ALERT_NOTIFICATION_ID
      }
    val title =
      when (kind) {
        "low" -> "Low glucose reading"
        "high" -> "High glucose reading"
        else -> "Glucose updates are stale"
      }
    val value = String.format(Locale.UK, "%.1f", mmolL)
    val direction = arrow(trend)
    val ageMinutes =
      floor(max(0L, System.currentTimeMillis() - timestampMs) / 60_000.0).toInt()
    val age = if (ageMinutes == 0) "just now" else "$ageMinutes min ago"
    val detail =
      if (kind == "stale") {
        "Last reading $value mmol/L was $age. Open T1 Arc to inspect freshness."
      } else {
        "$value mmol/L $direction · $age. Open T1 Arc to inspect the reading."
      }
    val notification =
      builder(context)
        .setSmallIcon(R.drawable.daymark_notification_pulse)
        .setContentTitle(title)
        .setContentText(detail)
        .setStyle(
          Notification.BigTextStyle().bigText(
            "$detail No dose or treatment calculation is included."
          )
        )
        .setContentIntent(pendingIntent(context))
        .setCategory(Notification.CATEGORY_ALARM)
        .setAutoCancel(true)
        .setOnlyAlertOnce(false)
        .setColor(
          if (kind == "high") Color.rgb(152, 82, 10) else Color.rgb(180, 35, 58)
        )
        .setShowWhen(true)
        .setWhen(System.currentTimeMillis())
        .setTimeoutAfter(if (kind == "stale") 4 * 60 * 60_000L else 2 * 60 * 60_000L)

    if (DaymarkGlucoseDisplayState.lockScreenVisible(context)) {
      notification.setVisibility(Notification.VISIBILITY_PUBLIC)
    } else {
      val redacted =
        builder(context)
          .setSmallIcon(R.drawable.daymark_notification_pulse)
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
      .notify(notificationId, notification.build())
    return true
  }

  fun cancelAll(context: Context) {
    context.getSystemService(NotificationManager::class.java).apply {
      cancel(LOW_ALERT_NOTIFICATION_ID)
      cancel(HIGH_ALERT_NOTIFICATION_ID)
      cancel(STALE_ALERT_NOTIFICATION_ID)
    }
  }
}

class DaymarkGlucoseDisplayService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private val renderRunnable =
    object : Runnable {
      override fun run() {
        if (!DaymarkGlucoseDisplayState.enabled(this@DaymarkGlucoseDisplayService)) return
        DaymarkGlucoseNotification.notify(this@DaymarkGlucoseDisplayService)
        handler.postDelayed(this, DISPLAY_REFRESH_INTERVAL_MS)
      }
    }
  private val syncRunnable =
    object : Runnable {
      override fun run() {
        if (!DaymarkGlucoseDisplayState.enabled(this@DaymarkGlucoseDisplayService)) return
        requestHeadlessSync()
        handler.postDelayed(this, GLUCOSE_SYNC_TICK_MS)
      }
    }

  override fun onCreate() {
    super.onCreate()
    running = true
    DaymarkAndroidAuto.initialize(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (!DaymarkGlucoseDisplayState.enabled(this)) {
      stopSelf()
      return START_NOT_STICKY
    }

    val notification = DaymarkGlucoseNotification.build(this)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }

    handler.removeCallbacks(renderRunnable)
    handler.removeCallbacks(syncRunnable)
    handler.post(renderRunnable)
    if (DaymarkGlucoseNotification.notificationsAllowed(this)) {
      // Avoid racing a React context that exists but is not fully active while
      // the app UI is starting. Cold boot still initializes Headless JS itself.
      handler.postDelayed(syncRunnable, 10_000L)
    }
    return START_STICKY
  }

  private fun requestHeadlessSync() {
    if (!DaymarkGlucoseDisplayState.headlessTaskActive.compareAndSet(false, true)) return
    try {
      startService(Intent(this, DaymarkLibreHeadlessService::class.java))
    } catch (_: Exception) {
      DaymarkGlucoseDisplayState.headlessTaskActive.set(false)
    }
  }

  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    running = false
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  companion object {
    @Volatile var running = false

    fun ensureRunning(context: Context) {
      if (!DaymarkGlucoseDisplayState.enabled(context) || running) return
      ContextCompat.startForegroundService(
        context,
        Intent(context, DaymarkGlucoseDisplayService::class.java),
      )
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, DaymarkGlucoseDisplayService::class.java))
      DaymarkGlucoseNotification.cancel(context)
    }
  }
}

class DaymarkLibreHeadlessService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig(
      HEADLESS_TASK_KEY,
      Arguments.createMap().apply { putString("reason", "glucose-display") },
      HEADLESS_TIMEOUT_MS,
      true,
    )

  override fun onDestroy() {
    DaymarkGlucoseDisplayState.headlessTaskActive.set(false)
    super.onDestroy()
  }
}

class DaymarkGlucoseDisplayBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (
      intent?.action in
        setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED) &&
        DaymarkGlucoseDisplayState.enabled(context)
    ) {
      try {
        DaymarkGlucoseDisplayService.ensureRunning(context)
      } catch (_: Exception) {
        // Android can defer foreground starts. Opening T1 Arc resumes the service.
      }
    }
  }
}

class DaymarkAodAccessibilityService : AccessibilityService() {
  private lateinit var displayManager: DisplayManager
  private lateinit var powerManager: PowerManager
  private lateinit var windowManager: WindowManager
  private val handler = Handler(Looper.getMainLooper())
  private var currentState = Display.STATE_UNKNOWN
  private var overlay: ImageView? = null
  private var overlayBitmap: Bitmap? = null
  private var pendingOverlayRunnable: Runnable? = null
  private var receiverRegistered = false
  private var initialized = false

  private val minuteRefreshRunnable =
    Runnable {
      if (isDozing()) updateOverlay()
    }

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
      }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(screenReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("DEPRECATION")
      registerReceiver(screenReceiver, filter)
    }
    receiverRegistered = true
    DaymarkAodDiagnostics.recordEvent(
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
    if (!initialized || state == Display.STATE_UNKNOWN) return
    currentState = state
    when (state) {
      Display.STATE_OFF,
      Display.STATE_DOZE,
      Display.STATE_DOZE_SUSPEND -> checkAndCreateOverlay(delayMillis)
      Display.STATE_ON -> {
        pendingOverlayRunnable?.let(handler::removeCallbacks)
        pendingOverlayRunnable = null
        removeOverlay()
      }
    }
  }

  private fun isDozing(): Boolean {
    if (!initialized || powerManager.isInteractive) return false
    val state =
      displayManager.getDisplay(Display.DEFAULT_DISPLAY)?.state
        ?: currentState
    return state == Display.STATE_OFF ||
      state == Display.STATE_DOZE ||
      state == Display.STATE_DOZE_SUSPEND
  }

  private fun checkAndCreateOverlay(delayMillis: Long = 1_000L) {
    if (pendingOverlayRunnable != null) return
    val runnable =
      Runnable {
        pendingOverlayRunnable = null
        if (isDozing()) updateOverlay()
        else removeOverlay()
      }
    pendingOverlayRunnable = runnable
    handler.postDelayed(runnable, delayMillis)
  }

  private fun updateOverlay() {
    handler.removeCallbacks(minuteRefreshRunnable)
    val snapshot = DaymarkGlucoseDisplayState.snapshot(this)
    if (
      !DaymarkGlucoseDisplayState.aodDesired(this) ||
        !DaymarkGlucoseDisplayState.enabled(this) ||
        !isDozing() ||
        snapshot == null
    ) {
      removeOverlay()
      return
    }

    try {
      val previousBitmap = overlayBitmap
      val bitmap = renderBitmap(snapshot)
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
        DaymarkAodDiagnostics.overlayVisible = true
        DaymarkAodDiagnostics.recordEvent(
          this,
          "Always-on glucose rendered successfully",
        )
      } else {
        // Keep the same accessibility window and, while the selected size is
        // unchanged, redraw the same bitmap in place. This avoids both the
      // black frame from rebuilding the overlay and a relayout flash on
      // each minute-age update.
      if (bitmap !== previousBitmap) {
        existing.setImageBitmap(bitmap)
        overlayBitmap = bitmap
        previousBitmap?.takeIf { !it.isRecycled }?.recycle()
      } else {
        existing.invalidate()
      }
        val current = existing.layoutParams as? WindowManager.LayoutParams
        if (
          current == null ||
            current.x != layout.x ||
            current.y != layout.y ||
            bitmap !== previousBitmap
        ) {
          windowManager.updateViewLayout(existing, layout)
        }
      }
      handler.postDelayed(minuteRefreshRunnable, DISPLAY_REFRESH_INTERVAL_MS)
    } catch (error: Exception) {
      removeOverlay()
      DaymarkAodDiagnostics.recordError(
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
    val position = DaymarkGlucoseDisplayState.aodPosition(this)
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
      when (DaymarkGlucoseDisplayState.aodSize(this)) {
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
    val freshness = DaymarkGlucoseDisplayState.freshness(this)
    val tone =
      DaymarkGlucoseDisplayState.displayColor(this, snapshot, freshness)
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
    val value = String.format(Locale.UK, "%.1f", snapshot.mmolL)
    val ageMinutes =
      floor(max(0L, System.currentTimeMillis() - snapshot.timestampMs) / 60_000.0)
        .toInt()
    val age = if (ageMinutes == 0) "JUST NOW" else "$ageMinutes MIN AGO"
    val trendBasis = if (snapshot.trendOrigin == "calculated") " · CALC" else ""
    val status =
      if (freshness == DisplayFreshness.STALE) {
        "STALE · LAST KNOWN · $age$trendBasis"
      } else {
        "${freshness.label.uppercase(Locale.UK)} · $age$trendBasis"
      }
    val width = dp(spec.widthDp)
    val height = dp(spec.heightDp)
    val bitmap =
      overlayBitmap?.takeIf {
        !it.isRecycled && it.width == width && it.height == height
      } ?: Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
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
      "mmol/L",
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

  private fun removeOverlay(cancelRefresh: Boolean = true) {
    if (cancelRefresh) handler.removeCallbacks(minuteRefreshRunnable)
    overlay?.let { view ->
      try {
        windowManager.removeView(view)
      } catch (_: Exception) {
        // System UI may already have removed the doze overlay.
      }
    }
    overlay = null
    overlayBitmap?.recycle()
    overlayBitmap = null
    DaymarkAodDiagnostics.overlayVisible = false
  }

  private fun dp(value: Int) =
    (value * resources.displayMetrics.density).roundToInt()

  private fun sp(value: Int) =
    value * resources.displayMetrics.scaledDensity

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
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
        overlay = null
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
    @Volatile private var instance: DaymarkAodAccessibilityService? = null

    fun snapshotChanged() {
      instance?.handler?.post {
        if (instance?.isDozing() == true) instance?.updateOverlay()
      }
    }
  }
}

class DaymarkGlucoseDisplayModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DaymarkGlucoseDisplay")

    AsyncFunction("getStatusAsync") Coroutine { ->
      status(requireNotNull(appContext.reactContext))
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
              "daymark_glucose_companion",
              CapabilityClient.FILTER_REACHABLE,
            ),
            5,
            TimeUnit.SECONDS,
          )
        val snapshot = DaymarkGlucoseDisplayState.snapshot(context)
        var republishAttempted = false
        var republishSucceeded = false
        var republishError: String? = null
        if (capability.nodes.isNotEmpty() && snapshot != null) {
          republishAttempted = true
          try {
            Tasks.await(
              DaymarkWearSync.publish(
                context,
                snapshot,
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
        mapOf(
          "supported" to true,
          "querySucceeded" to true,
          "pairedWatchCount" to connectedNodes.size,
          "companionWatchCount" to capability.nodes.size,
          "companionAvailable" to capability.nodes.isNotEmpty(),
          "watchNames" to capability.nodes.map { it.displayName }.sorted(),
          "latestReadingAvailable" to (snapshot != null),
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
      DaymarkGlucoseWidget.status(requireNotNull(appContext.reactContext))
    }

    AsyncFunction("requestPinHomeWidgetAsync") Coroutine { ->
      DaymarkGlucoseWidget.requestPin(requireNotNull(appContext.reactContext))
    }

    AsyncFunction("enableAsync") Coroutine { showOnLockScreen: Boolean ->
      val context = requireNotNull(appContext.reactContext)
      DaymarkGlucoseDisplayState.setLockScreenVisible(context, showOnLockScreen)
      DaymarkGlucoseDisplayState.setEnabled(context, true)
      DaymarkGlucoseDisplayService.ensureRunning(context)
      status(context)
    }

    AsyncFunction("disableAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      DaymarkGlucoseDisplayState.setEnabled(context, false)
      DaymarkGlucoseDisplayState.setAodDesired(context, false)
      DaymarkGlucoseDisplayService.stop(context)
      status(context)
    }

    AsyncFunction("setLockScreenVisibleAsync") Coroutine { visible: Boolean ->
      val context = requireNotNull(appContext.reactContext)
      DaymarkGlucoseDisplayState.setLockScreenVisible(context, visible)
      DaymarkGlucoseNotification.notify(context)
      status(context)
    }

    AsyncFunction("setAodDesiredAsync") Coroutine { desired: Boolean ->
      val context = requireNotNull(appContext.reactContext)
      DaymarkGlucoseDisplayState.setAodDesired(context, desired)
      DaymarkAodAccessibilityService.snapshotChanged()
      status(context)
    }

    AsyncFunction("setAodPositionAsync") Coroutine { position: String ->
      val context = requireNotNull(appContext.reactContext)
      DaymarkGlucoseDisplayState.setAodPosition(context, position)
      DaymarkAodAccessibilityService.snapshotChanged()
      status(context)
    }

    AsyncFunction("setAodSizeAsync") Coroutine { size: String ->
      val context = requireNotNull(appContext.reactContext)
      DaymarkGlucoseDisplayState.setAodSize(context, size)
      DaymarkAodAccessibilityService.snapshotChanged()
      status(context)
    }

    AsyncFunction("setAndroidAutoEnabledAsync") Coroutine { enabled: Boolean ->
      val context = requireNotNull(appContext.reactContext)
      DaymarkGlucoseDisplayState.setAndroidAutoEnabled(context, enabled)
      DaymarkAndroidAuto.settingChanged(context)
      status(context)
    }

    AsyncFunction("getAppearanceSettingsAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      DaymarkGlucoseDisplayState.appearance(context).asMap()
    }

    AsyncFunction("setAppearanceSettingsAsync") Coroutine {
        settings: Map<String, Any?>,
      ->
      val context = requireNotNull(appContext.reactContext)
      val appearance = appearanceFromMap(settings)
      DaymarkGlucoseDisplayState.setAppearance(context, appearance)
      if (DaymarkGlucoseDisplayState.enabled(context)) {
        DaymarkGlucoseNotification.notify(context)
      }
      DaymarkGlucoseDisplayState.snapshot(context)?.let {
        DaymarkWearSync.publish(context, it)
      }
      runCatching {
        Tasks.await(
          DaymarkWearSync.publishHistory(context, DaymarkWearSync.history()),
        )
      }
      DaymarkGlucoseWidget.updateAll(context)
      DaymarkAodAccessibilityService.snapshotChanged()
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
      require(mmolL in 0.5..40.0) { "Glucose value is outside the displayable range." }
      require(timestampMs.isFinite() && timestampMs > 0) {
        "Glucose timestamp is invalid."
      }
      require(trendOrigin in setOf("source", "calculated", "unavailable")) {
        "Glucose trend origin is invalid."
      }
      val context = requireNotNull(appContext.reactContext)
      DaymarkGlucoseDisplayState.setSnapshot(
        context,
        GlucoseDisplaySnapshot(
          mmolL = mmolL,
          trend = trend,
          trendOrigin = trendOrigin,
          timestampMs = timestampMs.toLong(),
          sourceLabel = sourceLabel.take(80),
          sourceHasError = sourceHasError,
        ).also { DaymarkWearSync.publish(context, it) },
      )
      DaymarkAndroidAuto.refresh(context)
      if (DaymarkGlucoseDisplayState.enabled(context)) {
        DaymarkGlucoseDisplayService.ensureRunning(context)
        DaymarkGlucoseNotification.notify(context)
      }
      DaymarkGlucoseWidget.updateAll(context)
      status(context)
    }

    AsyncFunction("updateMissingAsync") Coroutine { sourceLabel: String ->
      sourceLabel.length
      val context = requireNotNull(appContext.reactContext)
      DaymarkGlucoseDisplayState.clearSnapshot(context)
      DaymarkWearSync.publishMissing(context, sourceLabel)
      DaymarkAndroidAuto.refresh(context)
      DaymarkGlucoseNotification.notify(context)
      DaymarkGlucoseWidget.updateAll(context)
      status(context)
    }

    AsyncFunction("updateHistoryAsync") Coroutine {
        readings: List<Map<String, Any?>>,
      ->
      val context = requireNotNull(appContext.reactContext)
      val history =
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
      // A phone without Wearable Play Services, or a temporarily disconnected
      // watch, must not turn a successful glucose refresh into a failed
      // background job. The latest phone snapshot remains authoritative and
      // the next successful watch connection will publish history again.
      val published =
        runCatching {
          Tasks.await(DaymarkWearSync.publishHistory(context, history))
          true
        }.getOrDefault(false)
      DaymarkAndroidAuto.refresh(context)
      if (DaymarkGlucoseDisplayState.enabled(context)) {
        DaymarkGlucoseNotification.notify(context)
      }
      published
    }

    AsyncFunction("showGlucoseAlertAsync") Coroutine {
        kind: String,
        mmolL: Double,
        trend: String,
        timestampMs: Double,
      ->
      DaymarkGlucoseAlertNotification.show(
        requireNotNull(appContext.reactContext),
        kind,
        mmolL,
        trend,
        timestampMs.toLong(),
      )
    }

    AsyncFunction("cancelGlucoseAlertsAsync") Coroutine { ->
      DaymarkGlucoseAlertNotification.cancelAll(
        requireNotNull(appContext.reactContext)
      )
      true
    }

    AsyncFunction("glucoseAlertsAllowedAsync") Coroutine { ->
      DaymarkGlucoseAlertNotification.allowed(
        requireNotNull(appContext.reactContext)
      )
    }

    AsyncFunction("openGlucoseAlertSettingsAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      DaymarkGlucoseAlertNotification.ensureChannel(context)
      val intent =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).apply {
            putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            putExtra(Settings.EXTRA_CHANNEL_ID, ALERT_CHANNEL_ID)
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

    AsyncFunction("openNotificationSettingsAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      DaymarkGlucoseNotification.ensureChannel(context)
      val intent =
        Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).apply {
          putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
          putExtra(Settings.EXTRA_CHANNEL_ID, CHANNEL_ID)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
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
      DaymarkReviewNotification.show(requireNotNull(appContext.reactContext))
    }

    AsyncFunction("cancelReviewReadyNotificationAsync") Coroutine { ->
      DaymarkReviewNotification.cancel(requireNotNull(appContext.reactContext))
      true
    }

    AsyncFunction("showGlookoSignInRequiredAsync") Coroutine { ->
      DaymarkConnectorNotification.showGlookoSignInRequired(
        requireNotNull(appContext.reactContext)
      )
    }

    AsyncFunction("cancelGlookoSignInRequiredAsync") Coroutine { ->
      DaymarkConnectorNotification.cancelGlookoSignInRequired(
        requireNotNull(appContext.reactContext)
      )
      true
    }

    AsyncFunction("reviewNotificationsAllowedAsync") Coroutine { ->
      DaymarkReviewNotification.allowed(requireNotNull(appContext.reactContext))
    }

    AsyncFunction("openReviewNotificationSettingsAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      DaymarkReviewNotification.ensureChannel(context)
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
    val snapshot = DaymarkGlucoseDisplayState.snapshot(context)
    return mapOf(
      "supported" to true,
      "enabled" to DaymarkGlucoseDisplayState.enabled(context),
      "notificationsAllowed" to DaymarkGlucoseNotification.notificationsAllowed(context),
      "lockScreenVisible" to DaymarkGlucoseDisplayState.lockScreenVisible(context),
      "serviceRunning" to DaymarkGlucoseDisplayService.running,
      "aodDesired" to DaymarkGlucoseDisplayState.aodDesired(context),
      "aodPosition" to DaymarkGlucoseDisplayState.aodPosition(context),
      "aodSize" to DaymarkGlucoseDisplayState.aodSize(context),
      "aodServiceEnabled" to isAccessibilityServiceEnabled(context),
      "aodOverlayVisible" to DaymarkAodDiagnostics.overlayVisible,
      "androidAutoEnabled" to DaymarkGlucoseDisplayState.androidAutoEnabled(context),
      "androidAutoProjected" to DaymarkAndroidAuto.isProjected(),
      "aodLastEvent" to DaymarkAodDiagnostics.lastEvent(context),
      "aodLastError" to DaymarkAodDiagnostics.lastError(context),
      "latestMmolL" to snapshot?.mmolL,
      "latestTimestamp" to snapshot?.timestampMs?.toDouble(),
      "freshness" to DaymarkGlucoseDisplayState.freshness(context).wireValue,
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
      "Glucose boundaries must be between 1.0 and 30.0 mmol/L."
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
    val expected = ComponentName(context, DaymarkAodAccessibilityService::class.java)
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
