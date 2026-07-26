package app.daymark.glucosedisplay

import android.Manifest
import android.accessibilityservice.AccessibilityService
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
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
import android.util.Base64
import android.view.Display
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.widget.ImageView
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.text.SimpleDateFormat
import java.security.KeyStore
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.roundToInt

private const val PREFERENCES_NAME = "daymark_glucose_display"
private const val ENABLED_KEY = "enabled"
private const val LOCK_SCREEN_VISIBLE_KEY = "lock_screen_visible"
private const val AOD_DESIRED_KEY = "aod_desired"
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
private const val HEADLESS_TASK_KEY = "DaymarkLibreForegroundSync"
private const val REFRESH_INTERVAL_MS = 60_000L
private const val HEADLESS_TIMEOUT_MS = 55_000L
private const val CURRENT_AFTER_MS = 6 * 60_000L
private const val STALE_AFTER_MS = 12 * 60_000L
private const val LONDON_TIME_ZONE = "Europe/London"

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

private data class GlucoseAppearance(
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
}

private data class GlucoseDisplaySnapshot(
  val mmolL: Double,
  val trend: String,
  val timestampMs: Long,
  val sourceLabel: String,
  val sourceHasError: Boolean,
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
        timestampMs = json.getLong("timestampMs"),
        sourceLabel = json.optString("sourceLabel", "Saved glucose"),
        sourceHasError = json.optBoolean("sourceHasError", false),
      )
    } catch (_: Exception) {
      null
    }
  }
}

private enum class DisplayFreshness(val wireValue: String, val label: String) {
  CURRENT("current", "Current"),
  DELAYED("delayed", "Delayed"),
  STALE("stale", "Stale"),
  MISSING("missing", "Missing"),
}

private object DaymarkGlucoseDisplayState {
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
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: return null
    launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context,
      0,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun valueIcon(context: Context, snapshot: GlucoseDisplaySnapshot?): Icon {
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
      canvas.drawText(text, bitmap.width / 2f, bitmap.height / 2f - bounds.exactCenterY(), paint)
      Icon.createWithBitmap(bitmap)
    } catch (_: Exception) {
      Icon.createWithResource(context, R.drawable.daymark_notification_pulse)
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
      .setContentTitle("Daymark glucose")
      .setContentText("${freshness.label} reading available")
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
          .setContentText("Daymark is checking your saved LibreLinkUp connection.")
          .setStyle(
            Notification.BigTextStyle().bigText(
              "Daymark is checking your saved LibreLinkUp connection. The notification will update when a reading is available."
            )
          )
          .setShowWhen(false)
      } else {
        val (arrow, direction) = trendPresentation(snapshot.trend)
        val value = String.format(Locale.UK, "%.1f", snapshot.mmolL)
        val status = "${freshness.label} · ${ageCopy(snapshot.timestampMs, now)}"
        builder(context)
          .setSmallIcon(valueIcon(context, snapshot))
          .setContentTitle("$value mmol/L  $arrow")
          .setContentText("$direction · $status")
          .setSubText(snapshot.sourceLabel)
          .setStyle(
            Notification.BigTextStyle().bigText(
              "$value mmol/L $arrow · $direction\n$status · reading at ${formatTime(snapshot.timestampMs)}\nTap to inspect the underlying glucose history. Not for dosing decisions."
            )
          )
          .setShowWhen(true)
          .setWhen(snapshot.timestampMs)
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
    DaymarkAodAccessibilityService.snapshotChanged()
  }

  fun cancel(context: Context) {
    context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
    DaymarkAodAccessibilityService.snapshotChanged()
  }
}

class DaymarkGlucoseDisplayService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private val renderRunnable =
    object : Runnable {
      override fun run() {
        if (!DaymarkGlucoseDisplayState.enabled(this@DaymarkGlucoseDisplayService)) return
        DaymarkGlucoseNotification.notify(this@DaymarkGlucoseDisplayService)
        handler.postDelayed(this, REFRESH_INTERVAL_MS)
      }
    }
  private val syncRunnable =
    object : Runnable {
      override fun run() {
        if (!DaymarkGlucoseDisplayState.enabled(this@DaymarkGlucoseDisplayService)) return
        requestHeadlessSync()
        handler.postDelayed(this, REFRESH_INTERVAL_MS)
      }
    }

  override fun onCreate() {
    super.onCreate()
    running = true
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
        // Android can defer foreground starts. Opening Daymark resumes the service.
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
  private var overlay: View? = null
  private var pendingOverlayRunnable: Runnable? = null
  private var receiverRegistered = false
  private var initialized = false
  private var yOffset = 0
  private var yOffsetDirection = 1

  private val minuteRefreshRunnable =
    Runnable {
      if (isDozing()) removeAndCreateOverlay()
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
      "Daymark service connected · lock your Pixel to test",
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
        if (isDozing()) removeAndCreateOverlay()
        else removeOverlay()
      }
    pendingOverlayRunnable = runnable
    handler.postDelayed(runnable, delayMillis)
  }

  private fun removeAndCreateOverlay() {
    removeOverlay(cancelRefresh = false)
    createOverlay()
  }

  private fun createOverlay() {
    handler.removeCallbacks(minuteRefreshRunnable)
    val snapshot = DaymarkGlucoseDisplayState.snapshot(this)
    if (
      !DaymarkGlucoseDisplayState.aodDesired(this) ||
        !DaymarkGlucoseDisplayState.enabled(this) ||
        !isDozing() ||
        snapshot == null
    ) {
      return
    }

    try {
      val bitmap = renderBitmap(snapshot)
      val image =
        ImageView(this).apply {
          setImageBitmap(bitmap)
          contentDescription = null
          importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }
      val screenBounds =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          windowManager.currentWindowMetrics.bounds
        } else {
          @Suppress("DEPRECATION")
          Rect().also { windowManager.defaultDisplay.getRectSize(it) }
        }
      val burnIn = nextBurnInOffset()
      val x = max(0, ((screenBounds.width() - bitmap.width) * 0.5f).roundToInt() + burnIn)
      val y = max(0, ((screenBounds.height() - bitmap.height) * 0.72f).roundToInt() + burnIn)
      val params =
        WindowManager.LayoutParams().apply {
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
      windowManager.addView(image, params)
      overlay = image
      DaymarkAodDiagnostics.overlayVisible = true
      DaymarkAodDiagnostics.recordEvent(
        this,
        "Always-on glucose rendered successfully",
      )
      handler.postDelayed(minuteRefreshRunnable, REFRESH_INTERVAL_MS)
    } catch (error: Exception) {
      overlay = null
      DaymarkAodDiagnostics.overlayVisible = false
      DaymarkAodDiagnostics.recordError(
        this,
        "${error.javaClass.simpleName}: ${error.message ?: "overlay could not be added"}",
      )
    }
  }

  private fun renderBitmap(snapshot: GlucoseDisplaySnapshot): Bitmap {
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
    val status = "${freshness.label.uppercase(Locale.UK)} · $age"
    val width = dp(248)
    val height = dp(104)
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val valuePaint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = tone
        textAlign = Paint.Align.CENTER
        textSize = sp(36)
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      }
    val statusPaint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(205, 222, 226)
        textAlign = Paint.Align.CENTER
        textSize = sp(11)
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        letterSpacing = 0.08f
      }
    val unitPaint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(169, 189, 194)
        textAlign = Paint.Align.CENTER
        textSize = sp(9)
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      }
    canvas.drawText("$value  $arrow", width / 2f, dp(45).toFloat(), valuePaint)
    canvas.drawText("mmol/L", width / 2f, dp(65).toFloat(), unitPaint)
    canvas.drawText(status, width / 2f, dp(88).toFloat(), statusPaint)
    return bitmap
  }

  private fun nextBurnInOffset(): Int {
    if (abs(yOffset) >= 10) yOffsetDirection *= -1
    yOffset += yOffsetDirection
    return yOffset
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
      checkAndCreateOverlay(150L)
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
        if (instance?.isDozing() == true) instance?.removeAndCreateOverlay()
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
      DaymarkAodAccessibilityService.snapshotChanged()
      appearance.asMap()
    }

    AsyncFunction("updateReadingAsync") Coroutine {
        mmolL: Double,
        trend: String,
        timestampMs: Double,
        sourceLabel: String,
        sourceHasError: Boolean,
      ->
      require(mmolL in 0.5..40.0) { "Glucose value is outside the displayable range." }
      require(timestampMs.isFinite() && timestampMs > 0) {
        "Glucose timestamp is invalid."
      }
      val context = requireNotNull(appContext.reactContext)
      DaymarkGlucoseDisplayState.setSnapshot(
        context,
        GlucoseDisplaySnapshot(
          mmolL = mmolL,
          trend = trend,
          timestampMs = timestampMs.toLong(),
          sourceLabel = sourceLabel.take(80),
          sourceHasError = sourceHasError,
        ),
      )
      if (DaymarkGlucoseDisplayState.enabled(context)) {
        DaymarkGlucoseDisplayService.ensureRunning(context)
        DaymarkGlucoseNotification.notify(context)
      }
      status(context)
    }

    AsyncFunction("updateMissingAsync") Coroutine { sourceLabel: String ->
      sourceLabel.length
      val context = requireNotNull(appContext.reactContext)
      DaymarkGlucoseDisplayState.clearSnapshot(context)
      DaymarkGlucoseNotification.notify(context)
      status(context)
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
      "aodServiceEnabled" to isAccessibilityServiceEnabled(context),
      "aodOverlayVisible" to DaymarkAodDiagnostics.overlayVisible,
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
