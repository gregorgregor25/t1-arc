package io.github.gregorgregor25.t1arc.glucosedisplay

import java.text.NumberFormat
import java.util.Locale

/** Formats user-visible whole numbers with the selected regional locale. */
internal object RegionalNumberFormatter {
  fun integer(value: Long, locale: Locale): String =
    NumberFormat.getIntegerInstance(locale).format(value)
}
