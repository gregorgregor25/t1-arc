package io.github.gregorgregor25.t1arc.glucosedisplay

/** Phone categories retain source triples; the installed Wear schema predates them. */
internal object GlucoseTrendPresentation {
  fun phone(trend: String): Pair<String, String>? = when (trend) {
    "tripleDown" -> "↓↓↓" to "Falling very quickly"
    "doubleDown" -> "⇊" to "Falling quickly"
    "down" -> "↓" to "Falling"
    "slightDown" -> "↘" to "Falling slowly"
    "flat" -> "→" to "Steady"
    "slightUp" -> "↗" to "Rising slowly"
    "up" -> "↑" to "Rising"
    "doubleUp" -> "⇈" to "Rising quickly"
    "tripleUp" -> "↑↑↑" to "Rising very quickly"
    else -> null
  }

  /** Only the phone-to-watch boundary reduces a triple to the old fastest category. */
  fun installedWearDirection(trend: String): String = when (trend) {
    "tripleDown" -> "doubleDown"
    "tripleUp" -> "doubleUp"
    else -> trend
  }
}
