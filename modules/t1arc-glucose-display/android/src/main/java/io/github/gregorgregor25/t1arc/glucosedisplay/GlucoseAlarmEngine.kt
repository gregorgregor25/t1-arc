package io.github.gregorgregor25.t1arc.glucosedisplay

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaMetadataRetriever
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.KeyStore
import java.util.Calendar
import java.util.TimeZone
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlin.math.PI
import kotlin.math.min
import kotlin.math.sin

private const val ALARM_PREFS = "t1arc_glucose_alarm_v1"
private const val ALARM_KEY = "t1arc.glucose-alarms.v1"
private const val ALARM_NOTIFICATION = 6440
private const val ALARM_CHANNEL = "t1arc_glucose_native_alarms_v1"
private const val ACTION_ALARM_TICK = "io.github.gregorgregor25.t1arc.ALARM_TICK"
private const val ACTION_ALARM_ACK = "io.github.gregorgregor25.t1arc.ALARM_ACK"
private const val ACTION_ALARM_SNOOZE = "io.github.gregorgregor25.t1arc.ALARM_SNOOZE"
private const val MAX_SOUND_BYTES = 10 * 1024 * 1024

/** All recoverable episode data and imported names are encrypted at rest. */
private object GlucoseAlarmStore {
  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(ALARM_KEY, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder(ALARM_KEY, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true).build())
    }.generateKey()
  }

  fun configured(context: Context) = context.getSharedPreferences(ALARM_PREFS, Context.MODE_PRIVATE).getBoolean("configured", false)

  fun read(context: Context): JSONObject? {
    val prefs = context.getSharedPreferences(ALARM_PREFS, Context.MODE_PRIVATE)
    val payload = prefs.getString("payload", null) ?: return null
    return runCatching {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(prefs.getString("iv", ""), Base64.NO_WRAP)))
      JSONObject(cipher.doFinal(Base64.decode(payload, Base64.NO_WRAP)).toString(Charsets.UTF_8))
    }.getOrNull()
  }

  fun write(context: Context, root: JSONObject) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val encrypted = cipher.doFinal(root.toString().toByteArray(Charsets.UTF_8))
    check(context.getSharedPreferences(ALARM_PREFS, Context.MODE_PRIVATE).edit()
      // Once explicitly migrated, an undecryptable configuration or a sound
      // import must never hand ownership back to legacy JS. Only erase clears it.
      .putBoolean("configured", root.has("configuration") || configured(context))
      .putString("payload", Base64.encodeToString(encrypted, Base64.NO_WRAP))
      .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP)).commit()) {
      "Glucose alarm choices could not be saved securely."
    }
  }

  fun erase(context: Context) {
    check(context.getSharedPreferences(ALARM_PREFS, Context.MODE_PRIVATE).edit().clear().commit())
  }
}

private fun JSONObject.bridgeMap(): Map<String, Any?> = keys().asSequence().associateWith { key ->
  when (val value = get(key)) {
    JSONObject.NULL -> null
    is JSONObject -> value.bridgeMap()
    is JSONArray -> (0 until value.length()).map { i ->
      when (val item = value.get(i)) { is JSONObject -> item.bridgeMap(); JSONObject.NULL -> null; else -> item }
    }
    else -> value
  }
}

internal data class NativeGlucoseAlarmConfiguration(val json: JSONObject) {
  val enabled = json.getBoolean("enabled")
  val audioEnabled = json.getBoolean("audioEnabled")
  val volume = json.getDouble("volume").toFloat()
  val rampSeconds = json.getDouble("rampSeconds")
  val policy = GlucoseAlarmPolicyConfig(
    enabled = enabled,
    lowEnabled = json.getBoolean("lowEnabled"), lowThreshold = json.getDouble("lowThresholdMmolL"),
    highEnabled = json.getBoolean("highEnabled"), highThreshold = json.getDouble("highThresholdMmolL"),
    veryHighEnabled = json.getBoolean("veryHighEnabled"),
    veryHighThreshold = if (json.isNull("veryHighThresholdMmolL")) null else json.getDouble("veryHighThresholdMmolL"),
    staleEnabled = json.getBoolean("staleEnabled"), repeatMinutes = json.getInt("repeatMinutes"),
    nightEnabled = json.getBoolean("nightEnabled"), nightStart = json.getInt("nightStartMinutes"), nightEnd = json.getInt("nightEndMinutes"),
  )

  fun sound(kind: GlucoseAlarmKind): String = json.getString(when (kind) {
    GlucoseAlarmKind.LOW -> "lowSound"; GlucoseAlarmKind.HIGH -> "highSound"
    GlucoseAlarmKind.VERY_HIGH -> "veryHighSound"; GlucoseAlarmKind.STALE -> "staleSound"
  })

  companion object {
    fun parse(fields: Map<String, Any?>): NativeGlucoseAlarmConfiguration {
      val booleans = listOf("enabled", "audioEnabled", "lowEnabled", "highEnabled", "veryHighEnabled", "staleEnabled", "nightEnabled")
      require(booleans.all { fields[it] is Boolean }) { "Every glucose alarm switch must be on or off." }
      val numbers = listOf("schemaVersion", "lowThresholdMmolL", "highThresholdMmolL", "repeatMinutes", "nightStartMinutes", "nightEndMinutes", "volume", "rampSeconds")
      require(numbers.all { (fields[it] as? Number)?.toDouble()?.isFinite() == true }) { "Alarm numbers must be finite." }
      require((fields["schemaVersion"] as Number).toDouble() == 1.0) { "Alarm configuration version is unsupported." }
      require(fields.containsKey("veryHighThresholdMmolL"))
      val high = fields["veryHighThresholdMmolL"]
      require(high == null || (high is Number && high.toDouble().isFinite())) { "Very high glucose level is invalid." }
      val config = NativeGlucoseAlarmConfiguration(JSONObject(fields))
      require(config.policy.lowThreshold in 2.0..6.0 && config.policy.highThreshold in 7.0..25.0)
      require(config.policy.highThreshold >= config.policy.lowThreshold + 1.0)
      require(config.policy.veryHighThreshold == null || config.policy.veryHighThreshold > config.policy.highThreshold && config.policy.veryHighThreshold <= 33.3)
      require(!config.policy.veryHighEnabled || config.policy.veryHighThreshold != null) { "Choose a very high glucose level first." }
      require((fields["repeatMinutes"] as Number).toDouble() in setOf(0.0, 5.0, 10.0, 15.0, 20.0, 30.0, 60.0, 120.0))
      require(listOf("nightStartMinutes", "nightEndMinutes").all { key ->
        val n = (fields[key] as Number).toDouble(); n in 0.0..1439.0 && n.toInt().toDouble() == n
      })
      require(!config.policy.nightEnabled || config.policy.nightStart != config.policy.nightEnd)
      require(config.volume in 0f..1f && config.rampSeconds in 0.0..15.0)
      require(listOf("lowSound", "highSound", "veryHighSound", "staleSound").all { key ->
        val id = fields[key] as? String; id == "pulse" || id == "notes" || id?.matches(Regex("custom:[a-f0-9-]{36}")) == true
      }) { "Choose a built-in sound or an imported sound." }
      return config
    }
  }
}

/** Native owns episodes after explicit migration; neither React nor old JS can play or cancel them. */
internal object T1ArcGlucoseAlarmEngine {
  private val lock = Any()
  private val handler = Handler(Looper.getMainLooper())
  private var root: JSONObject? = null
  private var loaded = false
  private var armedInProcess = false
  private var episode: GlucoseAlarmEpisode? = null
  private var missing = false
  private var playbackState = "idle"
  private var player: MediaPlayer? = null
  private var focus: AudioFocusRequest? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var playbackGeneration = 0L
  private var previewActive = false
  private var activePlaybackEpisode: String? = null
  private var notificationFingerprint: String? = null
  private val processClockIdentity = -(UUID.randomUUID().hashCode() and Int.MAX_VALUE).coerceAtLeast(1)

  fun configured(context: Context) = GlucoseAlarmStore.configured(context)

  private fun boot(context: Context) = Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)
    .takeIf { it >= 0 } ?: processClockIdentity
  private fun load(context: Context): JSONObject {
    if (!loaded) {
      root = GlucoseAlarmStore.read(context) ?: JSONObject()
      episode = root?.optJSONObject("episode")?.let { e -> runCatching {
        GlucoseAlarmEpisode(e.getString("id"), requireNotNull(GlucoseAlarmKind.parse(e.getString("kind"))),
          e.getString("sourceIdentity"), e.getLong("createdAt"),
          if (e.isNull("lastNotifiedElapsed")) null else e.getLong("lastNotifiedElapsed"),
          e.optBoolean("acknowledged"),
          if (e.isNull("snoozeUntilElapsed")) null else e.getLong("snoozeUntilElapsed"),
          if (e.isNull("snoozeUntilWall")) null else e.getLong("snoozeUntilWall"), e.getInt("bootCount"))
      }.getOrNull() }
      loaded = true
    }
    return requireNotNull(root)
  }

  private fun configuration(context: Context): NativeGlucoseAlarmConfiguration? = load(context).optJSONObject("configuration")?.let {
    runCatching { NativeGlucoseAlarmConfiguration.parse(it.bridgeMap()) }.getOrNull()
  }

  private fun persist(context: Context) {
    val data = load(context)
    val current = episode
    if (current == null) data.remove("episode") else data.put("episode", JSONObject()
      .put("id", current.id).put("kind", current.kind.wire).put("sourceIdentity", current.sourceIdentity)
      .put("createdAt", current.createdAt).put("lastNotifiedElapsed", current.lastNotifiedElapsed ?: JSONObject.NULL)
      .put("acknowledged", current.acknowledged).put("snoozeUntilElapsed", current.snoozeUntilElapsed ?: JSONObject.NULL)
      .put("snoozeUntilWall", current.snoozeUntilWall ?: JSONObject.NULL).put("bootCount", current.bootCount))
    GlucoseAlarmStore.write(context, data)
  }

  fun getConfiguration(context: Context): Map<String, Any?>? = synchronized(lock) { configuration(context)?.json?.bridgeMap() }

  fun save(context: Context, fields: Map<String, Any?>, visible: Boolean): Map<String, Any?> {
    val next = NativeGlucoseAlarmConfiguration.parse(fields)
    require(!next.enabled || !next.audioEnabled || visible) { "Open T1 Arc to arm glucose alarm audio." }
    T1ArcGlucosePublicationGate.observeCurrent(context) { _ -> synchronized(lock) {
      val previous = configuration(context)
      for (kind in GlucoseAlarmKind.entries.filter { GlucoseAlarmPolicy.soundRequired(next.policy, next.audioEnabled, it) }) {
        require(soundFile(context, next.sound(kind)).exists()) { "The chosen custom sound is unavailable. Import it again." }
      }
      val oldRoot = JSONObject(load(context).toString())
      val oldEpisode = episode
      load(context).put("configuration", next.json)
      // Saving display choices is not an acknowledgement. Keep an existing
      // episode; evaluation decides whether its threshold still applies.
      val configurationChanged = previous?.json?.toString() != next.json.toString()
      val restartingAudio = next.enabled && next.audioEnabled && GlucoseAlarmPolicy.shouldRestartAudio(
        armedInProcess, playbackState == "blocked", player != null, configurationChanged)
      if (restartingAudio && oldEpisode?.acknowledged == false &&
        (oldEpisode.bootCount != boot(context) || (oldEpisode.snoozeUntilElapsed ?: 0L) <= SystemClock.elapsedRealtime())) {
        episode = oldEpisode.copy(lastNotifiedElapsed = null)
      }
      try { persist(context) } catch (error: Exception) { root = oldRoot; episode = oldEpisode; throw error }
      armedInProcess = next.enabled && next.audioEnabled && visible
      if (!next.enabled || !next.audioEnabled || configurationChanged || restartingAudio) stopPlaybackLocked(context)
      T1ArcGlucoseDisplayState.setAlertMonitoringEnabled(context, next.enabled)
    } }
    T1ArcGlucoseDisplayService.reconcile(context)
    reconcile(context)
    return status(context)
  }

  fun reconcile(context: Context): Boolean {
    if (!configured(context)) return false
    try {
      T1ArcGlucosePublicationGate.observeCurrent(context) { epoch ->
        synchronized(lock) { reconcileLocked(context, epoch) }
      }
    } catch (_: Exception) {
      // A permission/storage/playback failure must never abort selected glucose
      // publication or the existing phone/watch pipeline. Ownership remains
      // native, so an obsolete JS engine cannot silently take over.
      synchronized(lock) { stopPlaybackLocked(context); playbackState = "blocked" }
    }
    return true
  }

  private fun reconcileLocked(context: Context, epoch: Long) {
    val config = configuration(context) ?: return
    val snapshot = T1ArcGlucoseDisplayState.snapshot(context)
    val now = System.currentTimeMillis()
    val elapsed = SystemClock.elapsedRealtime()
    val identity = "$epoch:${AapsLocalStore.generation(context)}:${AapsLocalStore.selectedSource(context) ?: "legacy"}"
    val calendar = Calendar.getInstance(TimeZone.getDefault()).apply { timeInMillis = now }
    val decision = GlucoseAlarmPolicy.evaluate(config.policy, snapshot?.let {
      GlucoseAlarmObservation(it.mmolL, it.timestampMs, it.sourceIsLive, it.sourceHasError)
    }, episode, identity, now, elapsed, boot(context), calendar.get(Calendar.HOUR_OF_DAY) * 60 + calendar.get(Calendar.MINUTE))
    missing = decision.missing
    if (decision.kind == null) {
      if (episode != null) { episode = null; persist(context) }
      if (!previewActive) stopPlaybackLocked(context)
      cancelNotification(context)
      schedule(context, if (config.enabled) elapsed + 60_000L else null)
      return
    }
    val old = episode
    if (!decision.keepPrevious || old == null) {
      if (!previewActive) stopPlaybackLocked(context)
      episode = GlucoseAlarmEpisode(UUID.randomUUID().toString(), decision.kind, identity, now, bootCount = boot(context))
      persist(context)
    }
    val current = requireNotNull(episode)
    if (decision.missing && current.kind != GlucoseAlarmKind.STALE && !previewActive) stopPlaybackLocked(context)
    ensureNotificationChannel(context)
    val appNotificationsAllowed = NotificationManagerCompat.from(context).areNotificationsEnabled()
    val channelAllowed = notificationChannelAllowed(context)
    val wantsAudio = !decision.silent && config.audioEnabled && armedInProcess
    val canDeliver = GlucoseAlarmPolicy.canDeliver(appNotificationsAllowed, channelAllowed, wantsAudio,
      T1ArcGlucoseDisplayService.running)
    if (!appNotificationsAllowed || !channelAllowed) {
      if (!previewActive) { stopPlaybackLocked(context); playbackState = "blocked" }
      cancelNotification(context)
      schedule(context, elapsed + 60_000L)
      return
    }
    if (decision.shouldNotify && canDeliver) {
      episode = current.copy(lastNotifiedElapsed = elapsed, acknowledged = false, snoozeUntilElapsed = null,
        snoozeUntilWall = null, bootCount = boot(context))
      persist(context)
      if (wantsAudio) startPlaybackLocked(context, config.sound(current.kind), config.volume,
        config.rampSeconds, current.id, false)
    }
    if (decision.silent && !decision.missing) {
      // No notification here: an ordinary overnight high must not vibrate a mirrored watch.
      if (!previewActive) stopPlaybackLocked(context)
      cancelNotification(context)
    } else if (canDeliver) notify(context, snapshot)
    val next = listOfNotNull(elapsed + 60_000L, episode?.snoozeUntilElapsed?.takeIf { it > elapsed }).minOrNull()
    schedule(context, next)
  }

  fun sourceCleared(context: Context) = synchronized(lock) {
    load(context)
    episode = null
    missing = true
    stopPlaybackLocked(context)
    cancelNotification(context)
    if (configured(context)) persist(context)
  }

  fun monitorStopped(context: Context) = synchronized(lock) {
    armedInProcess = false
    stopPlaybackLocked(context)
  }

  fun erase(context: Context) = synchronized(lock) {
    stopPlaybackLocked(context)
    schedule(context, null)
    cancelNotification(context)
    armedInProcess = false
    episode = null
    root = JSONObject()
    loaded = true
    GlucoseAlarmStore.erase(context)
    T1ArcGlucoseDisplayState.setAlertMonitoringEnabled(context, false)
    val directory = File(context.filesDir, "glucose-alarm-sounds")
    directory.listFiles()?.filter { it.isFile && it.canonicalFile.parentFile == directory.canonicalFile }?.forEach { check(it.delete()) }
  }

  private fun currentEpisode(context: Context, id: String): GlucoseAlarmEpisode {
    load(context)
    return requireNotNull(episode?.takeIf { it.id == id }) { "This glucose alarm has already changed. Review the current alarm." }
  }

  fun snooze(context: Context, id: String, until: Double): Map<String, Any?> {
    require(until.isFinite() && until.toLong().toDouble() == until)
    T1ArcGlucosePublicationGate.observeCurrent(context) { _ -> synchronized(lock) {
      val old = currentEpisode(context, id)
      val elapsed = SystemClock.elapsedRealtime()
      val untilElapsed = GlucoseAlarmPolicy.snoozeUntil(System.currentTimeMillis(), elapsed, until.toLong())
      episode = old.copy(snoozeUntilElapsed = untilElapsed, snoozeUntilWall = until.toLong(), bootCount = boot(context))
      persist(context)
      stopPlaybackLocked(context)
      notificationFingerprint = null
      notify(context, T1ArcGlucoseDisplayState.snapshot(context))
      schedule(context, min(elapsed + 60_000L, untilElapsed))
    } }
    return status(context)
  }

  fun cancelSnooze(context: Context, id: String): Map<String, Any?> {
    synchronized(lock) {
      val old = currentEpisode(context, id)
      episode = old.copy(snoozeUntilElapsed = 0L, snoozeUntilWall = null)
      persist(context)
    }
    reconcile(context)
    return status(context)
  }

  fun acknowledge(context: Context, id: String): Map<String, Any?> {
    synchronized(lock) {
      val old = currentEpisode(context, id)
      episode = old.copy(acknowledged = true, lastNotifiedElapsed = SystemClock.elapsedRealtime())
      persist(context)
      stopPlaybackLocked(context)
      notificationFingerprint = null
      notify(context, T1ArcGlucoseDisplayState.snapshot(context))
    }
    return status(context)
  }

  fun status(context: Context): Map<String, Any?> = synchronized(lock) {
    val config = configuration(context)
    val current = episode
    val elapsed = SystemClock.elapsedRealtime()
    val issues = mutableListOf<String>()
    if (configured(context) && config == null) issues.add("Alarm choices could not be recovered securely. Save them again.")
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) issues.add("Android notifications are blocked.")
    if (context.getSystemService(NotificationManager::class.java).getNotificationChannel(ALARM_CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE) {
      issues.add("The Android glucose alarm notification channel is blocked.")
    }
    val audio = context.getSystemService(AudioManager::class.java)
    if (config?.audioEnabled == true && audio.getStreamVolume(AudioManager.STREAM_ALARM) == 0) issues.add("Android alarm volume is zero.")
    if (config?.enabled == true && config.audioEnabled && !armedInProcess) issues.add("Open these settings and save to re-arm audio after restart.")
    if (config?.enabled == true && !T1ArcGlucoseDisplayService.running) issues.add("The background glucose monitor is not running. Open T1 Arc and save your alert choices again.")
    if (config?.audioEnabled == true && config.volume == 0f) issues.add("T1 Arc alarm volume is zero.")
    if (Build.VERSION.SDK_INT >= 31 && !context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()) issues.add("Exact alarms are not allowed; Android may delay snooze expiry and missing-data checks.")
    if (playbackState == "blocked") issues.add("Alarm playback was blocked. Open T1 Arc and re-arm audio.")
    mapOf("configured" to configured(context), "enabled" to (config?.enabled ?: false),
      "audioEnabled" to (config?.audioEnabled ?: false), "activeKind" to current?.kind?.wire, "episodeId" to current?.id,
      "readingTimestampMs" to T1ArcGlucoseDisplayState.snapshot(context)?.timestampMs?.toDouble(),
      "snoozedUntilMs" to current?.takeIf { it.bootCount == boot(context) }?.snoozeUntilElapsed
        ?.takeIf { it > elapsed }?.let { (System.currentTimeMillis() + it - elapsed).toDouble() },
      "acknowledged" to (current?.acknowledged ?: false), "missing" to missing, "playbackState" to playbackState,
      "readinessIssues" to issues, "customSounds" to sounds(context))
  }

  private fun sounds(context: Context): List<Map<String, String>> {
    val rows = load(context).optJSONArray("sounds") ?: return emptyList()
    return (0 until rows.length()).mapNotNull { index -> rows.optJSONObject(index)?.let {
      val id = it.optString("id")
      if (id.matches(Regex("custom:[a-f0-9-]{36}")) && soundFile(context, id).exists()) mapOf("id" to id, "name" to it.optString("name", "Custom sound")) else null
    } }
  }

  fun importSound(context: Context, uriString: String, displayName: String): Map<String, String> {
    val uri = Uri.parse(uriString)
    require(uri.scheme in setOf("file", "content")) { "Choose an audio file stored on your phone." }
    if (uri.scheme == "file") {
      val source = File(requireNotNull(uri.path)).canonicalFile
      val cache = context.cacheDir.canonicalFile
      require(source.path.startsWith(cache.path + File.separator) && source.isFile) { "Choose the audio file through Android's file picker." }
    }
    val importEpoch = T1ArcGlucosePublicationGate.observeCurrent(context) { it }
    val directory = File(context.filesDir, "glucose-alarm-sounds").apply { check(isDirectory || mkdirs()) }
    val id = "custom:${UUID.randomUUID()}"
    val destination = File(directory, id.removePrefix("custom:"))
    val temporary = File(directory, "import-${UUID.randomUUID()}.tmp")
    try {
      context.contentResolver.openInputStream(uri).use { input ->
        requireNotNull(input) { "The audio file could not be opened." }
        FileOutputStream(temporary).use { output ->
          val buffer = ByteArray(16 * 1024); var total = 0
          while (true) { val count = input.read(buffer); if (count < 0) break; total += count
            require(total <= MAX_SOUND_BYTES) { "Choose an audio file smaller than 10 MB." }; output.write(buffer, 0, count) }
          require(total > 0) { "The audio file is empty." }
        }
      }
      val metadata = MediaMetadataRetriever()
      try {
        metadata.setDataSource(temporary.absolutePath)
        val duration = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0
        val audio = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO)
        val video = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO)
        require(duration in 100L..60_000L && audio == "yes" && video != "yes") { "Choose a playable audio-only file lasting between 0.1 seconds and 1 minute." }
      } finally { metadata.release() }
      check(temporary.renameTo(destination)) { "The audio file could not be kept on this phone." }
      return T1ArcGlucosePublicationGate.mutateForEpoch(context, importEpoch.toDouble()) { _ -> synchronized(lock) {
        val name = displayName.filter { !it.isISOControl() }.take(100).ifBlank { "Custom sound" }
        val rows = load(context).optJSONArray("sounds") ?: JSONArray()
        require(rows.length() < 24) { "Up to 24 custom alarm sounds can be stored." }
        rows.put(JSONObject().put("id", id).put("name", name))
        load(context).put("sounds", rows)
        persist(context)
        mapOf("id" to id, "name" to name)
      } }
    } catch (error: Exception) { destination.delete(); throw error } finally { temporary.delete() }
  }

  private fun soundFile(context: Context, id: String): File {
    if (id == "pulse" || id == "notes") {
      val file = File(context.cacheDir, "glucose-alarm-$id-v1.wav")
      if (!file.exists()) file.writeBytes(glucoseAlarmWave(id == "notes"))
      return file
    }
    require(id.matches(Regex("custom:[a-f0-9-]{36}")))
    return File(File(context.filesDir, "glucose-alarm-sounds"), id.removePrefix("custom:"))
  }

  fun preview(context: Context, id: String, volume: Double, visible: Boolean): Boolean = synchronized(lock) {
    require(visible) { "Open T1 Arc to play a sound preview." }
    require(volume.isFinite() && volume in 0.0..1.0)
    require(activePlaybackEpisode == null) { "Stop or snooze the current alarm before previewing a sound." }
    require(soundFile(context, id).exists()) { "That sound is unavailable." }
    startPlaybackLocked(context, id, volume.toFloat(), 0.6, null, true)
    true
  }

  fun stopPreview(context: Context): Boolean = synchronized(lock) { if (previewActive) stopPlaybackLocked(context); true }

  fun activityLeft(context: Context) = synchronized(lock) { if (previewActive) stopPlaybackLocked(context) }

  /** Serializes the privacy commit with posting; hiding values never acknowledges audio. */
  fun updatePrivacy(context: Context, mutation: () -> Unit) = synchronized(lock) {
    mutation()
    val wasPosted = notificationFingerprint != null || context.getSystemService(NotificationManager::class.java)
      .activeNotifications.any { it.id == ALARM_NOTIFICATION }
    if (wasPosted) {
      load(context)
      notificationFingerprint = null
      if (episode == null) cancelNotification(context)
      else notify(context, T1ArcGlucoseDisplayState.snapshot(context))
    }
  }

  private fun startPlaybackLocked(context: Context, id: String, volume: Float, rampSeconds: Double, episodeId: String?, preview: Boolean) {
    stopPlaybackLocked(context)
    previewActive = preview
    activePlaybackEpisode = episodeId
    val token = playbackGeneration
    handler.post {
      synchronized(lock) {
        if (token != playbackGeneration || (!preview && (episode?.id != episodeId || !armedInProcess))) return@synchronized
        try {
          if (!preview && !GlucoseAlarmPolicy.canDeliver(NotificationManagerCompat.from(context).areNotificationsEnabled(),
              notificationChannelAllowed(context), true, T1ArcGlucoseDisplayService.running)) error("Alarm notifications or monitor unavailable")
          if (!preview && !T1ArcGlucoseDisplayService.setAlarmPlaybackForeground(context, true)) error("Foreground alarm playback unavailable")
          val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
          val manager = context.getSystemService(AudioManager::class.java)
          val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(attributes)
            .setOnAudioFocusChangeListener { change -> if (change <= AudioManager.AUDIOFOCUS_LOSS) synchronized(lock) {
              if (token == playbackGeneration) { stopPlaybackLocked(context); playbackState = "blocked" }
            } }.build()
          if (manager.requestAudioFocus(request) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) error("Alarm audio focus unavailable")
          focus = request
          val media = MediaPlayer()
          player = media
          media.setAudioAttributes(attributes)
          media.setDataSource(soundFile(context, id).absolutePath)
          media.isLooping = !preview
          media.setVolume(0f, 0f)
          media.setOnPreparedListener {
            synchronized(lock) {
              if (token != playbackGeneration || player !== media) return@synchronized
              try {
                media.start()
                playbackState = "playing"
                if (!preview) wakeLock = context.getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,
                  "T1 Arc:GlucoseAlarm").apply { acquire(65_000L) }
                rampVolume(context, media, token, volume, rampSeconds)
                handler.postDelayed({ synchronized(lock) { if (token == playbackGeneration) stopPlaybackLocked(context) } }, if (preview) 6_000L else 60_000L)
              } catch (_: Exception) { stopPlaybackLocked(context); playbackState = "blocked" }
            }
          }
          media.setOnCompletionListener { synchronized(lock) { if (token == playbackGeneration) stopPlaybackLocked(context) } }
          media.setOnErrorListener { _, _, _ -> synchronized(lock) {
            if (token == playbackGeneration) { stopPlaybackLocked(context); playbackState = "blocked" }
          }; true }
          media.prepareAsync()
        } catch (_: Exception) { stopPlaybackLocked(context); playbackState = "blocked" }
      }
    }
  }

  private fun rampVolume(context: Context, media: MediaPlayer, token: Long, target: Float, seconds: Double) {
    val started = SystemClock.elapsedRealtime()
    val duration = (seconds * 1000).toLong().coerceAtLeast(50L)
    val ramp = object : Runnable {
      override fun run() { synchronized(lock) {
        if (token != playbackGeneration || player !== media) return
        val fraction = ((SystemClock.elapsedRealtime() - started).toFloat() / duration).coerceIn(0f, 1f)
        runCatching { media.setVolume(target * fraction, target * fraction) }.onFailure { stopPlaybackLocked(context); playbackState = "blocked" }
        if (fraction < 1f && token == playbackGeneration) handler.postDelayed(this, 50L)
      } }
    }
    handler.post(ramp)
  }

  private fun stopPlaybackLocked(context: Context) {
    playbackGeneration++
    val old = player; player = null
    runCatching { old?.setVolume(0f, 0f) }
    runCatching { old?.stop() }
    runCatching { old?.release() }
    focus?.let { runCatching { context.getSystemService(AudioManager::class.java).abandonAudioFocusRequest(it) } }
    focus = null
    wakeLock?.let { if (it.isHeld) it.release() }; wakeLock = null
    if (!previewActive) handler.post { T1ArcGlucoseDisplayService.setAlarmPlaybackForeground(context, false) }
    previewActive = false
    activePlaybackEpisode = null
    playbackState = "idle"
  }

  private fun cancelNotification(context: Context) { context.getSystemService(NotificationManager::class.java).cancel(ALARM_NOTIFICATION); notificationFingerprint = null }

  private fun ensureNotificationChannel(context: Context) {
    context.getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(ALARM_CHANNEL, "Glucose alarms", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "Low, high, very high and missing glucose warnings. Sound is controlled in T1 Arc."
      setSound(null, null); enableVibration(false); lockscreenVisibility = Notification.VISIBILITY_PRIVATE
    })
  }

  private fun notificationChannelAllowed(context: Context): Boolean =
    context.getSystemService(NotificationManager::class.java).getNotificationChannel(ALARM_CHANNEL)?.importance
      ?.let { it != NotificationManager.IMPORTANCE_NONE } == true

  private fun notify(context: Context, snapshot: GlucoseDisplaySnapshot?) {
    val current = episode ?: return
    val manager = context.getSystemService(NotificationManager::class.java)
    ensureNotificationChannel(context)
    val private = !T1ArcGlucoseDisplayState.lockScreenVisible(context)
    val snoozed = (current.snoozeUntilElapsed ?: 0) > SystemClock.elapsedRealtime() && current.bootCount == boot(context)
    val title = if (private) "T1 Arc glucose alarm" else when (current.kind) {
      GlucoseAlarmKind.LOW -> "Low glucose"; GlucoseAlarmKind.HIGH -> "High glucose"
      GlucoseAlarmKind.VERY_HIGH -> "Very high glucose"; GlucoseAlarmKind.STALE -> "Glucose updates missing"
    }
    val text = if (private) "Open T1 Arc to review your alarm." else if (missing) "New readings are missing. Recovery has not been confirmed."
      else if (snoozed) "Snoozed. Open T1 Arc to review or change the end time."
      else if (current.acknowledged) "Acknowledged. Glucose has not yet returned to range."
      else snapshot?.let { "${T1ArcGlucoseDisplayState.displayGlucoseValue(context, it.mmolL)} ${T1ArcGlucoseDisplayState.displayGlucoseUnit(context)} · Open T1 Arc to review." } ?: "Open T1 Arc to review."
    val fingerprint = "${current.id}:$title:$text:${snapshot?.timestampMs}"
    if (fingerprint == notificationFingerprint) return
    val launch = PendingIntent.getActivity(context, 6440, Intent(Intent.ACTION_VIEW, Uri.parse(T1ArcAppLinks.TODAY))
      .setPackage(context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    fun action(action: String, code: Int) = PendingIntent.getBroadcast(context, code, Intent(context, T1ArcGlucoseAlarmReceiver::class.java)
      .setAction(action).setData(Uri.parse("t1arc://alarm/${current.id}/$code")).putExtra("episodeId", current.id), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val notification = Notification.Builder(context, ALARM_CHANNEL).setSmallIcon(R.drawable.t1arc_notification_pulse)
      .setContentTitle(title).setContentText(text).setStyle(Notification.BigTextStyle().bigText(text)).setContentIntent(launch)
      .setCategory(Notification.CATEGORY_ALARM).setVisibility(Notification.VISIBILITY_PRIVATE).setOnlyAlertOnce(true)
      .setOngoing(true).setShowWhen(false)
      .addAction(Notification.Action.Builder(null, "Acknowledge", action(ACTION_ALARM_ACK, 6441)).build())
      .addAction(Notification.Action.Builder(null, "Snooze 10 min", action(ACTION_ALARM_SNOOZE, 6442)).build())
      .build()
    runCatching { manager.notify(ALARM_NOTIFICATION, notification) }.onSuccess { notificationFingerprint = fingerprint }
  }

  private fun schedule(context: Context, elapsedDeadline: Long?) {
    val manager = context.getSystemService(AlarmManager::class.java)
    val pending = PendingIntent.getBroadcast(context, 6443, Intent(context, T1ArcGlucoseAlarmReceiver::class.java).setAction(ACTION_ALARM_TICK),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    manager.cancel(pending)
    if (elapsedDeadline == null) return
    if (Build.VERSION.SDK_INT < 31 || manager.canScheduleExactAlarms()) manager.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, elapsedDeadline, pending)
    else manager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, elapsedDeadline, pending)
  }
}

class T1ArcGlucoseAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val pending = goAsync()
    Thread {
      try {
        when (intent?.action) {
          ACTION_ALARM_TICK -> T1ArcGlucoseAlarmEngine.reconcile(context)
          ACTION_ALARM_ACK -> intent.getStringExtra("episodeId")?.let { T1ArcGlucoseAlarmEngine.acknowledge(context, it) }
          ACTION_ALARM_SNOOZE -> intent.getStringExtra("episodeId")?.let { T1ArcGlucoseAlarmEngine.snooze(context, it, (System.currentTimeMillis() + 10 * 60_000L).toDouble()) }
        }
      } catch (_: Exception) { /* Old episode actions and revoked grants fail closed. */ }
      finally { pending.finish() }
    }.start()
  }
}

/** Generated locally, four rounded sine pulses; no downloaded or copyrighted asset. */
internal fun glucoseAlarmWave(twoNotes: Boolean): ByteArray {
  val rate = 22050
  val samples = rate * 4
  val buffer = ByteBuffer.allocate(44 + samples * 2).order(ByteOrder.LITTLE_ENDIAN)
  buffer.put("RIFF".toByteArray()).putInt(36 + samples * 2).put("WAVEfmt ".toByteArray()).putInt(16)
    .putShort(1).putShort(1).putInt(rate).putInt(rate * 2).putShort(2).putShort(16).put("data".toByteArray()).putInt(samples * 2)
  repeat(samples) { i ->
    val time = i.toDouble() / rate
    val pulse = (time / 0.95).toInt()
    val within = time - pulse * 0.95
    val envelope = if (pulse > 3 || within >= 0.72) 0.0 else min(1.0, min(within / 0.05, (0.72 - within) / 0.15)).coerceAtLeast(0.0)
    val frequency = if (twoNotes && pulse % 2 == 0) 440 else 520
    buffer.putShort((sin(2 * PI * frequency * time) * envelope * 16000).toInt().toShort())
  }
  return buffer.array()
}
