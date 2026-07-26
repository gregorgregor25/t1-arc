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
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.Icon
import android.hardware.display.DisplayManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.Display
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.roundToInt

private const val PREFERENCES_NAME = "daymark_glucose_display"
private const val ENABLED_KEY = "enabled"
private const val LOCK_SCREEN_VISIBLE_KEY = "lock_screen_visible"
private const val AOD_DESIRED_KEY = "aod_desired"
private const val CHANNEL_ID = "daymark_current_glucose_prominent_v2"
private const val LEGACY_CHANNEL_ID = "daymark_current_glucose_v1"
private const val NOTIFICATION_ID = 6417
private const val HEADLESS_TASK_KEY = "DaymarkLibreForegroundSync"
private const val REFRESH_INTERVAL_MS = 60_000L
private const val HEADLESS_TIMEOUT_MS = 55_000L
private const val CURRENT_AFTER_MS = 6 * 60_000L
private const val STALE_AFTER_MS = 12 * 60_000L
private const val LONDON_TIME_ZONE = "Europe/London"

private data class GlucoseDisplaySnapshot(
  val mmolL: Double,
  val trend: String,
  val timestampMs: Long,
  val sourceLabel: String,
  val sourceHasError: Boolean,
)

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

  fun freshness(now: Long = System.currentTimeMillis()): DisplayFreshness {
    val value = snapshot ?: return DisplayFreshness.MISSING
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
    val snapshot = DaymarkGlucoseDisplayState.snapshot
    val now = System.currentTimeMillis()
    val freshness = DaymarkGlucoseDisplayState.freshness(now)
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
      .setColor(Color.rgb(8, 127, 153))
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
  private var overlay: View? = null
  private var burnInStep = 0
  private var receiverRegistered = false
  private val refreshRunnable =
    object : Runnable {
      override fun run() {
        refreshOverlay()
        handler.postDelayed(this, REFRESH_INTERVAL_MS)
      }
    }

  private val displayListener =
    object : DisplayManager.DisplayListener {
      override fun onDisplayAdded(displayId: Int) = Unit
      override fun onDisplayRemoved(displayId: Int) = Unit
      override fun onDisplayChanged(displayId: Int) {
        if (displayId == Display.DEFAULT_DISPLAY) refreshOverlay()
      }
    }

  private val screenReceiver =
    object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
        if (
          intent?.action == Intent.ACTION_SCREEN_ON ||
            intent?.action == Intent.ACTION_SCREEN_OFF
        ) {
          handler.postDelayed({ refreshOverlay() }, 350L)
        }
      }
    }

  override fun onServiceConnected() {
    super.onServiceConnected()
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
    handler.postDelayed({ refreshOverlay() }, 600L)
    handler.post(refreshRunnable)
  }

  private fun isDozing(): Boolean {
    if (powerManager.isInteractive) return false
    val state = displayManager.getDisplay(Display.DEFAULT_DISPLAY)?.state
    return state == Display.STATE_OFF ||
      state == Display.STATE_DOZE ||
      state == Display.STATE_DOZE_SUSPEND
  }

  fun refreshOverlay() {
    handler.removeCallbacks(refreshRunnable)
    removeOverlay()
    val snapshot = DaymarkGlucoseDisplayState.snapshot
    if (
      !DaymarkGlucoseDisplayState.aodDesired(this) ||
        !DaymarkGlucoseDisplayState.enabled(this) ||
        !isDozing() ||
        snapshot == null
    ) {
      return
    }

    val freshness = DaymarkGlucoseDisplayState.freshness()
    val (arrow, _) =
      when (snapshot.trend) {
        "doubleDown" -> "⇊" to ""
        "down" -> "↓" to ""
        "slightDown" -> "↘" to ""
        "flat" -> "→" to ""
        "slightUp" -> "↗" to ""
        "up" -> "↑" to ""
        "doubleUp" -> "⇈" to ""
        else -> "?" to ""
      }
    val value = String.format(Locale.UK, "%.1f", snapshot.mmolL)
    val ageMinutes =
      floor(max(0L, System.currentTimeMillis() - snapshot.timestampMs) / 60_000.0)
        .toInt()
    val tone =
      when (freshness) {
        DisplayFreshness.CURRENT -> Color.rgb(101, 210, 231)
        DisplayFreshness.DELAYED -> Color.rgb(241, 182, 111)
        DisplayFreshness.STALE, DisplayFreshness.MISSING -> Color.rgb(255, 155, 174)
      }
    val panel =
      LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setPadding(dp(14), dp(8), dp(14), dp(8))
        background =
          GradientDrawable().apply {
            setColor(Color.argb(25, 0, 0, 0))
            cornerRadius = dp(16).toFloat()
          }
        addView(
          TextView(this@DaymarkAodAccessibilityService).apply {
            text = "$value  $arrow"
            setTextColor(tone)
            textSize = 34f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            gravity = Gravity.CENTER
          }
        )
        addView(
          TextView(this@DaymarkAodAccessibilityService).apply {
            text =
              "${freshness.label.uppercase(Locale.UK)} · " +
                if (ageMinutes == 0) "JUST NOW" else "$ageMinutes MIN AGO"
            setTextColor(Color.rgb(205, 222, 226))
            textSize = 11f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            letterSpacing = 0.08f
            gravity = Gravity.CENTER
          }
        )
      }

    val offsets =
      arrayOf(
        -8 to -5,
        -3 to 4,
        5 to -7,
        8 to 3,
        1 to 8,
        -7 to 2,
      )
    val offset = offsets[burnInStep % offsets.size]
    burnInStep += 1
    val params =
      WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
          WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
          WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT,
      ).apply {
        gravity = Gravity.CENTER
        x = dp(offset.first)
        y = dp(72 + offset.second)
      }
    try {
      windowManager.addView(panel, params)
      overlay = panel
    } catch (_: Exception) {
      overlay = null
    } finally {
      handler.postDelayed(refreshRunnable, REFRESH_INTERVAL_MS)
    }
  }

  private fun removeOverlay() {
    overlay?.let { view ->
      try {
        windowManager.removeView(view)
      } catch (_: Exception) {
        // The display can remove accessibility overlays during state changes.
      }
    }
    overlay = null
  }

  private fun dp(value: Int) =
    (value * resources.displayMetrics.density).roundToInt()

  override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

  override fun onInterrupt() {
    removeOverlay()
  }

  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    removeOverlay()
    if (this::displayManager.isInitialized) {
      displayManager.unregisterDisplayListener(displayListener)
    }
    if (receiverRegistered) {
      try {
        unregisterReceiver(screenReceiver)
      } catch (_: Exception) {
        // Already released by the system.
      }
    }
    if (instance === this) instance = null
    super.onDestroy()
  }

  companion object {
    @Volatile private var instance: DaymarkAodAccessibilityService? = null

    fun snapshotChanged() {
      instance?.handler?.post { instance?.refreshOverlay() }
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
      DaymarkGlucoseDisplayState.snapshot = null
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
      DaymarkGlucoseDisplayState.snapshot =
        GlucoseDisplaySnapshot(
          mmolL = mmolL,
          trend = trend,
          timestampMs = timestampMs.toLong(),
          sourceLabel = sourceLabel.take(80),
          sourceHasError = sourceHasError,
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
      DaymarkGlucoseDisplayState.snapshot = null
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
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
      )
      true
    }
  }

  private fun status(context: Context): Map<String, Any?> {
    val snapshot = DaymarkGlucoseDisplayState.snapshot
    return mapOf(
      "supported" to true,
      "enabled" to DaymarkGlucoseDisplayState.enabled(context),
      "notificationsAllowed" to DaymarkGlucoseNotification.notificationsAllowed(context),
      "lockScreenVisible" to DaymarkGlucoseDisplayState.lockScreenVisible(context),
      "serviceRunning" to DaymarkGlucoseDisplayService.running,
      "aodDesired" to DaymarkGlucoseDisplayState.aodDesired(context),
      "aodServiceEnabled" to isAccessibilityServiceEnabled(context),
      "latestMmolL" to snapshot?.mmolL,
      "latestTimestamp" to snapshot?.timestampMs?.toDouble(),
      "freshness" to DaymarkGlucoseDisplayState.freshness().wireValue,
    )
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
