package io.github.gregorgregor25.t1arc.glucosedisplay

import android.app.Notification
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
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.provider.Settings
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
import java.util.UUID
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

private const val CAR_LOG_TAG = "T1ArcAndroidAuto"
private const val CAR_MEDIA_ROOT_ID = "t1arc_root"
private const val CAR_GLUCOSE_SECTION_ID = "t1arc_glucose"
private const val CAR_GLUCOSE_MEDIA_ID = "t1arc_current_glucose"
// AndroidX represents a caller whose process is not known to the browser as -1.
// Keep the value local rather than reaching into its restricted library API.
private const val CAR_UNKNOWN_CALLER_PID = -1
private const val CAR_NOTIFICATION_ALERT_CHANNEL_ID = "t1arc_android_auto_glucose_v1"
private const val CAR_NOTIFICATION_QUIET_CHANNEL_ID = "t1arc_android_auto_glucose_quiet_v1"
private const val CAR_NOTIFICATION_ID = 6450
private const val CAR_NOTIFICATION_PERSON_KEY = "t1arc_glucose"
private const val CAR_NOTIFICATION_REPLY_ACTION =
  "io.github.gregorgregor25.t1arc.action.REFRESH_CAR_GLUCOSE"
private const val CAR_NOTIFICATION_DISMISS_ACTION =
  "io.github.gregorgregor25.t1arc.action.DISMISS_CAR_GLUCOSE"
private const val CAR_NOTIFICATION_REPLY_KEY = "t1arc_car_reply"
private const val CAR_NOTIFICATION_SESSION_TOKEN_EXTRA = "t1arc_car_session_token"
internal const val CAR_NOTIFICATION_SESSION_EXPIRY_MS = 12L * 60L * 60L * 1000L
internal const val CAR_NOTIFICATION_KEEPALIVE_INTERVAL_MS = 60_000L
private const val CAR_NOTIFICATION_CLOCK_DRIFT_TOLERANCE_MS = 5L * 60L * 1000L
private const val CAR_NOTIFICATION_POLICY_PREFS = "t1arc_car_notification_policy_v3"
private const val CAR_NOTIFICATION_POLICY_PRESENT = "present"
private const val CAR_NOTIFICATION_POLICY_POSTED = "posted"
private const val CAR_NOTIFICATION_POLICY_DISMISSED = "dismissed"
private const val CAR_NOTIFICATION_POLICY_SESSION_TOKEN = "session_token"
private const val CAR_NOTIFICATION_POLICY_ALERT_ELAPSED = "alert_elapsed"
private const val CAR_NOTIFICATION_POLICY_LAST_POST_ELAPSED = "last_post_elapsed"
private const val CAR_NOTIFICATION_POLICY_MESSAGE_EVENT_WALL = "message_event_wall"
private const val CAR_NOTIFICATION_POLICY_SAVED_ELAPSED = "saved_elapsed"
private const val CAR_NOTIFICATION_POLICY_SAVED_WALL = "saved_wall"
private const val CAR_NOTIFICATION_POLICY_BOOT_SESSION = "boot_session"
private const val CAR_NOTIFICATION_NULL_ELAPSED_TIME = Long.MIN_VALUE
private const val CAR_NOTIFICATION_PUBLIC_TITLE = "T1 Arc"
private const val CAR_NOTIFICATION_PUBLIC_TEXT = "Private update hidden while your phone is locked"
private const val THREE_HOURS_MS = 3 * 60 * 60 * 1000L

/**
 * Glucose is private media metadata. Keeping this decision pure makes it hard
 * for a future lifecycle change to expose the last reading outside a live,
 * user-enabled Android Auto projection.
 */
internal fun shouldExposeAndroidAutoGlucose(enabled: Boolean, projected: Boolean): Boolean =
  enabled && projected

internal data class CarNotificationHistoryPointIdentity(
  val timestampMs: Long,
  val valueBits: Long,
)

internal data class CarNotificationContentIdentity(
  val available: Boolean,
  val readingTimestampMs: Long? = null,
  val valueBits: Long? = null,
  val trend: String? = null,
  val trendOrigin: String? = null,
  val sourceLabel: String? = null,
  val sourceHasError: Boolean? = null,
  val history: List<CarNotificationHistoryPointIdentity> = emptyList(),
)

internal data class CarNotificationSessionState(
  val connected: Boolean = false,
  val sessionToken: String? = null,
  val notificationPosted: Boolean = false,
  val dismissedForSession: Boolean = false,
  val lastPresentedReadingTimestampMs: Long? = null,
  val lastPresentedContentIdentity: CarNotificationContentIdentity? = null,
  val lastAlertElapsedRealtimeMs: Long? = null,
  val lastPostElapsedRealtimeMs: Long? = null,
  val messageEventWallClockMs: Long? = null,
)

internal data class CarNotificationConnectionTransition(
  val state: CarNotificationSessionState,
  val freshProjectionSession: Boolean,
)

internal data class CarNotificationPostDecision(
  val shouldNotify: Boolean,
  val shouldAlert: Boolean,
) {
  val onlyAlertOnce: Boolean
    get() = true

  val notificationPriority: Int
    get() =
      if (shouldAlert) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT

  val carImportance: Int
    get() =
      if (shouldAlert) NotificationManager.IMPORTANCE_HIGH else NotificationManager.IMPORTANCE_DEFAULT

  val channelId: String
    get() =
      if (shouldAlert) CAR_NOTIFICATION_ALERT_CHANNEL_ID else CAR_NOTIFICATION_QUIET_CHANNEL_ID

  val ongoing: Boolean
    get() = false
}

internal data class PersistedCarNotificationPolicy(
  val notificationPosted: Boolean,
  val dismissedForSession: Boolean = false,
  val sessionToken: String? = null,
  val lastAlertElapsedRealtimeMs: Long?,
  val lastPostElapsedRealtimeMs: Long? = null,
  val messageEventWallClockMs: Long? = null,
  val savedAtElapsedRealtimeMs: Long,
  val savedAtWallClockMs: Long,
  val bootSessionId: String,
)

internal data class CarNotificationPrivacyContract(
  val privateVisibility: Int = NotificationCompat.VISIBILITY_PRIVATE,
  val publicVisibility: Int = NotificationCompat.VISIBILITY_PUBLIC,
  val publicTitle: String = CAR_NOTIFICATION_PUBLIC_TITLE,
  val publicText: String = CAR_NOTIFICATION_PUBLIC_TEXT,
)

internal fun carNotificationPrivacyContract() = CarNotificationPrivacyContract()

internal fun carNotificationPersistedPolicyFieldNames(): Set<String> =
  setOf(
    CAR_NOTIFICATION_POLICY_PRESENT,
    CAR_NOTIFICATION_POLICY_POSTED,
    CAR_NOTIFICATION_POLICY_DISMISSED,
    CAR_NOTIFICATION_POLICY_SESSION_TOKEN,
    CAR_NOTIFICATION_POLICY_ALERT_ELAPSED,
    CAR_NOTIFICATION_POLICY_LAST_POST_ELAPSED,
    CAR_NOTIFICATION_POLICY_MESSAGE_EVENT_WALL,
    CAR_NOTIFICATION_POLICY_SAVED_ELAPSED,
    CAR_NOTIFICATION_POLICY_SAVED_WALL,
    CAR_NOTIFICATION_POLICY_BOOT_SESSION,
  )

/**
 * Restores only notification policy metadata. Monotonic time is authoritative
 * while the boot session matches, so wall-clock corrections cannot fabricate a
 * new projection session. A reboot, monotonic rollback, or expired session is
 * treated as a new projection session.
 */
internal fun restoreCarNotificationSessionState(
  persisted: PersistedCarNotificationPolicy,
  nowElapsedRealtimeMs: Long,
  nowWallClockMs: Long,
  bootSessionId: String,
  currentReadingTimestampMs: Long?,
): CarNotificationSessionState? {
  if (
    persisted.bootSessionId.isBlank() ||
      persisted.savedAtElapsedRealtimeMs < 0L ||
      persisted.savedAtWallClockMs < 0L
  ) {
    return null
  }
  if (persisted.bootSessionId != bootSessionId) return null
  if (persisted.sessionToken.isNullOrBlank()) return null
  if (nowElapsedRealtimeMs < persisted.savedAtElapsedRealtimeMs) return null
  if (
    persisted.lastAlertElapsedRealtimeMs != null &&
      (persisted.lastAlertElapsedRealtimeMs > persisted.savedAtElapsedRealtimeMs ||
        persisted.lastAlertElapsedRealtimeMs > nowElapsedRealtimeMs)
  ) {
    return null
  }
  if (
    persisted.lastPostElapsedRealtimeMs != null &&
      (persisted.lastPostElapsedRealtimeMs > persisted.savedAtElapsedRealtimeMs ||
        persisted.lastPostElapsedRealtimeMs > nowElapsedRealtimeMs)
  ) {
    return null
  }
  if (persisted.messageEventWallClockMs != null && persisted.messageEventWallClockMs < 0L) return null
  if (
    (persisted.lastAlertElapsedRealtimeMs == null) !=
      (persisted.messageEventWallClockMs == null)
  ) {
    return null
  }

  val elapsedAge = nowElapsedRealtimeMs - persisted.savedAtElapsedRealtimeMs
  if (elapsedAge > CAR_NOTIFICATION_SESSION_EXPIRY_MS) return null
  val wallAge = nowWallClockMs - persisted.savedAtWallClockMs
  // Use wall time only when it agrees with the same-boot monotonic clock. A
  // manual/NTP jump in either direction must not make a card reappear early.
  val wallClockIsReliable =
    wallAge in 0L..(CAR_NOTIFICATION_SESSION_EXPIRY_MS + CAR_NOTIFICATION_CLOCK_DRIFT_TOLERANCE_MS) &&
      kotlin.math.abs(wallAge - elapsedAge) <= CAR_NOTIFICATION_CLOCK_DRIFT_TOLERANCE_MS
  val sessionAge = if (wallClockIsReliable) max(elapsedAge, wallAge) else elapsedAge
  if (sessionAge > CAR_NOTIFICATION_SESSION_EXPIRY_MS) return null

  return CarNotificationSessionState(
    connected = true,
    sessionToken = persisted.sessionToken,
    notificationPosted = persisted.notificationPosted,
    dismissedForSession = persisted.dismissedForSession || !persisted.notificationPosted,
    // Notification policy intentionally persists no source measurement time.
    // If a card was posted, its last rendered reading is therefore unknown:
    // leave it null so the current encrypted snapshot receives one quiet update
    // after process restart. A dismissed card remains suppressed regardless;
    // retaining its current timestamp also avoids inventing a pending update.
    lastPresentedReadingTimestampMs =
      if (persisted.notificationPosted) null else currentReadingTimestampMs,
    lastPresentedContentIdentity = null,
    lastAlertElapsedRealtimeMs = persisted.lastAlertElapsedRealtimeMs,
    lastPostElapsedRealtimeMs = persisted.lastPostElapsedRealtimeMs,
    messageEventWallClockMs = persisted.messageEventWallClockMs,
  )
}

internal fun transitionCarNotificationConnection(
  state: CarNotificationSessionState,
  connected: Boolean,
  newSessionToken: String = "test-session",
): CarNotificationConnectionTransition {
  if (!connected) {
    return CarNotificationConnectionTransition(
      state = CarNotificationSessionState(),
      freshProjectionSession = false,
    )
  }
  if (state.connected) {
    // CarConnection exposes current connectivity, not a durable projection
    // session identifier. A disconnect/reconnect completed while this process
    // was dead is indistinguishable from one uninterrupted projection, so keep
    // the restored no-duplicate state rather than guessing and issuing a HUN.
    return CarNotificationConnectionTransition(state, freshProjectionSession = false)
  }
  return CarNotificationConnectionTransition(
    state = CarNotificationSessionState(
      connected = true,
      sessionToken = newSessionToken.ifBlank { "test-session" },
    ),
    freshProjectionSession = true,
  )
}

internal fun cancelCarNotification(
  state: CarNotificationSessionState,
): CarNotificationSessionState =
  state.copy(
    notificationPosted = false,
    dismissedForSession = true,
    lastPostElapsedRealtimeMs = null,
  )

internal fun decideCarNotificationPost(
  state: CarNotificationSessionState,
  freshProjectionSession: Boolean,
  readingTimestampMs: Long?,
  contentIdentity: CarNotificationContentIdentity =
    CarNotificationContentIdentity(
      available = readingTimestampMs != null,
      readingTimestampMs = readingTimestampMs,
    ),
  nowElapsedRealtimeMs: Long = 0L,
): CarNotificationPostDecision {
  if (!state.connected || state.dismissedForSession) {
    return CarNotificationPostDecision(shouldNotify = false, shouldAlert = false)
  }

  val contentChanged =
    state.lastPresentedContentIdentity == null ||
      readingTimestampMs != state.lastPresentedReadingTimestampMs ||
      contentIdentity != state.lastPresentedContentIdentity
  val keepAliveDue =
    state.notificationPosted &&
      (state.lastPostElapsedRealtimeMs == null ||
        nowElapsedRealtimeMs - state.lastPostElapsedRealtimeMs >=
          CAR_NOTIFICATION_KEEPALIVE_INTERVAL_MS)
  // Exactly the first successful post of a projection may interrupt the
  // driver. Changed content and timed keepalives thereafter use quiet updates,
  // and dismissal remains sticky until the next projection session.
  // The first attempt may fail before notify() records success. Keep the
  // durable never-posted state alert-eligible so a later refresh can retry the
  // initial event instead of leaving this projection permanently blank.
  val shouldAlert =
    state.lastAlertElapsedRealtimeMs == null &&
      (freshProjectionSession || !state.notificationPosted)
  return CarNotificationPostDecision(
    shouldNotify = shouldAlert || (state.notificationPosted && (contentChanged || keepAliveDue)),
    shouldAlert = shouldAlert,
  )
}

internal fun carNotificationKeepAliveDelayMs(
  state: CarNotificationSessionState,
  nowElapsedRealtimeMs: Long,
): Long? {
  if (!state.connected || !state.notificationPosted || state.dismissedForSession) return null
  val lastPost = state.lastPostElapsedRealtimeMs ?: return 0L
  val elapsedSincePost = (nowElapsedRealtimeMs - lastPost).coerceAtLeast(0L)
  return (CAR_NOTIFICATION_KEEPALIVE_INTERVAL_MS - elapsedSincePost).coerceAtLeast(0L)
}

internal fun shouldRunCarNotificationCallback(
  expectedSessionToken: String,
  state: CarNotificationSessionState,
): Boolean =
  expectedSessionToken == state.sessionToken &&
    state.connected &&
    state.notificationPosted &&
    !state.dismissedForSession

/**
 * Android Auto expires the compact dashboard message from its MessagingStyle
 * event time, even while same-key notification updates continue to arrive.
 * Give every successful publication a current transport timestamp so a quiet
 * keepalive can extend that card. The visible age still comes exclusively from
 * the glucose measurement timestamp in T1ArcCarPresentation.
 */
internal fun carNotificationMessageTimestampMs(nowWallClockMs: Long): Long = nowWallClockMs

internal fun recordCarNotificationPost(
  state: CarNotificationSessionState,
  readingTimestampMs: Long?,
  contentIdentity: CarNotificationContentIdentity =
    CarNotificationContentIdentity(
      available = readingTimestampMs != null,
      readingTimestampMs = readingTimestampMs,
    ),
  nowElapsedRealtimeMs: Long,
  messageTimestampMs: Long,
  alerted: Boolean,
): CarNotificationSessionState =
  state.copy(
    notificationPosted = true,
    dismissedForSession = false,
    lastPresentedReadingTimestampMs = readingTimestampMs,
    lastPresentedContentIdentity = contentIdentity,
    lastAlertElapsedRealtimeMs =
      if (alerted) nowElapsedRealtimeMs else state.lastAlertElapsedRealtimeMs,
    lastPostElapsedRealtimeMs = nowElapsedRealtimeMs,
    messageEventWallClockMs = messageTimestampMs,
  )

private object T1ArcCarNotificationPolicyStore {
  fun load(
    context: Context,
    nowElapsedRealtimeMs: Long,
    nowWallClockMs: Long,
  ): CarNotificationSessionState? {
    val preferences = context.getSharedPreferences(CAR_NOTIFICATION_POLICY_PREFS, Context.MODE_PRIVATE)
    val unexpectedFields = preferences.all.keys - carNotificationPersistedPolicyFieldNames()
    if (unexpectedFields.isNotEmpty()) {
      val editor = preferences.edit()
      unexpectedFields.forEach(editor::remove)
      editor.commit()
    }
    if (!preferences.getBoolean(CAR_NOTIFICATION_POLICY_PRESENT, false)) return null
    val persisted =
      PersistedCarNotificationPolicy(
        notificationPosted = preferences.getBoolean(CAR_NOTIFICATION_POLICY_POSTED, false),
        dismissedForSession = preferences.getBoolean(CAR_NOTIFICATION_POLICY_DISMISSED, false),
        sessionToken = preferences.getString(CAR_NOTIFICATION_POLICY_SESSION_TOKEN, null),
        lastAlertElapsedRealtimeMs =
          preferences.getLong(
            CAR_NOTIFICATION_POLICY_ALERT_ELAPSED,
            CAR_NOTIFICATION_NULL_ELAPSED_TIME,
          ).takeUnless { it == CAR_NOTIFICATION_NULL_ELAPSED_TIME },
        lastPostElapsedRealtimeMs =
          preferences.getLong(
            CAR_NOTIFICATION_POLICY_LAST_POST_ELAPSED,
            CAR_NOTIFICATION_NULL_ELAPSED_TIME,
          ).takeUnless { it == CAR_NOTIFICATION_NULL_ELAPSED_TIME },
        messageEventWallClockMs =
          preferences.getLong(
            CAR_NOTIFICATION_POLICY_MESSAGE_EVENT_WALL,
            CAR_NOTIFICATION_NULL_ELAPSED_TIME,
          ).takeUnless { it == CAR_NOTIFICATION_NULL_ELAPSED_TIME },
        savedAtElapsedRealtimeMs =
          preferences.getLong(CAR_NOTIFICATION_POLICY_SAVED_ELAPSED, -1L),
        savedAtWallClockMs = preferences.getLong(CAR_NOTIFICATION_POLICY_SAVED_WALL, -1L),
        bootSessionId =
          preferences.getString(CAR_NOTIFICATION_POLICY_BOOT_SESSION, null).orEmpty(),
      )
    val restored =
      restoreCarNotificationSessionState(
        persisted = persisted,
        nowElapsedRealtimeMs = nowElapsedRealtimeMs,
        nowWallClockMs = nowWallClockMs,
        bootSessionId = bootSessionId(context, nowElapsedRealtimeMs, nowWallClockMs),
        currentReadingTimestampMs = T1ArcGlucoseDisplayState.snapshot(context)?.timestampMs,
      )
    if (restored == null) clear(context)
    return restored
  }

  fun save(
    context: Context,
    state: CarNotificationSessionState,
    nowElapsedRealtimeMs: Long,
    nowWallClockMs: Long,
  ) {
    if (!state.connected) {
      clear(context)
      return
    }
    // This store deliberately contains notification lifecycle metadata only:
    // never reading availability, timestamp, value, trend, source, account,
    // or graph data.
    context.getSharedPreferences(CAR_NOTIFICATION_POLICY_PREFS, Context.MODE_PRIVATE)
      .edit()
      .clear()
      .putBoolean(CAR_NOTIFICATION_POLICY_PRESENT, true)
      .putBoolean(CAR_NOTIFICATION_POLICY_POSTED, state.notificationPosted)
      .putBoolean(CAR_NOTIFICATION_POLICY_DISMISSED, state.dismissedForSession)
      .putString(CAR_NOTIFICATION_POLICY_SESSION_TOKEN, state.sessionToken)
      .putLong(
        CAR_NOTIFICATION_POLICY_ALERT_ELAPSED,
        state.lastAlertElapsedRealtimeMs ?: CAR_NOTIFICATION_NULL_ELAPSED_TIME,
      )
      .putLong(
        CAR_NOTIFICATION_POLICY_LAST_POST_ELAPSED,
        state.lastPostElapsedRealtimeMs ?: CAR_NOTIFICATION_NULL_ELAPSED_TIME,
      )
      .putLong(
        CAR_NOTIFICATION_POLICY_MESSAGE_EVENT_WALL,
        state.messageEventWallClockMs ?: CAR_NOTIFICATION_NULL_ELAPSED_TIME,
      )
      .putLong(CAR_NOTIFICATION_POLICY_SAVED_ELAPSED, nowElapsedRealtimeMs)
      .putLong(CAR_NOTIFICATION_POLICY_SAVED_WALL, nowWallClockMs)
      .putString(
        CAR_NOTIFICATION_POLICY_BOOT_SESSION,
        bootSessionId(context, nowElapsedRealtimeMs, nowWallClockMs),
      )
      .commit()
  }

  fun clear(context: Context) {
    context.getSharedPreferences(CAR_NOTIFICATION_POLICY_PREFS, Context.MODE_PRIVATE)
      .edit()
      .clear()
      .commit()
  }

  private fun bootSessionId(
    context: Context,
    nowElapsedRealtimeMs: Long,
    nowWallClockMs: Long,
  ): String {
    val bootCount =
      runCatching {
        Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)
      }.getOrDefault(-1)
    if (bootCount >= 0) return "boot-count:$bootCount"
    // BOOT_COUNT should be readable on supported Android versions. This
    // fallback still prevents stale state crossing a reboot on unusual OEMs.
    val approximateBootWallClockMs = nowWallClockMs - nowElapsedRealtimeMs
    return "boot-epoch:${Math.floorDiv(approximateBootWallClockMs, CAR_NOTIFICATION_CLOCK_DRIFT_TOLERANCE_MS)}"
  }
}

/**
 * The Android Auto surface deliberately lives inside the phone app. It reads
 * the same encrypted snapshot and normalised history as notification, widget
 * and Wear OS, avoiding a second installation and cross-app health broadcasts.
 */
internal object T1ArcAndroidAuto {
  @Volatile private var initialized = false
  @Volatile private var projected = false
  @Volatile private var hasObservedConnectionType = false
  @Volatile private var appContext: Context? = null
  private val mainHandler = Handler(Looper.getMainLooper())

  private val connectionObserver =
    Observer<Int> { type ->
      val connected = type == CarConnection.CONNECTION_TYPE_PROJECTION
      val connectionChanged = !hasObservedConnectionType || connected != projected
      hasObservedConnectionType = true
      if (!connectionChanged) return@Observer
      projected = connected
      Log.i(
        CAR_LOG_TAG,
        if (connected) "Android Auto projection connected" else "Android Auto projection disconnected",
      )
      val context = appContext
      val available = connected && context?.let(T1ArcGlucoseDisplayState::androidAutoEnabled) == true
      T1ArcCarMediaBrowserService.connectionChanged(available)
      context?.let { T1ArcCarNotification.connectionChanged(it, available) }
    }

  fun initialize(context: Context) {
    if (initialized) return
    val applicationContext = context.applicationContext
    if (Looper.myLooper() != Looper.getMainLooper()) {
      // LiveData.observeForever must be registered from the main thread. The
      // native module's async publication/clear functions run on a coroutine
      // worker, including the first verified glucose-source activation before
      // the foreground display service has had a chance to initialise Auto.
      mainHandler.post { initialize(applicationContext) }
      return
    }
    synchronized(this) {
      if (initialized) return
      appContext = applicationContext
      initialized = true
      CarConnection(applicationContext).type.observeForever(connectionObserver)
    }
  }

  fun refresh(context: Context) {
    initialize(context)
    if (!T1ArcGlucoseDisplayState.androidAutoEnabled(context)) {
      T1ArcCarMediaBrowserService.connectionChanged(false)
      T1ArcCarNotification.connectionChanged(context.applicationContext, false)
      return
    }
    T1ArcCarMediaBrowserService.refresh()
    if (projected) T1ArcCarNotification.show(context.applicationContext)
  }

  fun settingChanged(context: Context) {
    initialize(context)
    val available = projected && T1ArcGlucoseDisplayState.androidAutoEnabled(context)
    T1ArcCarMediaBrowserService.connectionChanged(available)
    T1ArcCarNotification.connectionChanged(context.applicationContext, available)
  }

  fun isProjected(): Boolean = projected
}

class T1ArcCarMediaBrowserService : MediaBrowserServiceCompat() {
  private lateinit var session: MediaSessionCompat

  override fun onCreate() {
    super.onCreate()
    instance = this
    T1ArcAndroidAuto.initialize(this)
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

            override fun onPlayFromSearch(query: String?, extras: Bundle?) {
              openFullScreen()
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
    if (!T1ArcGlucoseDisplayState.androidAutoEnabled(this)) {
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
            .setTitle(getString(R.string.t1arc_android_auto_section_name))
            .setSubtitle(getString(R.string.t1arc_android_auto_section_description))
            .setIconBitmap(T1ArcCarPresentation.sectionArt())
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
            CAR_UNKNOWN_CALLER_PID,
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
            PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID or
            PlaybackStateCompat.ACTION_PLAY_FROM_SEARCH
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
      enabled = T1ArcGlucoseDisplayState.androidAutoEnabled(this),
      projected = T1ArcAndroidAuto.isProjected(),
    )

  private fun presentationForCurrentCarState(): CarPresentation =
    if (canExposeGlucose()) {
      T1ArcCarPresentation.create(this)
    } else {
      T1ArcCarPresentation.privatePlaceholder()
    }

  companion object {
    @Volatile private var instance: T1ArcCarMediaBrowserService? = null
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
  val contentIdentity: CarNotificationContentIdentity,
)

private object T1ArcCarPresentation {
  fun privatePlaceholder() =
    CarPresentation(
      title = "T1 Arc",
      subtitle = "Connect Android Auto to view glucose",
      description = "Private glucose is hidden outside Android Auto",
      art = sectionArt(),
      timestampMs = null,
      contentIdentity = CarNotificationContentIdentity(available = false),
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
    val snapshot = T1ArcGlucoseDisplayState.snapshot(context)
    val history = recentHistory()
    val historyIdentity =
      history.map { point ->
        CarNotificationHistoryPointIdentity(
          timestampMs = point.timestampMs,
          valueBits = java.lang.Double.doubleToLongBits(point.mmolL),
        )
      }
    if (snapshot == null) {
      return CarPresentation(
        title = "Glucose unavailable",
        subtitle = "Open T1 Arc on your phone",
        description = "T1 Arc glucose unavailable",
        art = renderArt(context, null, history),
        timestampMs = null,
        contentIdentity =
          CarNotificationContentIdentity(
            available = false,
            history = historyIdentity,
          ),
      )
    }
    val arrow = trendArrow(snapshot.trend)
    val freshness = T1ArcGlucoseDisplayState.freshness(context)
    val value = T1ArcGlucoseDisplayState.displayGlucoseValue(context, snapshot.mmolL)
    val unit = T1ArcGlucoseDisplayState.displayGlucoseUnit(context)
    return CarPresentation(
      title = glucoseDisplayTitle(value, " $unit $arrow", freshness),
      subtitle =
        if (freshness == DisplayFreshness.STALE) {
          "Stale · last known · ${ageCopy(context, snapshot.timestampMs)}"
        } else {
          "${trendLabel(snapshot.trend)} · ${ageCopy(context, snapshot.timestampMs)}"
        },
      description =
        if (freshness == DisplayFreshness.STALE) {
          "T1 Arc last known stale glucose"
        } else {
          "T1 Arc current glucose"
        },
      art = renderArt(context, snapshot, history),
      timestampMs = snapshot.timestampMs,
      // Age/freshness deliberately stays out of this revision. The monotonic
      // keepalive refreshes it; this identity detects same-timestamp value,
      // trend, source, and error corrections immediately.
      contentIdentity =
        CarNotificationContentIdentity(
          available = true,
          readingTimestampMs = snapshot.timestampMs,
          valueBits = java.lang.Double.doubleToLongBits(snapshot.mmolL),
          trend = snapshot.trend,
          trendOrigin = snapshot.trendOrigin,
          sourceLabel = snapshot.sourceLabel,
          sourceHasError = snapshot.sourceHasError,
          history = historyIdentity,
        ),
    )
  }

  private fun recentHistory(): List<GlucoseHistoryPoint> {
    val since = System.currentTimeMillis() - THREE_HOURS_MS
    return T1ArcWearSync.history()
      .filter { it.timestampMs >= since }
      .sortedBy(GlucoseHistoryPoint::timestampMs)
  }

  private fun renderArt(
    context: Context,
    snapshot: GlucoseDisplaySnapshot?,
    history: List<GlucoseHistoryPoint>,
  ): Bitmap {
    val size = 512
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(Color.rgb(3, 18, 22))
    val freshness = T1ArcGlucoseDisplayState.freshness(context)
    val tone = T1ArcGlucoseDisplayState.displayColor(context, snapshot, freshness)
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
        "${T1ArcGlucoseDisplayState.displayGlucoseValue(context, snapshot.mmolL)} ${trendArrow(snapshot.trend)}"
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
          "STALE · LAST KNOWN · ${ageCopy(context, snapshot.timestampMs).uppercase(T1ArcGlucoseDisplayState.displayLocale(context))}"
        } else {
          "${T1ArcGlucoseDisplayState.displayGlucoseUnit(context)} · ${ageCopy(context, snapshot.timestampMs).uppercase(T1ArcGlucoseDisplayState.displayLocale(context))}"
        },
        size / 2f,
        292f,
        detailPaint,
      )
    }
    drawHistory(context, canvas, RectF(40f, 335f, 472f, 470f), history)
    return bitmap
  }

  private fun drawHistory(
    context: Context,
    canvas: Canvas,
    bounds: RectF,
    points: List<GlucoseHistoryPoint>,
  ) {
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
          color = T1ArcGlucoseDisplayState.displayColor(context, snapshotFor(to), appearanceFreshness)
          strokeWidth = 7f
          strokeCap = Paint.Cap.ROUND
        },
      )
    }
  }

  private fun snapshotFor(point: GlucoseHistoryPoint) =
    GlucoseDisplaySnapshot(point.mmolL, "unknown", "unavailable", point.timestampMs, "History", false)

  private fun ageCopy(context: Context, timestampMs: Long): String {
    val minutes =
      floor(max(0L, System.currentTimeMillis() - timestampMs) / 60_000.0).toInt()
    val locale = T1ArcGlucoseDisplayState.displayLocale(context)
    return when (minutes) {
      0 -> "just now"
      1 -> "${RegionalNumberFormatter.integer(1L, locale)} min"
      in 2..59 -> "${RegionalNumberFormatter.integer(minutes.toLong(), locale)} min"
      else -> "${RegionalNumberFormatter.integer((minutes / 60).toLong(), locale)} hr"
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

private object T1ArcCarNotification {
  @Volatile private var sessionState = CarNotificationSessionState()
  @Volatile private var stateLoaded = false
  private val handler = Handler(Looper.getMainLooper())
  private var keepAliveRunnable: Runnable? = null

  @Synchronized
  fun connectionChanged(context: Context, value: Boolean) {
    cancelKeepAliveLocked()
    if (!value) {
      sessionState = CarNotificationSessionState()
      stateLoaded = true
      T1ArcCarMediaBrowserService.refresh()
      CarNotificationManager.from(context).cancel(CAR_NOTIFICATION_ID)
      T1ArcCarNotificationPolicyStore.clear(context)
      return
    }
    loadStateIfNeeded(context)
    val transition =
      transitionCarNotificationConnection(
        state = sessionState,
        connected = value,
        newSessionToken = UUID.randomUUID().toString(),
      )
    sessionState = transition.state
    T1ArcCarMediaBrowserService.refresh()
    if (transition.freshProjectionSession) {
      // Remove a stale notification from an earlier projection/process before
      // posting this session's first event. This gives the car host one genuine
      // new-notification event rather than an update it may silently collapse.
      CarNotificationManager.from(context).cancel(CAR_NOTIFICATION_ID)
    }
    show(context, transition.freshProjectionSession)
  }

  @Synchronized
  fun show(
    context: Context,
    freshProjectionSession: Boolean = false,
    expectedSessionToken: String? = null,
  ) {
    loadStateIfNeeded(context)
    if (expectedSessionToken != null && expectedSessionToken != sessionState.sessionToken) return
    if (
      !sessionState.connected ||
        !shouldExposeAndroidAutoGlucose(
          enabled = T1ArcGlucoseDisplayState.androidAutoEnabled(context),
          projected = T1ArcAndroidAuto.isProjected(),
        )
    ) {
      return
    }
    val presentation = T1ArcCarPresentation.create(context)
    val sessionToken = sessionState.sessionToken ?: return
    val nowElapsedRealtimeMs = SystemClock.elapsedRealtime()
    val nowWallClockMs = System.currentTimeMillis()
    val messageTime = carNotificationMessageTimestampMs(nowWallClockMs)
    val postDecision =
      decideCarNotificationPost(
        state = sessionState,
        freshProjectionSession = freshProjectionSession,
        readingTimestampMs = presentation.timestampMs,
        contentIdentity = presentation.contentIdentity,
        nowElapsedRealtimeMs = nowElapsedRealtimeMs,
      )
    if (!postDecision.shouldNotify) {
      Log.d(CAR_LOG_TAG, "Car notification unchanged or dismissed for this projection")
      scheduleKeepAliveLocked(context)
      return
    }
    ensureChannels(context)
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
        Intent(context, T1ArcCarNotificationReceiver::class.java)
          .setAction(CAR_NOTIFICATION_DISMISS_ACTION)
          .setData(Uri.parse("t1arc://android-auto/$sessionToken/dismiss"))
          .putExtra(CAR_NOTIFICATION_SESSION_TOKEN_EXTRA, sessionToken),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    val replyIntent =
      PendingIntent.getBroadcast(
        context,
        CAR_NOTIFICATION_ID + 2,
        Intent(context, T1ArcCarNotificationReceiver::class.java)
          .setAction(CAR_NOTIFICATION_REPLY_ACTION)
          .setData(Uri.parse("t1arc://android-auto/$sessionToken/refresh"))
          .putExtra(CAR_NOTIFICATION_SESSION_TOKEN_EXTRA, sessionToken),
        // Android Auto must add the voice RemoteInput result before sending.
        // The intent remains explicit and scoped to T1 Arc's private receiver.
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
      )
    val person =
      Person.Builder()
        .setName(presentation.title)
        .setKey(CAR_NOTIFICATION_PERSON_KEY)
        .setImportant(true)
        .build()
    val remoteInput =
      RemoteInput.Builder(CAR_NOTIFICATION_REPLY_KEY)
        .setLabel("Refresh glucose")
        .build()
    val refreshAction =
      NotificationCompat.Action.Builder(
        R.drawable.t1arc_notification_pulse,
        "Refresh",
        replyIntent,
      )
        .addRemoteInput(remoteInput)
        .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
        .setShowsUserInterface(false)
        .build()
    val dismissAction =
      NotificationCompat.Action.Builder(
        R.drawable.t1arc_notification_pulse,
        "Dismiss",
        dismissIntent,
      )
        .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
        .setShowsUserInterface(false)
        .build()
    val privacy = carNotificationPrivacyContract()
    val channelId = postDecision.channelId
    val notification =
      NotificationCompat.Builder(context, channelId)
        .setSmallIcon(R.drawable.t1arc_notification_pulse)
        .setLargeIcon(presentation.art)
        .setContentTitle(presentation.title)
        .setContentText(presentation.subtitle)
        .setStyle(
          NotificationCompat.MessagingStyle(person)
            .addMessage(presentation.subtitle, messageTime, person)
        )
        .setWhen(messageTime)
        .setShowWhen(true)
        .setCategory(NotificationCompat.CATEGORY_MESSAGE)
        .setVisibility(privacy.privateVisibility)
        .setPublicVersion(createRedactedPublicVersion(context, privacy, channelId))
        .setPriority(postDecision.notificationPriority)
        .setOnlyAlertOnce(postDecision.onlyAlertOnce)
        .setSilent(true)
        .setOngoing(postDecision.ongoing)
        .setContentIntent(contentIntent)
        .setDeleteIntent(dismissIntent)
        .extend(CarAppExtender.Builder().setImportance(postDecision.carImportance).build())
        .addInvisibleAction(refreshAction)
        .addInvisibleAction(dismissAction)
    CarNotificationManager.from(context).notify(CAR_NOTIFICATION_ID, notification)
    val postedAtElapsedRealtimeMs = SystemClock.elapsedRealtime()
    val postedAtWallClockMs = System.currentTimeMillis()
    sessionState =
      recordCarNotificationPost(
        state = sessionState,
        readingTimestampMs = presentation.timestampMs,
        contentIdentity = presentation.contentIdentity,
        nowElapsedRealtimeMs = postedAtElapsedRealtimeMs,
        messageTimestampMs = messageTime,
        alerted = postDecision.shouldAlert,
      )
    T1ArcCarNotificationPolicyStore.save(
      context = context,
      state = sessionState,
      nowElapsedRealtimeMs = postedAtElapsedRealtimeMs,
      nowWallClockMs = postedAtWallClockMs,
    )
    scheduleKeepAliveLocked(context)
  }

  @Synchronized
  fun cancel(context: Context, expectedSessionToken: String? = null) {
    loadStateIfNeeded(context)
    if (expectedSessionToken != null && expectedSessionToken != sessionState.sessionToken) return
    cancelKeepAliveLocked()
    cancelPostedNotification(context)
  }

  private fun cancelPostedNotification(context: Context) {
    sessionState = cancelCarNotification(sessionState)
    CarNotificationManager.from(context).cancel(CAR_NOTIFICATION_ID)
    T1ArcCarNotificationPolicyStore.save(
      context = context,
      state = sessionState,
      nowElapsedRealtimeMs = SystemClock.elapsedRealtime(),
      nowWallClockMs = System.currentTimeMillis(),
    )
  }

  private fun loadStateIfNeeded(context: Context) {
    if (stateLoaded) return
    val nowElapsedRealtimeMs = SystemClock.elapsedRealtime()
    sessionState =
      T1ArcCarNotificationPolicyStore.load(
        context = context,
        nowElapsedRealtimeMs = nowElapsedRealtimeMs,
        nowWallClockMs = System.currentTimeMillis(),
      ) ?: CarNotificationSessionState()
    stateLoaded = true
  }

  private fun scheduleKeepAliveLocked(context: Context) {
    cancelKeepAliveLocked()
    val nowElapsedRealtimeMs = SystemClock.elapsedRealtime()
    val delayMs =
      carNotificationKeepAliveDelayMs(sessionState, nowElapsedRealtimeMs) ?: return
    val expectedSessionToken = sessionState.sessionToken ?: return
    val appContext = context.applicationContext
    val runnable =
      Runnable {
        runKeepAlive(appContext, expectedSessionToken)
      }
    keepAliveRunnable = runnable
    handler.postDelayed(runnable, delayMs.coerceAtLeast(1L))
  }

  @Synchronized
  private fun runKeepAlive(context: Context, expectedSessionToken: String) {
    keepAliveRunnable = null
    if (!shouldRunCarNotificationCallback(expectedSessionToken, sessionState)) {
      return
    }
    show(context)
  }

  private fun cancelKeepAliveLocked() {
    keepAliveRunnable?.let(handler::removeCallbacks)
    keepAliveRunnable = null
  }

  private fun createRedactedPublicVersion(
    context: Context,
    privacy: CarNotificationPrivacyContract,
    channelId: String,
  ): Notification =
    NotificationCompat.Builder(context, channelId)
      .setSmallIcon(R.drawable.t1arc_notification_pulse)
      .setContentTitle(privacy.publicTitle)
      .setContentText(privacy.publicText)
      .setVisibility(privacy.publicVisibility)
      .setShowWhen(false)
      .setSilent(true)
      .build()

  private fun ensureChannels(context: Context) {
    context.getSystemService(NotificationManager::class.java).createNotificationChannels(
      listOf(
        NotificationChannel(
          CAR_NOTIFICATION_ALERT_CHANNEL_ID,
          "Android Auto glucose connection",
          NotificationManager.IMPORTANCE_HIGH,
        ).apply {
          description = "Shows T1 Arc glucose when Android Auto connects"
          setSound(null, null)
          enableVibration(false)
        },
        NotificationChannel(
          CAR_NOTIFICATION_QUIET_CHANNEL_ID,
          "Android Auto glucose updates",
          NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
          description = "Quietly refreshes the T1 Arc Android Auto glucose card"
          setSound(null, null)
          enableVibration(false)
          setShowBadge(false)
        },
      ),
    )
  }
}

class T1ArcCarNotificationReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val receivedIntent = intent ?: return
    val expectedSessionToken =
      receivedIntent.getStringExtra(CAR_NOTIFICATION_SESSION_TOKEN_EXTRA) ?: return
    when (intent?.action) {
      CAR_NOTIFICATION_REPLY_ACTION ->
        T1ArcCarNotification.show(
          context.applicationContext,
          expectedSessionToken = expectedSessionToken,
        )
      CAR_NOTIFICATION_DISMISS_ACTION ->
        T1ArcCarNotification.cancel(context.applicationContext, expectedSessionToken)
    }
  }
}
