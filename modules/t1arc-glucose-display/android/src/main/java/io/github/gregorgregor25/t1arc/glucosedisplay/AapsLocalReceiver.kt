package io.github.gregorgregor25.t1arc.glucosedisplay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.Executors
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONArray
import org.json.JSONObject

internal const val AAPS_SOURCE_ID = "aaps-local"
private const val AAPS_PACKAGE = "info.nightscout.androidaps"
private const val AAPS_ACTION = "info.nightscout.androidaps.status"
private const val STORE_NAME = "t1arc_glucose_display"
private const val SOURCE_KEY = "local_glucose_source_v1"
private const val GENERATION_KEY = "local_glucose_source_generation_v1"
private const val QUEUE_KEY = "aaps_status_queue_encrypted_v1"
private const val QUEUE_IV_KEY = "aaps_status_queue_iv_v1"
private const val QUEUE_ALIAS = "t1arc.aaps-status.queue.v1"
private const val OVERFLOW_COUNT_KEY = "aaps_status_queue_overflow_v1"
private const val LATEST_KEY = "aaps_status_latest_encrypted_v1"
private const val LATEST_IV_KEY = "aaps_status_latest_iv_v1"
// At one broadcast per minute this retains seven days while JS is unavailable.
private const val MAX_QUEUE_SIZE = 10_080
private const val MAX_JS_SAFE_INTEGER = 9_007_199_254_740_991L
private const val MAX_CLOCK_SKEW_MS = 2 * 60_000L

/** AAPS's status broadcast is a snapshot of independently optional values. */
internal data class AapsLocalReading(
  val id: String,
  val receivedAt: Long,
  val writeEpoch: Long,
  val selectionGeneration: Long,
  val glucoseMgdl: Double? = null,
  val glucoseTimestamp: Long? = null,
  val trend: String? = null,
  val rawTrend: String? = null,
  val deltaMgdl: Double? = null,
  val avgDeltaMgdl: Double? = null,
  val iobUnits: Double? = null,
  val bolusIobUnits: Double? = null,
  val basalIobUnits: Double? = null,
  val cobGrams: Double? = null,
  val futureCarbsGrams: Double? = null,
  val displayUnits: String? = null,
) {
  fun asMap(): Map<String, Any> = buildMap {
    put("id", id)
    put("receivedAt", receivedAt.toDouble())
    put("writeEpoch", writeEpoch.toDouble())
    put("selectionGeneration", selectionGeneration.toDouble())
    glucoseMgdl?.let { put("glucoseMgdl", it) }
    glucoseTimestamp?.let { put("glucoseTimestamp", it.toDouble()) }
    trend?.let { put("trend", it) }
    rawTrend?.let { put("rawTrend", it) }
    deltaMgdl?.let { put("deltaMgdl", it) }
    avgDeltaMgdl?.let { put("avgDeltaMgdl", it) }
    iobUnits?.let { put("iobUnits", it) }
    bolusIobUnits?.let { put("bolusIobUnits", it) }
    basalIobUnits?.let { put("basalIobUnits", it) }
    cobGrams?.let { put("cobGrams", it) }
    futureCarbsGrams?.let { put("futureCarbsGrams", it) }
    displayUnits?.let { put("displayUnits", it) }
  }

  fun toJson(): JSONObject = JSONObject(asMap())

  companion object {
    fun fromJson(value: JSONObject): AapsLocalReading? = runCatching {
      val id = value.getString("id")
      val receivedAt = value.getLong("receivedAt")
      val epoch = value.getLong("writeEpoch")
      val generation = value.getLong("selectionGeneration")
      if (id.isBlank() || receivedAt <= 0L || epoch < 0L || generation < 0L) return null
      fun number(name: String): Double? = value.optDouble(name, Double.NaN).takeIf(Double::isFinite)
      AapsLocalReading(
        id = id, receivedAt = receivedAt, writeEpoch = epoch,
        selectionGeneration = generation,
        glucoseMgdl = number("glucoseMgdl"),
        glucoseTimestamp = value.optLong("glucoseTimestamp", 0).takeIf { it > 0L },
        trend = value.optString("trend").takeIf(String::isNotBlank),
        rawTrend = value.optString("rawTrend").takeIf(String::isNotBlank),
        deltaMgdl = number("deltaMgdl"), avgDeltaMgdl = number("avgDeltaMgdl"),
        iobUnits = number("iobUnits"), bolusIobUnits = number("bolusIobUnits"),
        basalIobUnits = number("basalIobUnits"), cobGrams = number("cobGrams"),
        futureCarbsGrams = number("futureCarbsGrams"),
        displayUnits = value.optString("displayUnits").takeIf(String::isNotBlank),
      )
    }.getOrNull()
  }
}

/** Do not infer an absent AAPS field from a default Bundle getter. */
internal object AapsBroadcastParser {
  private val trendLabels = mapOf(
    "TripleDown" to "tripleDown",
    "DoubleDown" to "doubleDown", "SingleDown" to "down",
    "FortyFiveDown" to "slightDown", "Flat" to "flat",
    "FortyFiveUp" to "slightUp", "SingleUp" to "up",
    "DoubleUp" to "doubleUp",
    "TripleUp" to "tripleUp",
  )

  private val fields = listOf(
    "glucoseMgdl", "glucoseTimeStamp", "slopeArrow", "deltaMgdl", "avgDeltaMgdl",
    "iob", "bolusIob", "basalIob", "cob", "futureCarbs", "units",
  )

  fun parse(extras: Bundle, receivedAt: Long, epoch: Long, generation: Long): AapsLocalReading? =
    parseFields(fields.filter { extras.containsKey(it) }.associateWith { extras.get(it) },
      receivedAt, epoch, generation)

  /** Android-free validation also used by exact AAPS wire-contract tests. */
  fun parseFields(extras: Map<String, Any?>, receivedAt: Long, epoch: Long, generation: Long): AapsLocalReading? {
    if (receivedAt <= 0L || epoch < 0L || generation < 0L) return null
    fun number(name: String): Double? {
      val value = (extras[name] as? Number)?.toDouble() ?: return null
      return value.takeIf(Double::isFinite)
    }
    val glucose = number("glucoseMgdl")?.takeIf { it in 9.008..720.64 }
    val time = (extras["glucoseTimeStamp"] as? Long)?.takeIf {
      it >= 1_577_836_800_000L && it <= MAX_JS_SAFE_INTEGER && it <= receivedAt + MAX_CLOCK_SKEW_MS
    }
    val validGlucose = if (glucose != null && time != null) glucose else null
    val validTime = if (validGlucose != null) time else null
    val rawTrend = if (validGlucose != null) (extras["slopeArrow"] as? String)?.take(40) else null
    val trend = trendLabels[rawTrend]
    val iob = number("iob")?.takeIf { it in -100.0..100.0 }
    val bolus = number("bolusIob")?.takeIf { it in -100.0..100.0 }
    val basal = number("basalIob")?.takeIf { it in -100.0..100.0 }
    // AAPS sends -1 when COB is unavailable. Zero is a valid observed value.
    val cob = number("cob")?.takeIf { it in 0.0..1000.0 }
    val future = number("futureCarbs")?.takeIf { it in 0.0..1000.0 }
    if (validGlucose == null && iob == null && bolus == null && basal == null && cob == null && future == null) return null
    return AapsLocalReading(
      id = UUID.randomUUID().toString(), receivedAt = receivedAt,
      writeEpoch = epoch, selectionGeneration = generation,
      glucoseMgdl = validGlucose, glucoseTimestamp = validTime, trend = trend,
      rawTrend = rawTrend,
      deltaMgdl = number("deltaMgdl")?.takeIf { it in -200.0..200.0 },
      avgDeltaMgdl = number("avgDeltaMgdl")?.takeIf { it in -200.0..200.0 },
      iobUnits = iob, bolusIobUnits = bolus, basalIobUnits = basal,
      cobGrams = cob, futureCarbsGrams = future,
      displayUnits = (extras["units"] as? String)?.takeIf { it == "mg/dl" || it == "mmol" },
    )
  }
}

/** Keystore-backed queue. Selection metadata is harmless plaintext; values never are. */
internal object AapsLocalStore {
  private fun preferences(context: Context) = context.getSharedPreferences(STORE_NAME, Context.MODE_PRIVATE)

  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(QUEUE_ALIAS, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder(QUEUE_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true)
        .build())
    }.generateKey()
  }

  fun selectedSource(context: Context): String? = preferences(context).getString(SOURCE_KEY, null)
  fun generation(context: Context): Long = preferences(context).getLong(GENERATION_KEY, 0L)

  fun clearForErase(context: Context, editor: android.content.SharedPreferences.Editor) {
    editor.remove(SOURCE_KEY)
      .putLong(GENERATION_KEY, generation(context) + 1L)
      .remove(QUEUE_KEY).remove(QUEUE_IV_KEY).remove(LATEST_KEY).remove(LATEST_IV_KEY)
      .remove(OVERFLOW_COUNT_KEY)
  }

  fun select(context: Context, sourceId: String): Long {
    require(sourceId.isNotBlank() && sourceId.length <= 80)
    val existing = selectedSource(context)
    if (existing == sourceId) return generation(context)
    val next = generation(context) + 1L
    check(next in 1..MAX_JS_SAFE_INTEGER)
    check(preferences(context).edit().putString(SOURCE_KEY, sourceId)
      .putLong(GENERATION_KEY, next).remove(QUEUE_KEY).remove(QUEUE_IV_KEY)
      .remove(LATEST_KEY).remove(LATEST_IV_KEY).remove(OVERFLOW_COUNT_KEY).commit()) {
      "AAPS source selection could not be saved."
    }
    return next
  }

  private fun queue(context: Context): List<AapsLocalReading> {
    val prefs = preferences(context)
    val payload = prefs.getString(QUEUE_KEY, null) ?: return emptyList()
    val iv = prefs.getString(QUEUE_IV_KEY, null) ?: return emptyList()
    return try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
      val decrypted = cipher.doFinal(Base64.decode(payload, Base64.NO_WRAP))
      val rows = JSONArray(GZIPInputStream(ByteArrayInputStream(decrypted)).bufferedReader().use { it.readText() })
      (0 until rows.length()).mapNotNull { rows.optJSONObject(it)?.let(AapsLocalReading::fromJson) }
    } catch (_: Exception) {
      // A damaged or undecryptable queue cannot be treated as trustworthy data.
      emptyList()
    }
  }

  private fun save(context: Context, readings: List<AapsLocalReading>) {
    val editor = preferences(context).edit()
    if (readings.isEmpty()) {
      editor.remove(QUEUE_KEY).remove(QUEUE_IV_KEY)
    } else {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, key())
      val compressed = ByteArrayOutputStream()
      GZIPOutputStream(compressed).use { stream ->
        stream.write(JSONArray(readings.map(AapsLocalReading::toJson)).toString().toByteArray(Charsets.UTF_8))
      }
      val bytes = compressed.toByteArray()
      editor.putString(QUEUE_KEY, Base64.encodeToString(cipher.doFinal(bytes), Base64.NO_WRAP))
      editor.putString(QUEUE_IV_KEY, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
    }
    check(editor.commit()) { "AAPS local status could not be saved securely." }
  }

  private fun latest(context: Context): AapsLocalReading? {
    val prefs = preferences(context)
    val payload = prefs.getString(LATEST_KEY, null) ?: return null
    val iv = prefs.getString(LATEST_IV_KEY, null) ?: return null
    return try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
      AapsLocalReading.fromJson(JSONObject(String(cipher.doFinal(Base64.decode(payload, Base64.NO_WRAP)), Charsets.UTF_8)))
    } catch (_: Exception) { null }
  }

  private fun saveLatest(context: Context, reading: AapsLocalReading) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val payload = Base64.encodeToString(cipher.doFinal(reading.toJson().toString().toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    check(preferences(context).edit().putString(LATEST_KEY, payload)
      .putString(LATEST_IV_KEY, Base64.encodeToString(cipher.iv, Base64.NO_WRAP)).commit()) {
      "The AAPS latest status could not be saved securely."
    }
  }

  fun append(context: Context, reading: AapsLocalReading): Boolean {
    if (selectedSource(context) != AAPS_SOURCE_ID ||
      reading.selectionGeneration != generation(context)) return false
    val existing = queue(context)
    val last = existing.lastOrNull() ?: latest(context)
    if (AapsStatusPolicy.samePayload(last, reading)) return false
    if (existing.size >= MAX_QUEUE_SIZE) {
      val currentOverflow = preferences(context).getLong(OVERFLOW_COUNT_KEY, 0L)
      check(preferences(context).edit().putLong(OVERFLOW_COUNT_KEY, currentOverflow + 1L).commit())
    }
    save(context, (existing + reading).takeLast(MAX_QUEUE_SIZE))
    saveLatest(context, reading)
    return true
  }

  fun peek(context: Context, limit: Int, epoch: Long): List<AapsLocalReading> {
    if (selectedSource(context) != AAPS_SOURCE_ID) return emptyList()
    val generation = generation(context)
    return queue(context).filter { it.selectionGeneration == generation && it.writeEpoch == epoch }
      .take(limit.coerceIn(0, MAX_QUEUE_SIZE))
  }

  fun acknowledge(context: Context, ids: Set<String>, generation: Long, epoch: Long): Boolean {
    if (selectedSource(context) != AAPS_SOURCE_ID || generation != generation(context)) return false
    val current = queue(context)
    save(context, current.filterNot { it.selectionGeneration == generation && it.writeEpoch == epoch && ids.contains(it.id) })
    return true
  }

  fun status(context: Context, epoch: Long): Map<String, Any> = buildMap {
    put("supported", true)
    selectedSource(context)?.let { put("selectedSourceId", it) }
    put("selectionGeneration", generation(context).toDouble())
    put("writeEpoch", epoch.toDouble())
    val readings = peek(context, MAX_QUEUE_SIZE, epoch)
    put("bufferedCount", readings.size)
    put("droppedCount", preferences(context).getLong(OVERFLOW_COUNT_KEY, 0L).toDouble())
    T1ArcGlucoseDisplayState.snapshot(context)
      ?.takeIf { selectedSource(context) == AAPS_SOURCE_ID && it.sourceLabel == "AndroidAPS local" }
      ?.let { put("latestGlucoseTimestamp", it.timestampMs.toDouble()) }
    latest(context)?.takeIf { it.selectionGeneration == generation(context) && it.writeEpoch == epoch }?.let {
      put("lastReceivedAt", it.receivedAt.toDouble())
      put("latest", it.asMap())
    }
  }
}

private val AAPS_RECEIVE_EXECUTOR = Executors.newSingleThreadExecutor()

internal object AapsLocalEvents {
  @Volatile var emit: (() -> Unit)? = null
}

class T1ArcAapsStatusReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (intent?.action != AAPS_ACTION) return
    if (AapsLocalStore.selectedSource(context) != AAPS_SOURCE_ID) return
    val capturedGeneration = AapsLocalStore.generation(context)
    val capturedEpoch = context.getSharedPreferences(STORE_NAME, Context.MODE_PRIVATE)
      .getLong("glucose_publication_epoch_v1", 0L)
    // Android 14+ can identify the sending UID. Older/unknown senders remain
    // unverified, so the payload is always validated and never trusted for control.
    if (Build.VERSION.SDK_INT >= 34) {
      val uid = sentFromUid
      if (uid >= 0) {
        val packages = context.packageManager.getPackagesForUid(uid) ?: emptyArray()
        if (AAPS_PACKAGE !in packages) return
      }
    }
    val extras = intent.extras ?: return
    val pending = goAsync()
    AAPS_RECEIVE_EXECUTOR.execute {
      try {
        var accepted = false
        T1ArcGlucosePublicationGate.observeCurrent(context) { epoch ->
          if (!AapsStatusPolicy.acceptsCaptured(capturedEpoch, capturedGeneration,
              epoch, AapsLocalStore.generation(context),
              AapsLocalStore.selectedSource(context))) return@observeCurrent
          val reading = AapsBroadcastParser.parse(extras, System.currentTimeMillis(), epoch,
            AapsLocalStore.generation(context)) ?: return@observeCurrent
          if (!AapsLocalStore.append(context, reading)) return@observeCurrent
          accepted = true
          if (reading.glucoseMgdl != null && reading.glucoseTimestamp != null) {
            publishAapsLocalReading(context, epoch, reading)
          }
        }
        if (accepted) {
          AapsLocalEvents.emit?.invoke()
          T1ArcGlucoseDisplayService.requestAapsSync(context)
        }
      } catch (_: Exception) {
        // No private payloads, pump state, or health values enter system logs.
      } finally {
        pending.finish()
      }
    }
  }
}
