package io.github.gregorgregor25.t1arc.glucosedisplay

import android.content.Context
import android.content.SharedPreferences
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToLong
import org.json.JSONObject

/**
 * Who calculated an insulin/carbs-on-board estimate. Each one is shown only
 * beside glucose from the same source, so one source's estimate can never sit
 * next to another source's reading.
 */
internal enum class OnBoardProvenance(
  val wireValue: String,
  val glucoseSourceLabel: String,
  val detail: String,
  val spokenDetail: String,
) {
  AAPS("aaps", "AndroidAPS local", "Calculated by AAPS", "Calculated by AAPS"),
  NIGHTSCOUT(
    "nightscout",
    "Nightscout",
    "Calculated by your looping system via Nightscout",
    "Calculated by your looping system via Nightscout",
  );

  companion object {
    fun fromWire(value: String?): OnBoardProvenance? = values().firstOrNull { it.wireValue == value }
  }
}

/**
 * An insulin-on-board and carbs-on-board estimate as reported by the source.
 * IOB may be negative and COB may be zero; both are kept as values. A missing
 * value stays null and is never shown as zero. [receivedAtMs] is when the
 * estimate was received or reported, independent of the glucose timestamp.
 */
internal data class OnBoardEstimate(
  val iobUnits: Double?,
  val cobGrams: Double?,
  val receivedAtMs: Long,
  val provenance: OnBoardProvenance,
  val writeEpoch: Long,
  val selectionGeneration: Long,
)

/** Where an estimate would appear. The lock-screen public version follows glucose privacy. */
internal enum class OnBoardSurface { NOTIFICATION, LOCK_SCREEN_PUBLIC_VERSION, WIDGET }

internal data class OnBoardText(
  /** For example "IOB 1.35 U · COB 20 g", with " · 25 min ago" once stale. */
  val compact: String,
  /** Provenance for expanded surfaces, for example "Calculated by AAPS". */
  val detail: String,
  val spoken: String,
  val stale: Boolean,
)

/** Android-free rules shared by the notification, widget and JVM tests. */
internal object OnBoardEstimatePolicy {
  /** Matches the AAPS card and Nightscout snapshot freshness limit. */
  const val STALE_AFTER_MS = 12 * 60_000L
  /** An estimate this old says little about now, so glance surfaces stop showing it. */
  const val HIDE_AFTER_MS = 60 * 60_000L
  const val FUTURE_TOLERANCE_MS = 2 * 60_000L
  private const val MAX_ABS_IOB_UNITS = 100.0
  private const val MAX_COB_GRAMS = 1000.0

  fun validated(
    iobUnits: Double?,
    cobGrams: Double?,
    receivedAtMs: Long,
    provenance: OnBoardProvenance,
    writeEpoch: Long,
    selectionGeneration: Long,
  ): OnBoardEstimate? {
    val iob = iobUnits?.takeIf { it.isFinite() && abs(it) <= MAX_ABS_IOB_UNITS }
    val cob = cobGrams?.takeIf { it.isFinite() && it >= 0.0 && it <= MAX_COB_GRAMS }
    if (iob == null && cob == null) return null
    if (receivedAtMs <= 0L || writeEpoch < 0L || selectionGeneration < 0L) return null
    return OnBoardEstimate(iob, cob, receivedAtMs, provenance, writeEpoch, selectionGeneration)
  }

  /**
   * A status with neither estimate returns null, so the caller keeps the
   * previous estimate ageing instead of blanking it on an intermittent field.
   */
  fun fromAaps(reading: AapsLocalReading): OnBoardEstimate? =
    validated(reading.iobUnits, reading.cobGrams, reading.receivedAt,
      OnBoardProvenance.AAPS, reading.writeEpoch, reading.selectionGeneration)

  /** Bridge values from JS. Only Nightscout estimates arrive this way. */
  fun fromBridge(
    value: Map<String, Any?>,
    writeEpoch: Long,
    selectionGeneration: Long,
  ): OnBoardEstimate? {
    if (OnBoardProvenance.fromWire(value["provenance"] as? String) != OnBoardProvenance.NIGHTSCOUT) return null
    val receivedAt = (value["receivedAt"] as? Number)?.toDouble() ?: return null
    if (!receivedAt.isFinite() || receivedAt <= 0.0 || receivedAt.toLong().toDouble() != receivedAt) return null
    return validated(
      (value["iobUnits"] as? Number)?.toDouble(),
      (value["cobGrams"] as? Number)?.toDouble(),
      receivedAt.toLong(), OnBoardProvenance.NIGHTSCOUT, writeEpoch, selectionGeneration,
    )
  }

  /** The estimate belongs to the glucose shown, the current privacy epoch and source selection. */
  fun appliesTo(
    estimate: OnBoardEstimate,
    snapshotSourceLabel: String?,
    currentEpoch: Long,
    currentGeneration: Long,
  ): Boolean = snapshotSourceLabel != null &&
    estimate.provenance.glucoseSourceLabel == snapshotSourceLabel &&
    estimate.writeEpoch == currentEpoch &&
    estimate.selectionGeneration == currentGeneration

  /**
   * The redacted lock-screen version never carries more than glucose would:
   * if the value is hidden before unlock, IOB and COB are hidden too.
   */
  fun visibleOn(surface: OnBoardSurface, settingEnabled: Boolean, lockScreenVisible: Boolean): Boolean =
    settingEnabled && when (surface) {
      OnBoardSurface.NOTIFICATION, OnBoardSurface.WIDGET -> true
      OnBoardSurface.LOCK_SCREEN_PUBLIC_VERSION -> lockScreenVisible
    }

  fun present(estimate: OnBoardEstimate, now: Long, locale: Locale): OnBoardText? {
    val ageMs = now - estimate.receivedAtMs
    if (ageMs > HIDE_AFTER_MS || -ageMs > FUTURE_TOLERANCE_MS) return null
    val iob = estimate.iobUnits?.let { formatIob(it, locale) }
    val cob = estimate.cobGrams?.let { formatCob(it, locale) }
    val parts = listOfNotNull(iob?.let { "IOB $it U" }, cob?.let { "COB $it g" })
    if (parts.isEmpty()) return null
    val stale = ageMs > STALE_AFTER_MS
    val minutes = (ageMs.coerceAtLeast(0L) / 60_000L)
    val age = "${RegionalNumberFormatter.integer(minutes, locale)} min ago"
    val spokenParts = listOfNotNull(
      iob?.let { "insulin on board $it units" },
      cob?.let { "carbs on board $it grams" },
    )
    val spoken = spokenParts.joinToString(", ").replaceFirstChar { it.titlecase(locale) } +
      (if (stale) ", estimated $age" else "") + ". ${estimate.provenance.spokenDetail}."
    return OnBoardText(
      compact = parts.joinToString(" · ") + if (stale) " · $age" else "",
      detail = estimate.provenance.detail,
      spoken = spoken,
      stale = stale,
    )
  }

  fun formatIob(value: Double, locale: Locale): String {
    val format = NumberFormat.getNumberInstance(locale).apply {
      minimumFractionDigits = 2
      maximumFractionDigits = 2
      roundingMode = RoundingMode.HALF_UP
    }
    // A tiny negative estimate rounds to zero, never "-0.00".
    return format.format(if (abs(value) < 0.005) 0.0 else value)
  }

  fun formatCob(value: Double, locale: Locale): String =
    RegionalNumberFormatter.integer(value.roundToLong(), locale)
}

/**
 * The latest estimate, Keystore-encrypted like the glucose snapshot and
 * cached in memory. AAPS estimates are written natively by the status
 * receiver; Nightscout estimates arrive from the JS sync.
 */
internal object T1ArcOnBoardEstimateState {
  private const val PAYLOAD_KEY = "on_board_estimate_encrypted_payload_v1"
  private const val IV_KEY = "on_board_estimate_encrypted_iv_v1"
  private const val VISIBLE_KEY = "on_board_estimates_visible_v1"
  // Same preference as T1ArcGlucosePublicationGate and the AAPS receiver.
  private const val EPOCH_KEY = "glucose_publication_epoch_v1"
  private val lock = Any()
  @Volatile private var loaded = false
  @Volatile private var cached: OnBoardEstimate? = null

  private fun preferences(context: Context) = T1ArcGlucoseDisplayState.preferences(context)

  /** On by default; shown only when the source provides an estimate. */
  fun visible(context: Context): Boolean = preferences(context).getBoolean(VISIBLE_KEY, true)

  fun setVisible(context: Context, visible: Boolean) {
    check(preferences(context).edit().putBoolean(VISIBLE_KEY, visible).commit()) {
      "The insulin and carbs on board display setting could not be saved."
    }
  }

  fun current(context: Context): OnBoardEstimate? {
    if (loaded) return cached
    synchronized(lock) {
      if (loaded) return cached
      val stored = preferences(context)
      val payload = stored.getString(PAYLOAD_KEY, null)
      val iv = stored.getString(IV_KEY, null)
      cached = if (payload == null || iv == null) null
        else T1ArcSnapshotCipher.decryptText(payload, iv)?.let(::decode)
      loaded = true
      return cached
    }
  }

  fun set(context: Context, estimate: OnBoardEstimate) {
    synchronized(lock) {
      cached = estimate
      loaded = true
      val encrypted = runCatching { T1ArcSnapshotCipher.encryptText(encode(estimate)) }.getOrNull()
      val editor = preferences(context).edit()
      if (encrypted == null) {
        // Never stored as plain text; the live process still shows it.
        editor.remove(PAYLOAD_KEY).remove(IV_KEY)
      } else {
        editor.putString(PAYLOAD_KEY, encrypted.first).putString(IV_KEY, encrypted.second)
      }
      editor.apply()
    }
  }

  fun clear(context: Context) {
    synchronized(lock) {
      cached = null
      loaded = true
      preferences(context).edit().remove(PAYLOAD_KEY).remove(IV_KEY).apply()
    }
  }

  /** Adds removal to the privacy-erase commit that also removes the glucose snapshot. */
  fun clearInto(editor: SharedPreferences.Editor) {
    synchronized(lock) {
      cached = null
      loaded = true
      editor.remove(PAYLOAD_KEY).remove(IV_KEY)
    }
  }

  /** Called on the AAPS receive executor inside the publication epoch gate. */
  fun updateFromAaps(context: Context, reading: AapsLocalReading) {
    OnBoardEstimatePolicy.fromAaps(reading)?.let { set(context, it) }
  }

  /** Clears only a Nightscout estimate, so it can never remove one AAPS owns. */
  fun clearNightscout(context: Context) {
    if (current(context)?.provenance == OnBoardProvenance.NIGHTSCOUT) clear(context)
  }

  fun presentation(
    context: Context,
    snapshot: GlucoseDisplaySnapshot?,
    surface: OnBoardSurface,
    now: Long = System.currentTimeMillis(),
  ): OnBoardText? {
    if (snapshot == null) return null
    if (!OnBoardEstimatePolicy.visibleOn(surface, visible(context),
        T1ArcGlucoseDisplayState.lockScreenVisible(context))) return null
    val estimate = current(context) ?: return null
    val epoch = preferences(context).getLong(EPOCH_KEY, 0L)
    if (!OnBoardEstimatePolicy.appliesTo(estimate, snapshot.sourceLabel, epoch,
        AapsLocalStore.generation(context))) return null
    return OnBoardEstimatePolicy.present(estimate, now, T1ArcGlucoseDisplayState.displayLocale(context))
  }

  private fun encode(value: OnBoardEstimate): String = JSONObject().apply {
    value.iobUnits?.let { put("iobUnits", it) }
    value.cobGrams?.let { put("cobGrams", it) }
    put("receivedAtMs", value.receivedAtMs)
    put("provenance", value.provenance.wireValue)
    put("writeEpoch", value.writeEpoch)
    put("selectionGeneration", value.selectionGeneration)
  }.toString()

  private fun decode(text: String): OnBoardEstimate? {
    val json = runCatching { JSONObject(text) }.getOrNull() ?: return null
    val provenance = OnBoardProvenance.fromWire(json.optString("provenance")) ?: return null
    fun number(name: String) = json.optDouble(name, Double.NaN).takeIf(Double::isFinite)
    return OnBoardEstimatePolicy.validated(
      number("iobUnits"), number("cobGrams"), json.optLong("receivedAtMs", 0L),
      provenance, json.optLong("writeEpoch", -1L), json.optLong("selectionGeneration", -1L),
    )
  }
}
