package app.daymark.glucosedisplay

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Bundle
import android.os.Process
import android.util.Log
import androidx.car.app.connection.CarConnection
import androidx.car.app.notification.CarAppExtender
import androidx.car.app.notification.CarNotificationManager
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.lifecycle.Observer
import androidx.media.MediaBrowserServiceCompat
import androidx.media.MediaSessionManager
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import java.util.Locale
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

private const val CAR_LOG_TAG = "T1ArcAndroidAuto"
private const val CAR_MEDIA_ROOT_ID = "t1arc_root"
private const val CAR_GLUCOSE_SECTION_ID = "t1arc_glucose"
private const val CAR_GLUCOSE_MEDIA_ID = "t1arc_current_glucose"
private const val CAR_NOTIFICATION_CHANNEL_ID = "t1arc_android_auto_glucose_v1"
private const val CAR_NOTIFICATION_ID = 6450
private const val CAR_NOTIFICATION_REPLY_ACTION =
  "app.daymark.glucosedisplay.action.REFRESH_CAR_GLUCOSE"
private const val CAR_NOTIFICATION_DISMISS_ACTION =
  "app.daymark.glucosedisplay.action.DISMISS_CAR_GLUCOSE"
private const val CAR_NOTIFICATION_REPLY_KEY = "t1arc_car_reply"
private const val THREE_HOURS_MS = 3 * 60 * 60 * 1000L

/**
 * Glucose is private media metadata. Keeping this decision pure makes it hard
 * for a future lifecycle change to expose the last reading outside a live,
 * user-enabled Android Auto projection.
 */
internal fun shouldExposeAndroidAutoGlucose(enabled: Boolean, projected: Boolean): Boolean =
  enabled && projected

/**
 * The Android Auto surface deliberately lives inside the phone app. It reads
 * the same encrypted snapshot and normalised history as notification, widget
 * and Wear OS, avoiding a second installation and cross-app health broadcasts.
 */
internal object DaymarkAndroidAuto {
  @Volatile private var initialized = false
  @Volatile private var projected = false
  @Volatile private var appContext: Context? = null

  private val connectionObserver =
    Observer<Int> { type ->
      val connected = type == CarConnection.CONNECTION_TYPE_PROJECTION
      if (connected == projected) return@Observer
      projected = connected
      Log.i(
        CAR_LOG_TAG,
        if (connected) "Android Auto projection connected" else "Android Auto projection disconnected",
      )
      val context = appContext
      val available = connected && context?.let(DaymarkGlucoseDisplayState::androidAutoEnabled) == true
      DaymarkCarMediaBrowserService.connectionChanged(available)
      context?.let { DaymarkCarNotification.connectionChanged(it, available) }
    }

  fun initialize(context: Context) {
    if (initialized) return
    synchronized(this) {
      if (initialized) return
      appContext = context.applicationContext
      initialized = true
      CarConnection(context.applicationContext).type.observeForever(connectionObserver)
    }
  }

  fun refresh(context: Context) {
    initialize(context)
    if (!DaymarkGlucoseDisplayState.androidAutoEnabled(context)) {
      DaymarkCarMediaBrowserService.connectionChanged(false)
      DaymarkCarNotification.cancel(context.applicationContext)
      return
    }
    DaymarkCarMediaBrowserService.refresh()
    if (projected) DaymarkCarNotification.show(context.applicationContext)
  }

  fun settingChanged(context: Context) {
    initialize(context)
    val available = projected && DaymarkGlucoseDisplayState.androidAutoEnabled(context)
    DaymarkCarMediaBrowserService.connectionChanged(available)
    DaymarkCarNotification.connectionChanged(context.applicationContext, available)
  }

  fun isProjected(): Boolean = projected
}

class DaymarkCarMediaBrowserService : MediaBrowserServiceCompat() {
  private lateinit var session: MediaSessionCompat

  override fun onCreate() {
    super.onCreate()
    instance = this
    DaymarkAndroidAuto.initialize(this)
    session =
      MediaSessionCompat(this, "T1 Arc Android Auto").apply {
        setCallback(
          object : MediaSessionCompat.Callback() {
            override fun onPlay() = openFullScreen()

            override fun onPlayFromMediaId(mediaId: String?, extras: Bundle?) {
              if (mediaId == CAR_GLUCOSE_MEDIA_ID) {
                openFullScreen()
              }
            }

            override fun onPause() = publish(PlaybackStateCompat.STATE_PAUSED)

            override fun onStop() = closeFullScreen()
          }
        )
        // MediaSessionCompat does not publish the session or reliably receive
        // transport commands until it is active. A stopped active session is
        // discoverable without taking audio focus or displacing the driver's
        // real media playback.
        isActive = true
      }
    sessionToken = session.sessionToken
    publish(PlaybackStateCompat.STATE_STOPPED)
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    session.release()
    super.onDestroy()
  }

  override fun onGetRoot(
    clientPackageName: String,
    clientUid: Int,
    rootHints: Bundle?,
  ): BrowserRoot? {
    if (!isTrustedMediaClient(clientPackageName, clientUid)) {
      Log.w(CAR_LOG_TAG, "Rejected untrusted media browser client $clientPackageName")
      return null
    }
    // Always return a root for a trusted host. Android Auto caches failed root
    // connections, so using the user's display preference here could leave the
    // app undiscoverable after they turn the feature on. Disabled state is
    // handled quickly and without exposing health data in onLoadChildren.
    return BrowserRoot(CAR_MEDIA_ROOT_ID, null)
  }

  override fun onLoadChildren(
    parentId: String,
    result: Result<MutableList<MediaBrowserCompat.MediaItem>>,
  ) {
    if (!DaymarkGlucoseDisplayState.androidAutoEnabled(this)) {
      result.sendResult(mutableListOf())
      return
    }
    when (parentId) {
      CAR_MEDIA_ROOT_ID -> {
        // Current Android Auto/AAOS hosts can advertise that root children must
        // be browsable (and older hosts commonly make the same assumption).
        // Nesting the live reading prevents our only item being silently
        // dropped from the car launcher.
        val description =
          MediaDescriptionCompat.Builder()
            .setMediaId(CAR_GLUCOSE_SECTION_ID)
            .setTitle(getString(R.string.daymark_android_auto_section_name))
            .setSubtitle(getString(R.string.daymark_android_auto_section_description))
            .setIconBitmap(DaymarkCarPresentation.sectionArt())
            .build()
        result.sendResult(
          mutableListOf(
            MediaBrowserCompat.MediaItem(
              description,
              MediaBrowserCompat.MediaItem.FLAG_BROWSABLE,
            )
          )
        )
      }
      CAR_GLUCOSE_SECTION_ID -> {
        val presentation = presentationForCurrentCarState()
        val description =
          MediaDescriptionCompat.Builder()
            .setMediaId(CAR_GLUCOSE_MEDIA_ID)
            .setTitle(presentation.title)
            .setSubtitle(presentation.subtitle)
            .setDescription(presentation.description)
            .setIconBitmap(presentation.art)
            .build()
        result.sendResult(
          mutableListOf(
            MediaBrowserCompat.MediaItem(
              description,
              MediaBrowserCompat.MediaItem.FLAG_PLAYABLE,
            )
          )
        )
      }
      else -> result.sendResult(mutableListOf())
    }
  }

  private fun isTrustedMediaClient(clientPackageName: String, clientUid: Int): Boolean {
    if (
      (clientPackageName == packageName && clientUid == Process.myUid()) ||
        clientUid == Process.SYSTEM_UID
    ) {
      return true
    }
    return runCatching {
      MediaSessionManager.getSessionManager(this)
        .isTrustedForMediaControl(
          MediaSessionManager.RemoteUserInfo(
            clientPackageName,
            MediaSessionManager.RemoteUserInfo.UNKNOWN_PID,
            clientUid,
          )
        )
    }.getOrDefault(false)
  }

  private fun publish(state: Int = currentState) {
    currentState = state
    val presentation = presentationForCurrentCarState()
    session.setMetadata(
      MediaMetadataCompat.Builder()
        .putString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID, CAR_GLUCOSE_MEDIA_ID)
        .putText(MediaMetadataCompat.METADATA_KEY_TITLE, presentation.title)
        .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, presentation.subtitle)
        .putText(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, presentation.title)
        .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, presentation.subtitle)
        .putBitmap(MediaMetadataCompat.METADATA_KEY_ART, presentation.art)
        .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, presentation.art)
        .putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, presentation.art)
        .build()
    )
    session.setPlaybackState(
      PlaybackStateCompat.Builder()
        .setActions(
          PlaybackStateCompat.ACTION_PLAY or
            PlaybackStateCompat.ACTION_PAUSE or
            PlaybackStateCompat.ACTION_STOP or
            PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID
        )
        .setState(state, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, 0f)
        .build()
    )
    notifyChildrenChanged(CAR_MEDIA_ROOT_ID)
    notifyChildrenChanged(CAR_GLUCOSE_SECTION_ID)
  }

  private fun openFullScreen() {
    if (!canExposeGlucose()) {
      closeFullScreen()
      return
    }
    // T1 Arc never requests audio focus or starts playback. Paused state keeps
    // the glucose artwork visible without pretending to be an audio source.
    publish(PlaybackStateCompat.STATE_PAUSED)
  }

  private fun closeFullScreen() {
    publish(PlaybackStateCompat.STATE_STOPPED)
  }

  private fun canExposeGlucose(): Boolean =
    shouldExposeAndroidAutoGlucose(
      enabled = DaymarkGlucoseDisplayState.androidAutoEnabled(this),
      projected = DaymarkAndroidAuto.isProjected(),
    )

  private fun presentationForCurrentCarState(): CarPresentation =
    if (canExposeGlucose()) {
      DaymarkCarPresentation.create(this)
    } else {
      DaymarkCarPresentation.privatePlaceholder()
    }

  companion object {
    @Volatile private var instance: DaymarkCarMediaBrowserService? = null
    @Volatile private var currentState = PlaybackStateCompat.STATE_PAUSED

    internal fun refresh() {
      instance?.publish()
    }

    internal fun connectionChanged(connected: Boolean) {
      if (connected) {
        instance?.publish(PlaybackStateCompat.STATE_STOPPED)
      } else {
        instance?.closeFullScreen()
      }
    }
  }
}

private data class CarPresentation(
  val title: CharSequence,
  val subtitle: String,
  val description: String,
  val art: Bitmap,
  val timestampMs: Long?,
)

private object DaymarkCarPresentation {
  fun privatePlaceholder() =
    CarPresentation(
      title = "T1 Arc",
      subtitle = "Connect Android Auto to view glucose",
      description = "Private glucose is hidden outside Android Auto",
      art = sectionArt(),
      timestampMs = null,
    )

  fun sectionArt(): Bitmap {
    val size = 192
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val path =
      Path().apply {
        moveTo(14f, 100f)
        lineTo(48f, 100f)
        lineTo(67f, 55f)
        lineTo(100f, 145f)
        lineTo(121f, 100f)
        lineTo(178f, 100f)
      }
    canvas.drawPath(
      path,
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        strokeWidth = 14f
      },
    )
    return bitmap
  }

  fun create(context: Context): CarPresentation {
    val snapshot = DaymarkGlucoseDisplayState.snapshot(context)
    if (snapshot == null) {
      return CarPresentation(
        title = "Glucose unavailable",
        subtitle = "Open T1 Arc on your phone",
        description = "T1 Arc glucose unavailable",
        art = renderArt(context, null),
        timestampMs = null,
      )
    }
    val arrow = trendArrow(snapshot.trend)
    val freshness = DaymarkGlucoseDisplayState.freshness(context)
    val value = String.format(Locale.UK, "%.1f", snapshot.mmolL)
    return CarPresentation(
      title = glucoseDisplayTitle(value, " mmol/L $arrow", freshness),
      subtitle =
        if (freshness == DisplayFreshness.STALE) {
          "Stale · last known · ${ageCopy(snapshot.timestampMs)}"
        } else {
          "${trendLabel(snapshot.trend)} · ${ageCopy(snapshot.timestampMs)}"
        },
      description =
        if (freshness == DisplayFreshness.STALE) {
          "T1 Arc last known stale glucose"
        } else {
          "T1 Arc current glucose"
        },
      art = renderArt(context, snapshot),
      timestampMs = snapshot.timestampMs,
    )
  }

  private fun renderArt(context: Context, snapshot: GlucoseDisplaySnapshot?): Bitmap {
    val size = 512
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(Color.rgb(3, 18, 22))
    val freshness = DaymarkGlucoseDisplayState.freshness(context)
    val tone = DaymarkGlucoseDisplayState.displayColor(context, snapshot, freshness)
    val titlePaint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(151, 184, 191)
        textAlign = Paint.Align.CENTER
        textSize = 34f
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        letterSpacing = 0.18f
      }
    val valuePaint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = tone
        textAlign = Paint.Align.CENTER
        textSize = 126f
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      }
    val detailPaint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(214, 229, 232)
        textAlign = Paint.Align.CENTER
        textSize = 32f
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      }
    canvas.drawText("T1 ARC", size / 2f, 64f, titlePaint)
    if (snapshot == null) {
      canvas.drawText("—", size / 2f, 245f, valuePaint)
      canvas.drawText("NO GLUCOSE", size / 2f, 305f, detailPaint)
    } else {
      val readingText =
        "${String.format(Locale.UK, "%.1f", snapshot.mmolL)} ${trendArrow(snapshot.trend)}"
      val readingBaseline = 235f
      canvas.drawText(
        readingText,
        size / 2f,
        readingBaseline,
        valuePaint,
      )
      if (freshness == DisplayFreshness.STALE) {
        val halfWidth = valuePaint.measureText(readingText) / 2f
        canvas.drawLine(
          size / 2f - halfWidth,
          readingBaseline - valuePaint.textSize * 0.31f,
          size / 2f + halfWidth,
          readingBaseline - valuePaint.textSize * 0.31f,
          Paint(valuePaint).apply {
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
            strokeWidth = 8f
          },
        )
      }
      canvas.drawText(
        if (freshness == DisplayFreshness.STALE) {
          "STALE · LAST KNOWN · ${ageCopy(snapshot.timestampMs).uppercase(Locale.UK)}"
        } else {
          "mmol/L · ${ageCopy(snapshot.timestampMs).uppercase(Locale.UK)}"
        },
        size / 2f,
        292f,
        detailPaint,
      )
    }
    drawHistory(context, canvas, RectF(40f, 335f, 472f, 470f))
    return bitmap
  }

  private fun drawHistory(context: Context, canvas: Canvas, bounds: RectF) {
    val since = System.currentTimeMillis() - THREE_HOURS_MS
    val points =
      DaymarkWearSync.history()
        .filter { it.timestampMs >= since }
        .sortedBy(GlucoseHistoryPoint::timestampMs)
    if (points.size < 2) return
    val minTime = points.first().timestampMs
    val maxTime = max(minTime + 1L, points.last().timestampMs)
    val minValue = min(2.2, points.minOf(GlucoseHistoryPoint::mmolL))
    val maxValue = max(13.9, points.maxOf(GlucoseHistoryPoint::mmolL))
    val fillPath = Path()
    points.forEachIndexed { index, point ->
      val x =
        bounds.left +
          ((point.timestampMs - minTime).toFloat() / (maxTime - minTime).toFloat()) *
            bounds.width()
      val y =
        bounds.bottom -
          ((point.mmolL - minValue).toFloat() / (maxValue - minValue).toFloat()) *
            bounds.height()
      if (index == 0) {
        fillPath.moveTo(x, bounds.bottom)
        fillPath.lineTo(x, y)
      } else {
        fillPath.lineTo(x, y)
      }
    }
    fillPath.lineTo(bounds.right, bounds.bottom)
    fillPath.close()
    canvas.drawPath(
      fillPath,
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(62, 71, 190, 209)
        style = Paint.Style.FILL
      },
    )
    val appearanceFreshness = DisplayFreshness.CURRENT
    for (index in 1 until points.size) {
      val from = points[index - 1]
      val to = points[index]
      val x1 =
        bounds.left +
          ((from.timestampMs - minTime).toFloat() / (maxTime - minTime).toFloat()) *
            bounds.width()
      val y1 =
        bounds.bottom -
          ((from.mmolL - minValue).toFloat() / (maxValue - minValue).toFloat()) *
            bounds.height()
      val x2 =
        bounds.left +
          ((to.timestampMs - minTime).toFloat() / (maxTime - minTime).toFloat()) *
            bounds.width()
      val y2 =
        bounds.bottom -
          ((to.mmolL - minValue).toFloat() / (maxValue - minValue).toFloat()) *
            bounds.height()
      canvas.drawLine(
        x1,
        y1,
        x2,
        y2,
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
          color = DaymarkGlucoseDisplayState.displayColor(context, snapshotFor(to), appearanceFreshness)
          strokeWidth = 7f
          strokeCap = Paint.Cap.ROUND
        },
      )
    }
  }

  private fun snapshotFor(point: GlucoseHistoryPoint) =
    GlucoseDisplaySnapshot(point.mmolL, "unknown", "unavailable", point.timestampMs, "History", false)

  private fun ageCopy(timestampMs: Long): String {
    val minutes =
      floor(max(0L, System.currentTimeMillis() - timestampMs) / 60_000.0).toInt()
    return when (minutes) {
      0 -> "just now"
      1 -> "1 min"
      in 2..59 -> "$minutes min"
      else -> "${minutes / 60} hr"
    }
  }

  private fun trendArrow(trend: String) =
    when (trend) {
      "doubleDown" -> "⇊"
      "down" -> "↓"
      "slightDown" -> "↘"
      "flat" -> "→"
      "slightUp" -> "↗"
      "up" -> "↑"
      "doubleUp" -> "⇈"
      else -> "?"
    }

  private fun trendLabel(trend: String) =
    when (trend) {
      "doubleDown" -> "Falling quickly"
      "down" -> "Falling"
      "slightDown" -> "Falling slowly"
      "flat" -> "Steady"
      "slightUp" -> "Rising slowly"
      "up" -> "Rising"
      "doubleUp" -> "Rising quickly"
      else -> "Direction unavailable"
    }
}

private object DaymarkCarNotification {
  @Volatile private var connected = false

  fun connectionChanged(context: Context, value: Boolean) {
    connected = value
    DaymarkCarMediaBrowserService.refresh()
    if (value) show(context) else cancel(context)
  }

  fun show(context: Context) {
    if (
      !connected ||
        !shouldExposeAndroidAutoGlucose(
          enabled = DaymarkGlucoseDisplayState.androidAutoEnabled(context),
          projected = DaymarkAndroidAuto.isProjected(),
        )
    ) {
      return
    }
    val presentation = DaymarkCarPresentation.create(context)
    val readingTime = presentation.timestampMs ?: System.currentTimeMillis()
    ensureChannel(context)
    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val contentIntent =
      launchIntent?.let {
        PendingIntent.getActivity(
          context,
          CAR_NOTIFICATION_ID,
          it.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
      }
    val dismissIntent =
      PendingIntent.getBroadcast(
        context,
        CAR_NOTIFICATION_ID + 1,
        Intent(context, DaymarkCarNotificationReceiver::class.java)
          .setAction(CAR_NOTIFICATION_DISMISS_ACTION),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    val replyIntent =
      PendingIntent.getBroadcast(
        context,
        CAR_NOTIFICATION_ID + 2,
        Intent(context, DaymarkCarNotificationReceiver::class.java)
          .setAction(CAR_NOTIFICATION_REPLY_ACTION),
        // Android Auto must add the voice RemoteInput result before sending.
        // The intent remains explicit and scoped to T1 Arc's private receiver.
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
      )
    val person = Person.Builder().setName(presentation.title).setImportant(true).build()
    val remoteInput =
      RemoteInput.Builder(CAR_NOTIFICATION_REPLY_KEY)
        .setLabel("Refresh glucose")
        .build()
    val refreshAction =
      NotificationCompat.Action.Builder(
        R.drawable.daymark_notification_pulse,
        "Refresh",
        replyIntent,
      )
        .addRemoteInput(remoteInput)
        .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
        .setShowsUserInterface(false)
        .build()
    val dismissAction =
      NotificationCompat.Action.Builder(
        R.drawable.daymark_notification_pulse,
        "Dismiss",
        dismissIntent,
      )
        .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
        .setShowsUserInterface(false)
        .build()
    val notification =
      NotificationCompat.Builder(context, CAR_NOTIFICATION_CHANNEL_ID)
        .setSmallIcon(R.drawable.daymark_notification_pulse)
        .setContentTitle(presentation.title)
        .setContentText(presentation.subtitle)
        .setStyle(
          NotificationCompat.MessagingStyle(person)
            .addMessage(presentation.subtitle, readingTime, person)
        )
        .setWhen(readingTime)
        .setShowWhen(true)
        .setCategory(NotificationCompat.CATEGORY_MESSAGE)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setOngoing(true)
        .setContentIntent(contentIntent)
        .setDeleteIntent(dismissIntent)
        .extend(CarAppExtender.Builder().setImportance(NotificationManager.IMPORTANCE_HIGH).build())
        .addInvisibleAction(refreshAction)
        .addInvisibleAction(dismissAction)
    CarNotificationManager.from(context).notify(CAR_NOTIFICATION_ID, notification)
  }

  fun cancel(context: Context) {
    connected = false
    CarNotificationManager.from(context).cancel(CAR_NOTIFICATION_ID)
  }

  private fun ensureChannel(context: Context) {
    context.getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(
        CAR_NOTIFICATION_CHANNEL_ID,
        "Android Auto glucose",
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        description = "Current T1 Arc glucose while Android Auto is connected"
        setSound(null, null)
        enableVibration(false)
      }
    )
  }
}

class DaymarkCarNotificationReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    when (intent?.action) {
      CAR_NOTIFICATION_REPLY_ACTION -> DaymarkCarNotification.show(context.applicationContext)
      CAR_NOTIFICATION_DISMISS_ACTION -> DaymarkCarNotification.cancel(context.applicationContext)
    }
  }
}
