package io.github.gregorgregor25.t1arc.glucosedisplay

import java.text.DateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

internal object RegionalTimeFormatter {
  fun format(
    timestampMs: Long,
    locale: Locale,
    timeZone: TimeZone,
  ): String =
    DateFormat.getTimeInstance(DateFormat.SHORT, locale)
      .apply { this.timeZone = timeZone }
      .format(Date(timestampMs))
}
