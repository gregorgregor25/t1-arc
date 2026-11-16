package io.github.gregorgregor25.t1arc.glucosedisplay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
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

/**
 * AAPS's xDrip+ sync plugin (Config Builder > Synchronization > xDrip+)
 * broadcasts boluses, carbs, extended boluses, temporary targets, profile
 * switches and therapy events as Nightscout-shaped JSON to every app with a
 * receiver for this action. T1 Arc only reads them; it never sends anything
 * back to AAPS and cannot control the pump.
 */
internal const val AAPS_TREATMENT_ACTION = "info.nightscout.client.NEW_FOOD"
private const val AAPS_TREATMENT_SENDER = "info.nightscout.androidaps"
private const val TREATMENT_STORE_NAME = "t1arc_glucose_display"
private const val TREATMENT_EPOCH_KEY = "glucose_publication_epoch_v1"
private const val TREATMENT_QUEUE_KEY = "aaps_treatment_queue_encrypted_v1"
private const val TREATMENT_QUEUE_IV_KEY = "aaps_treatment_queue_iv_v1"
private const val TREATMENT_QUEUE_ALIAS = "t1arc.aaps-treatments.queue.v1"
private const val TREATMENT_OVERFLOW_KEY = "aaps_treatment_queue_overflow_v1"
private const val MAX_TREATMENT_QUEUE_SIZE = 5_000

/** One accepted AAPS treatment. Field values are String, Double, Long or Boolean only. */
internal data class AapsLocalTreatment(
  val id: String,
  val receivedAt: Long,
  val writeEpoch: Long,
  val selectionGeneration: Long,
  val fields: Map<String, Any>,
) {
  fun asMap(): Map<String, Any> = mapOf(
    "id" to id,
    "receivedAt" to receivedAt.toDouble(),
    "writeEpoch" to writeEpoch.toDouble(),
    "selectionGeneration" to selectionGeneration.toDouble(),
    "treatment" to fields.mapValues { (_, value) -> if (value is Long) value.toDouble() else value },
  )

  fun toJson(): JSONObject = JSONObject()
    .put("id", id)
    .put("receivedAt", receivedAt)
    .put("writeEpoch", writeEpoch)
    .put("selectionGeneration", selectionGeneration)
    .put("treatment", JSONObject().also { json -> fields.forEach { (key, value) -> json.put(key, value) } })

  companion object {
    fun fromJson(value: JSONObject): AapsLocalTreatment? = runCatching {
      val id = value.getString("id")
      val receivedAt = value.getLong("receivedAt")
      val epoch = value.getLong("writeEpoch")
      val generation = value.getLong("selectionGeneration")
      if (id.isBlank() || receivedAt <= 0L || epoch < 0L || generation < 0L) return null
      // Stored rows pass the same checks again, so a damaged row is dropped.
      val fields = AapsTreatmentPolicy.sanitizeRow(jsonFields(value.getJSONObject("treatment")), receivedAt)
        ?: return null
      AapsLocalTreatment(id, receivedAt, epoch, generation, fields)
    }.getOrNull()
  }
}

/** Primitive top-level values only; nested objects such as profileJson are dropped. */
internal fun jsonFields(value: JSONObject): Map<String, Any?> {
  val result = LinkedHashMap<String, Any?>()
  val keys = value.keys()
  while (keys.hasNext()) {
    val key = keys.next()
    when (val field = value.opt(key)) {
      is String, is Boolean, is Int, is Long, is Double, is Float -> result[key] = field
      else -> Unit
    }
  }
  return result
}

/** Android-free checks used by the receiver and by unit tests. */
internal object AapsTreatmentPolicy {
  const val MAX_PAYLOAD_CHARS = 512 * 1024
  const val MAX_RECORDS_PER_BROADCAST = 200
  private const val MAX_AGE_MS = 7L * 24 * 60 * 60_000L
  private const val MAX_CLOCK_SKEW_MS = 2 * 60_000L
  private const val MIN_TIMESTAMP = 1_577_836_800_000L
  private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L

  private val insulinEvents = setOf(
    "Meal Bolus", "Correction Bolus", "Snack Bolus", "Bolus Wizard", "Carb Correction",
  )
  private val contextEvents = setOf(
    "Temporary Target", "Profile Switch", "Site Change", "Insulin Change",
    "Pump Battery Change", "Sensor Change", "Sensor Start",
  )
  private val numberRanges = mapOf(
    "insulin" to 0.0..100.0,
    "carbs" to 0.0..1_000.0,
    "duration" to 0.0..1_440.0,
    "durationInMilliseconds" to 0.0..86_400_000.0,
    "enteredinsulin" to 0.0..100.0,
    "splitNow" to 0.0..100.0,
    "splitExt" to 0.0..100.0,
    "relative" to 0.0..100.0,
    "targetTop" to 0.0..400.0,
    "targetBottom" to 0.0..400.0,
    "percentage" to 1.0..1_000.0,
  )
  private val textLimits = mapOf("notes" to 240, "reason" to 80, "profile" to 80, "pumpType" to 40)
  private val booleans = setOf("isValid", "isSMB", "isEmulatingTempBasal")

  fun acceptsPayloadLength(length: Int) = length in 1..MAX_PAYLOAD_CHARS

  fun sanitize(
    rows: List<Map<String, Any?>>,
    receivedAt: Long,
    epoch: Long,
    generation: Long,
    newId: () -> String = { UUID.randomUUID().toString() },
  ): List<AapsLocalTreatment> {
    if (receivedAt <= 0L || epoch < 0L || generation < 0L) return emptyList()
    return rows.take(MAX_RECORDS_PER_BROADCAST).mapNotNull { row ->
      sanitizeRow(row, receivedAt)?.let { AapsLocalTreatment(newId(), receivedAt, epoch, generation, it) }
    }
  }

  private fun number(value: Any?): Double? =
    (value as? Number)?.toDouble()?.takeIf(Double::isFinite)

  private fun timestamp(value: Any?): Long? {
    val number = number(value) ?: return null
    if (number % 1.0 != 0.0) return null
    return number.toLong().takeIf { it in MIN_TIMESTAMP..MAX_SAFE_INTEGER }
  }

  private fun text(value: Any?, limit: Int): String? =
    (value as? String)?.filter { it >= ' ' }?.trim()?.take(limit)?.takeIf(String::isNotEmpty)

  /** Returns only listed fields, plus a stable identifier, or null when the row is not a supported treatment. */
  fun sanitizeRow(row: Map<String, Any?>, receivedAt: Long): Map<String, Any>? {
    val eventType = text(row["eventType"], 40) ?: return null
    val time = timestamp(row["date"]) ?: timestamp(row["timestamp"]) ?: timestamp(row["mills"]) ?: return null
    if (time < receivedAt - MAX_AGE_MS || time > receivedAt + MAX_CLOCK_SKEW_MS) return null
    val out = LinkedHashMap<String, Any>()
    out["eventType"] = eventType
    out["date"] = time
    numberRanges.forEach { (key, range) -> number(row[key])?.takeIf { it in range }?.let { out[key] = it } }
    textLimits.forEach { (key, limit) -> text(row[key], limit)?.let { out[key] = it } }
    booleans.forEach { key -> (row[key] as? Boolean)?.let { out[key] = it } }
    (row["type"] as? String)?.takeIf { it in setOf("NORMAL", "SMB", "PRIMING") }?.let { out["type"] = it }
    (row["units"] as? String)?.takeIf { it == "mg/dl" || it == "mmol" }?.let { out["units"] = it }
    number(row["pumpId"])?.takeIf { it >= 0.0 && it % 1.0 == 0.0 && it <= MAX_SAFE_INTEGER }
      ?.let { out["pumpId"] = it.toLong() }

    val insulin = out["insulin"] as? Double
    val carbs = out["carbs"] as? Double
    val kind = when {
      eventType == "Combo Bolus" && out.containsKey("enteredinsulin") -> "extended"
      eventType in insulinEvents && insulin != null -> "bolus"
      eventType in insulinEvents && carbs != null && carbs > 0.0 -> "carbs"
      eventType in contextEvents -> eventType.lowercase().replace(' ', '-')
      else -> return null
    }
    // AAPS sends carb duration in milliseconds; it is not a treatment duration here.
    if (kind == "carbs" || kind == "bolus") {
      out.remove("duration")
      out.remove("durationInMilliseconds")
    }
    // AAPS has no stable local ID in this broadcast. A record keeps its time
    // when edited or deleted, so kind and time identify it.
    out["identifier"] = "$kind-$time"
    return out
  }
}

/** Keystore-encrypted queue, bound to the AAPS selection and privacy epoch. */
internal object AapsTreatmentStore {
  private val lock = Any()

  private fun preferences(context: Context) =
    context.getSharedPreferences(TREATMENT_STORE_NAME, Context.MODE_PRIVATE)

  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(TREATMENT_QUEUE_ALIAS, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder(TREATMENT_QUEUE_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true)
        .build())
    }.generateKey()
  }

  private fun queue(context: Context): List<AapsLocalTreatment> {
    val prefs = preferences(context)
    val payload = prefs.getString(TREATMENT_QUEUE_KEY, null) ?: return emptyList()
    val iv = prefs.getString(TREATMENT_QUEUE_IV_KEY, null) ?: return emptyList()
    return try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
      val decrypted = cipher.doFinal(Base64.decode(payload, Base64.NO_WRAP))
      val rows = JSONArray(GZIPInputStream(ByteArrayInputStream(decrypted)).bufferedReader().use { it.readText() })
      (0 until rows.length()).mapNotNull { rows.optJSONObject(it)?.let(AapsLocalTreatment::fromJson) }
    } catch (_: Exception) {
      // A damaged or undecryptable queue cannot be treated as trustworthy data.
      emptyList()
    }
  }

  private fun save(context: Context, treatments: List<AapsLocalTreatment>, overflow: Long = 0L) {
    val prefs = preferences(context)
    val editor = prefs.edit()
    if (treatments.isEmpty()) {
      editor.remove(TREATMENT_QUEUE_KEY).remove(TREATMENT_QUEUE_IV_KEY)
    } else {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, key())
      val compressed = ByteArrayOutputStream()
      GZIPOutputStream(compressed).use { stream ->
        stream.write(JSONArray(treatments.map(AapsLocalTreatment::toJson)).toString().toByteArray(Charsets.UTF_8))
      }
      editor.putString(TREATMENT_QUEUE_KEY, Base64.encodeToString(cipher.doFinal(compressed.toByteArray()), Base64.NO_WRAP))
      editor.putString(TREATMENT_QUEUE_IV_KEY, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
    }
    if (overflow > 0L) {
      editor.putLong(TREATMENT_OVERFLOW_KEY, prefs.getLong(TREATMENT_OVERFLOW_KEY, 0L) + overflow)
    }
    check(editor.commit()) { "AAPS treatments could not be saved securely." }
  }

  private fun current(context: Context, generation: Long) =
    AapsLocalStore.selectedSource(context) == AAPS_SOURCE_ID && AapsLocalStore.generation(context) == generation

  fun append(context: Context, treatments: List<AapsLocalTreatment>, epoch: Long, generation: Long): Boolean =
    synchronized(lock) {
      if (treatments.isEmpty() || !current(context, generation)) return false
      if (treatments.any { it.writeEpoch != epoch || it.selectionGeneration != generation }) return false
      // Rows from an earlier selection or privacy epoch are never kept.
      val kept = queue(context).filter { it.writeEpoch == epoch && it.selectionGeneration == generation }
      val combined = kept + treatments
      val overflow = (combined.size - MAX_TREATMENT_QUEUE_SIZE).coerceAtLeast(0)
      save(context, combined.takeLast(MAX_TREATMENT_QUEUE_SIZE), overflow.toLong())
      true
    }

  fun peek(context: Context, limit: Int, epoch: Long): List<AapsLocalTreatment> = synchronized(lock) {
    if (AapsLocalStore.selectedSource(context) != AAPS_SOURCE_ID) return emptyList()
    val generation = AapsLocalStore.generation(context)
    queue(context).filter { it.selectionGeneration == generation && it.writeEpoch == epoch }
      .take(limit.coerceIn(0, MAX_TREATMENT_QUEUE_SIZE))
  }

  fun acknowledge(context: Context, ids: Set<String>, generation: Long, epoch: Long): Boolean = synchronized(lock) {
    if (!current(context, generation)) return false
    save(context, queue(context).filter {
      it.selectionGeneration == generation && it.writeEpoch == epoch && !ids.contains(it.id)
    })
    true
  }

  fun status(context: Context, epoch: Long): Map<String, Any> = mapOf(
    "supported" to true,
    "bufferedCount" to peek(context, MAX_TREATMENT_QUEUE_SIZE, epoch).size,
    "droppedCount" to preferences(context).getLong(TREATMENT_OVERFLOW_KEY, 0L).toDouble(),
  )

  /** A different glucose source was chosen; queued AAPS treatments are no longer wanted. */
  fun clearForSelectionChange(context: Context) = synchronized(lock) {
    check(preferences(context).edit().remove(TREATMENT_QUEUE_KEY).remove(TREATMENT_QUEUE_IV_KEY)
      .remove(TREATMENT_OVERFLOW_KEY).commit()) { "Queued AAPS treatments could not be cleared." }
  }

  /** Called in the same commit that advances the privacy epoch. */
  fun clearForErase(editor: SharedPreferences.Editor) {
    editor.remove(TREATMENT_QUEUE_KEY).remove(TREATMENT_QUEUE_IV_KEY).remove(TREATMENT_OVERFLOW_KEY)
  }
}

private val AAPS_TREATMENT_EXECUTOR = Executors.newSingleThreadExecutor()

class T1ArcAapsTreatmentReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (intent?.action != AAPS_TREATMENT_ACTION) return
    if (AapsLocalStore.selectedSource(context) != AAPS_SOURCE_ID) return
    val capturedGeneration = AapsLocalStore.generation(context)
    val capturedEpoch = context.getSharedPreferences(TREATMENT_STORE_NAME, Context.MODE_PRIVATE)
      .getLong(TREATMENT_EPOCH_KEY, 0L)
    // Other apps use this action too. Android 14+ names the sender, so only
    // AAPS is accepted there; older versions cannot tell, so every field is
    // checked and nothing received is ever used for control.
    if (Build.VERSION.SDK_INT >= 34) {
      val uid = sentFromUid
      if (uid >= 0) {
        val packages = context.packageManager.getPackagesForUid(uid) ?: emptyArray()
        if (AAPS_TREATMENT_SENDER !in packages) return
      }
    }
    val payload = intent.getStringExtra("treatments") ?: return
    if (!AapsTreatmentPolicy.acceptsPayloadLength(payload.length)) return
    val pending = goAsync()
    AAPS_TREATMENT_EXECUTOR.execute {
      try {
        val rows = JSONArray(payload)
        val maps = (0 until minOf(rows.length(), AapsTreatmentPolicy.MAX_RECORDS_PER_BROADCAST))
          .mapNotNull { rows.optJSONObject(it)?.let(::jsonFields) }
        T1ArcGlucosePublicationGate.observeCurrent(context) { epoch ->
          val generation = AapsLocalStore.generation(context)
          if (AapsStatusPolicy.acceptsCaptured(capturedEpoch, capturedGeneration,
              epoch, generation, AapsLocalStore.selectedSource(context))) {
            val treatments = AapsTreatmentPolicy.sanitize(maps, System.currentTimeMillis(), epoch, generation)
            AapsTreatmentStore.append(context, treatments, epoch, generation)
          }
        }
      } catch (_: Exception) {
        // No private payloads, pump state, or health values enter system logs.
      } finally {
        pending.finish()
      }
    }
  }
}
