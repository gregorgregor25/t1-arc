package io.github.gregorgregor25.t1arc.wear.data

import java.text.NumberFormat
import java.util.Locale
import kotlin.math.max

const val CURRENT_AFTER_MS = 6 * 60_000L
const val STALE_AFTER_MS = 12 * 60_000L

data class GlucoseSnapshot(
    val mmolL: Double,
    val trend: String,
    val trendOrigin: String = "source",
    val timestampMs: Long,
    val sourceLabel: String,
    val sourceHasError: Boolean,
    val category: String,
    val colorToken: String = defaultColorToken(category),
    val staleColorToken: String = "slate",
    val glucoseUnit: String = "mmolL",
    val localeTag: String = "en-GB",
    val timeZone: String = "Europe/London",
)

data class GlucoseHistoryPoint(
    val mmolL: Double,
    val timestampMs: Long,
    val colorToken: String = "cyan",
)

enum class GlucoseFreshness(val label: String) {
    CURRENT("Current"),
    DELAYED("Delayed"),
    STALE("Stale"),
    MISSING("Missing"),
}

object GlucoseSemantics {
    private val colorTokens =
        listOf("rose", "amber", "orange", "cyan", "green", "blue", "purple", "slate")

    fun trendIsCalculated(snapshot: GlucoseSnapshot?): Boolean =
        snapshot?.trendOrigin == "calculated"

    fun statusTitle(
        snapshot: GlucoseSnapshot?,
        freshness: GlucoseFreshness,
    ): String {
        val freshnessTitle =
            when (freshness) {
                GlucoseFreshness.CURRENT -> "CURRENT"
                GlucoseFreshness.DELAYED -> "DELAY"
                GlucoseFreshness.STALE -> "LAST KNOWN"
                GlucoseFreshness.MISSING -> "MISSING"
            }
        return if (snapshot != null && trendIsCalculated(snapshot)) {
            "$freshnessTitle · CALC"
        } else {
            freshnessTitle
        }
    }

    fun watchFaceStatusTitle(snapshot: GlucoseSnapshot?, freshness: GlucoseFreshness): String =
        snapshot?.let { unitLabel(it) + " · " + statusTitle(it, freshness) } ?: "WAITING FOR GLUCOSE"

    fun freshness(
        snapshot: GlucoseSnapshot?,
        nowMs: Long = System.currentTimeMillis(),
    ): GlucoseFreshness {
        snapshot ?: return GlucoseFreshness.MISSING
        val age = max(0L, nowMs - snapshot.timestampMs)
        // sourceHasError remains available as separate diagnostic metadata.
        // Freshness describes only the age of the latest measurement.
        return when {
            age <= CURRENT_AFTER_MS -> GlucoseFreshness.CURRENT
            age <= STALE_AFTER_MS -> GlucoseFreshness.DELAYED
            else -> GlucoseFreshness.STALE
        }
    }

    fun arrow(trend: String): String =
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

    /**
     * Wear ProtoLayout and third-party watch-face complication renderers do
     * not expose a reliable line-through style. Combining strokes preserve
     * the safety state when the host renders only plain complication text.
     */
    fun displayedValue(
        value: String,
        freshness: GlucoseFreshness,
    ): String =
        if (freshness == GlucoseFreshness.STALE) {
            value.flatMap { character ->
                if (character.isWhitespace()) listOf(character) else listOf(character, '\u0336')
            }.joinToString("")
        } else {
            value
        }

    fun formattedValue(snapshot: GlucoseSnapshot): String {
        return formattedMmolL(snapshot.mmolL, snapshot)
    }

    fun formattedMmolL(mmolL: Double, snapshot: GlucoseSnapshot): String {
        val locale = displayLocale(snapshot)
        return if (snapshot.glucoseUnit == "mgDl") {
            String.format(locale, "%.0f", mmolL * 18.016)
        } else {
            String.format(locale, "%.1f", mmolL)
        }
    }

    fun displayLocale(snapshot: GlucoseSnapshot?): Locale =
        Locale.forLanguageTag(snapshot?.localeTag.orEmpty())
            .takeIf { it.language.isNotBlank() }
            ?: Locale.getDefault()

    fun formattedInteger(value: Long, snapshot: GlucoseSnapshot?): String =
        NumberFormat.getIntegerInstance(displayLocale(snapshot)).format(value)

    fun unitLabel(snapshot: GlucoseSnapshot): String =
        if (snapshot.glucoseUnit == "mgDl") "mg/dL" else "mmol/L"

    fun spokenUnit(snapshot: GlucoseSnapshot): String =
        if (snapshot.glucoseUnit == "mgDl") {
            "milligrams per decilitre"
        } else {
            "millimoles per litre"
        }

    fun colorToken(
        snapshot: GlucoseSnapshot?,
        freshness: GlucoseFreshness,
    ): String =
        when {
            snapshot == null -> "slate"
            freshness != GlucoseFreshness.CURRENT -> snapshot.staleColorToken
            else -> snapshot.colorToken
        }.takeIf(colorTokens::contains) ?: "slate"

    fun colorIndex(snapshot: GlucoseSnapshot?, freshness: GlucoseFreshness): Float {
        val index = colorTokens.indexOf(colorToken(snapshot, freshness))
        return (if (index >= 0) index else 7).toFloat()
    }

    fun colorArgb(
        snapshot: GlucoseSnapshot?,
        freshness: GlucoseFreshness,
    ): Int = colorArgb(colorToken(snapshot, freshness))

    fun colorArgb(token: String): Int =
        when (token) {
            "rose" -> 0xFFFF9BAE.toInt()
            "amber" -> 0xFFF1B66F.toInt()
            "orange" -> 0xFFFFB066.toInt()
            "cyan" -> 0xFF65D2E7.toInt()
            "green" -> 0xFF69D5AC.toInt()
            "blue" -> 0xFF82B7FF.toInt()
            "purple" -> 0xFFC2A9FF.toInt()
            else -> 0xFFA9BDC2.toInt()
        }

    fun ageLabel(
        snapshot: GlucoseSnapshot?,
        nowMs: Long = System.currentTimeMillis(),
    ): String {
        snapshot ?: return "No reading"
        val minutes = max(0L, nowMs - snapshot.timestampMs) / 60_000L
        return if (minutes == 0L) {
            "just now"
        } else {
            "${formattedInteger(minutes, snapshot)}m ago"
        }
    }
}

private fun defaultColorToken(category: String): String =
    when (category) {
        "veryLow", "veryHigh" -> "rose"
        "low" -> "amber"
        "target" -> "cyan"
        "high" -> "orange"
        else -> "slate"
    }
