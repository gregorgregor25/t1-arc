package io.github.gregorgregor25.t1arc.glucosedisplay

import java.util.Locale
import kotlin.math.max

/** Text with one span (the last known value) that Android code strikes through. */
internal data class StruckText(val text: String, val struckStart: Int, val struckEnd: Int)

internal data class WaitingNotificationCopy(val title: String, val text: String, val bigText: String)

internal data class RedactedNotificationCopy(val title: String, val text: String)

/** Two text lines beside the number on the medium widget. */
internal data class WidgetLines(val primary: String, val secondary: String)

/**
 * Android-free wording shared by the ongoing notification and the home screen
 * widget, so JVM tests cover every user-visible string they build.
 */
internal object GlucoseSurfaceCopy {
  const val NEUTRAL_SOURCE = "your glucose source"
  const val LOG_FOOD_ACTION = "Log food"
  const val LOG_SOMETHING_ACTION = "Log something"

  /** The same mapping the widget card has always used for its range pill. */
  fun rangeWord(category: String): String = when (category) {
    "veryLow" -> "Very low"
    "low" -> "Low"
    "target" -> "In range"
    "high" -> "High"
    else -> "Very high"
  }

  /**
   * Low and very low readings fill the widget with the low colour family.
   * A stale or missing value is never emphasised as if it were current.
   */
  fun lowEmphasis(category: String, freshness: DisplayFreshness): Boolean =
    (category == "veryLow" || category == "low") &&
      (freshness == DisplayFreshness.CURRENT || freshness == DisplayFreshness.DELAYED)

  /** The glucose source chosen in Settings, named for a sentence. Null when unknown. */
  fun selectedSourceName(sourceId: String?): String? = when (sourceId) {
    AAPS_SOURCE_ID -> "AAPS"
    "t1arc-librelinkup" -> "LibreLinkUp"
    "nightscout" -> "Nightscout"
    "dexcom-share" -> "Dexcom Share"
    "medtrum-easyfollow" -> "Medtrum EasyFollow"
    "xdrip-local" -> "xDrip"
    "android-notification" -> "your glucose app's notifications"
    else -> null
  }

  /** Short name for the source label carried by a published reading. Null when generic. */
  fun readingSourceName(label: String?): String? {
    val trimmed = label?.trim().orEmpty()
    return when (trimmed) {
      "", "Personal glucose source", "Saved glucose" -> null
      "AndroidAPS local" -> "AAPS"
      "Restored AndroidAPS history", "Earlier AndroidAPS history" -> "AAPS history"
      "T1 Arc direct LibreLinkUp" -> "LibreLinkUp"
      "Phone notification source" -> "phone notifications"
      "xDrip or compatible app" -> "xDrip"
      else -> trimmed
    }
  }

  fun waiting(sourceName: String?): WaitingNotificationCopy {
    val source = sourceName ?: NEUTRAL_SOURCE
    return WaitingNotificationCopy(
      title = "Waiting for a glucose reading",
      text = "T1 Arc is waiting for a reading from $source.",
      bigText = "T1 Arc is waiting for a reading from $source. " +
        "This notification will update when one arrives.",
    )
  }

  /** Private monitoring text. It names the source, never a reading. */
  fun monitoringText(alertsEnabled: Boolean, sourceName: String?): String = when {
    alertsEnabled && sourceName != null -> "Your chosen alerts are being checked on this phone with readings from $sourceName."
    alertsEnabled -> "Your chosen alerts are being checked on this phone."
    sourceName != null -> "Your home screen glucose widget is being kept up to date from $sourceName."
    else -> "Your home screen glucose widget is being kept up to date."
  }

  /** The lock-screen version never includes the value or insulin and carbs on board. */
  fun redacted(freshness: DisplayFreshness): RedactedNotificationCopy = when (freshness) {
    DisplayFreshness.CURRENT -> RedactedNotificationCopy("Fresh glucose reading", "Unlock to see it")
    DisplayFreshness.DELAYED -> RedactedNotificationCopy("Delayed glucose reading", "Unlock to see it")
    DisplayFreshness.STALE -> RedactedNotificationCopy("No new glucose reading", "Unlock to see the last one")
    DisplayFreshness.MISSING -> RedactedNotificationCopy("Waiting for a glucose reading", "Unlock for details")
  }

  /** "26 min", "1 hr 5 min", "3 hr", "2 days" with regional digits. */
  fun duration(minutes: Long, locale: Locale): String {
    fun n(value: Long) = RegionalNumberFormatter.integer(value, locale)
    val whole = max(0L, minutes)
    if (whole < 60) return "${n(whole)} min"
    if (whole < 24 * 60) {
      val hours = whole / 60
      val rest = whole % 60
      return if (rest == 0L) "${n(hours)} hr" else "${n(hours)} hr ${n(rest)} min"
    }
    val days = whole / (24 * 60)
    return "${n(days)} ${if (days == 1L) "day" else "days"}"
  }

  private fun minutesSince(timestampMs: Long, now: Long) = max(0L, now - timestampMs) / 60_000L

  /** Sentence-start age for the notification: "Just now", "2 min ago", "1 hr 5 min ago". */
  fun age(timestampMs: Long, now: Long, locale: Locale): String {
    val minutes = minutesSince(timestampMs, now)
    return if (minutes == 0L) "Just now" else "${duration(minutes, locale)} ago"
  }

  /** Title of a live reading, without the value: " ↘ Falling slowly (calculated)". */
  fun directionSuffix(arrow: String, direction: String, calculated: Boolean, unit: String? = null): String =
    (if (unit != null) " $unit" else "") + " $arrow $direction" + if (calculated) " (calculated)" else ""

  /** Collapsed second line: age · range word · IOB/COB. */
  fun readingLine(age: String, freshness: DisplayFreshness, rangeWord: String, onBoardCompact: String?): String =
    listOfNotNull(
      "Delayed".takeIf { freshness == DisplayFreshness.DELAYED },
      age,
      rangeWord,
      onBoardCompact,
    ).joinToString(" · ")

  /** Expanded summary: age, source, then insulin and carbs on board with their provenance. */
  fun expandedSummary(
    age: String,
    freshness: DisplayFreshness,
    sourceName: String?,
    onBoardCompact: String?,
    onBoardDetail: String?,
  ): String =
    listOfNotNull(
      "Delayed".takeIf { freshness == DisplayFreshness.DELAYED },
      age,
      sourceName?.let { "from $it" },
      onBoardCompact,
      onBoardDetail.takeIf { onBoardCompact != null },
    ).joinToString(" · ")

  /** Stale title. A reading time ahead of this phone is named as such, not as an outage. */
  fun staleTitle(timestampMs: Long, now: Long, locale: Locale): String =
    if (timestampMs - now > 2 * 60_000L) "Reading time is ahead of this phone's clock"
    else "No new reading for ${duration(minutesSince(timestampMs, now), locale)}"

  /** "Last known 7.1 at 08:14 · tap to check AAPS", with the value marked for strikethrough. */
  fun staleLine(value: String, time: String, sourceName: String?): StruckText {
    val prefix = "Last known "
    val text = "$prefix$value at $time · tap to check ${sourceName ?: NEUTRAL_SOURCE}"
    return StruckText(text, prefix.length, prefix.length + value.length)
  }

  /**
   * Small widget status under or beside the number. [lowWord] is "Low" or
   * "Very low" while the card is filled with the low colour, so colour never
   * carries that meaning alone.
   */
  fun compactStatus(freshness: DisplayFreshness, age: String, lowWord: String?): String = when (freshness) {
    DisplayFreshness.STALE -> "Last known · $age"
    DisplayFreshness.DELAYED -> listOfNotNull(lowWord, "Delayed", age).joinToString(" · ")
    else -> listOfNotNull(lowWord, age).joinToString(" · ")
  }

  /** Medium widget lines beside the number. */
  fun mediumLines(
    arrow: String,
    direction: String,
    rangeWord: String,
    lowEmphasis: Boolean,
    age: String,
    freshness: DisplayFreshness,
    lastKnownTime: String,
    staleDuration: String?,
    clockAhead: Boolean = false,
  ): WidgetLines {
    if (freshness == DisplayFreshness.STALE && clockAhead) {
      // A reading stamped ahead of this phone is a clock problem, not an outage.
      return WidgetLines("Reading time is ahead", "$age · check this phone's clock")
    }
    if (freshness == DisplayFreshness.STALE) {
      return WidgetLines("No new reading",
        listOfNotNull("Last known at $lastKnownTime", staleDuration).joinToString(" · "))
    }
    val delayed = freshness == DisplayFreshness.DELAYED
    return if (lowEmphasis) {
      // The range word leads so ellipsizing trims the direction, never "Low" or "Very low".
      WidgetLines("$rangeWord · $arrow $direction", listOfNotNull("Delayed".takeIf { delayed }, age).joinToString(" · "))
    } else {
      WidgetLines("$arrow $direction", listOfNotNull("Delayed".takeIf { delayed }, rangeWord, age).joinToString(" · "))
    }
  }

  /** Spoken widget description; the range word means colour never carries meaning alone. */
  fun widgetDescription(
    value: String,
    spokenUnit: String,
    direction: String,
    rangeWord: String?,
    freshness: DisplayFreshness,
    age: String,
    onBoardSpoken: String?,
  ): String {
    val glucose = if (freshness == DisplayFreshness.STALE) {
      "Last known glucose $value $spokenUnit, shown struck through because it is stale. Updated $age."
    } else {
      "Current glucose $value $spokenUnit, $direction" +
        (rangeWord?.let { ", ${it.lowercase(Locale.ROOT)}" } ?: "") +
        ". ${freshness.label}, updated $age."
    }
    return glucose + (onBoardSpoken?.let { " $it" } ?: "")
  }
}
