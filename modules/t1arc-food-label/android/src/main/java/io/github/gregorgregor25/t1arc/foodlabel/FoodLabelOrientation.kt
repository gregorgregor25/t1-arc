package io.github.gregorgregor25.t1arc.foodlabel

import kotlin.math.roundToInt

/** Camera EXIF describes the phone; printed text can still be sideways or inverted. */
internal fun labelQuarterTurn(lines: List<Pair<String, Float>>): Int {
  val anchors = Regex("nutrition|typical|energy|carbohydrate|protein|fibre|fiber|sugars|saturates|fat", RegexOption.IGNORE_CASE)
  val votes = lines.filter { anchors.containsMatchIn(it.first) && it.second.isFinite() }
    .map { ((it.second / 90f).roundToInt() % 4 + 4) % 4 }
  if (votes.size < 3) return 0
  val winner = votes.groupingBy { it }.eachCount().maxByOrNull { it.value } ?: return 0
  return if (winner.value >= votes.size * 0.7) (360 - winner.key * 90) % 360 else 0
}
