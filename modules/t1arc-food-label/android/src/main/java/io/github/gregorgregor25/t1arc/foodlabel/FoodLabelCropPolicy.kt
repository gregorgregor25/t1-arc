package io.github.gregorgregor25.t1arc.foodlabel

import kotlin.math.ceil
import kotlin.math.floor

internal data class LabelBox(val left: Int, val top: Int, val right: Int, val bottom: Int) {
  val width get() = right - left
  val height get() = bottom - top
}
internal data class LocatedLabelText(val text: String, val box: LabelBox)

/** Include every detected nutrition heading and row, including competing tables. */
internal fun nutritionDetailBox(lines: List<LocatedLabelText>, width: Int, height: Int): LabelBox? {
  val heading = Regex("\\b(nutrition|typical values|per\\s*100\\s*(g|ml)|serving size)\\b", RegexOption.IGNORE_CASE)
  val nutrient = Regex("^\\s*(energy|calories|(?:total\\s+)?(?:carbohydrates?|fat)|proteins?|fib(?:re|er)|(?:of which\\s+)?(?:sugars?|saturates)|salt)\\b", RegexOption.IGNORE_CASE)
  val anchors = lines.filter { heading.containsMatchIn(it.text) || nutrient.containsMatchIn(it.text) }
  if (anchors.none { heading.containsMatchIn(it.text) } || anchors.count { nutrient.containsMatchIn(it.text) } < 2) return null
  val margin = anchors.map { it.box.height }.sorted().let { it[it.size / 2] }.coerceAtLeast(8) * 3
  val top = (anchors.minOf { it.box.top } - margin).coerceAtLeast(0)
  val bottom = (anchors.maxOf { it.box.bottom } + margin).coerceAtMost(height)
  // Include all text in this vertical band, not just recognized nutrient words:
  // right-hand serving/reference columns must never be cropped away.
  val rows = lines.filter { it.box.bottom >= top && it.box.top <= bottom }
  return LabelBox((rows.minOf { it.box.left } - margin).coerceAtLeast(0), top,
    (rows.maxOf { it.box.right } + margin).coerceAtMost(width), bottom)
    .takeIf { it.width > 0 && it.height > 0 }
}

/** ML Kit boxes are upright; JPEG region decoding uses the original pixel axes. */
internal fun sourceLabelBox(box: LabelBox, rotation: Int, decodedWidth: Int, decodedHeight: Int,
  sourceWidth: Int, sourceHeight: Int): LabelBox {
  require(decodedWidth > 0 && decodedHeight > 0 && sourceWidth > 0 && sourceHeight > 0)
  require(rotation in setOf(0, 90, 180, 270))
  val points = listOf(box.left to box.top, box.right to box.top, box.left to box.bottom, box.right to box.bottom).map { (x, y) ->
    when (rotation) {
      90 -> y to decodedHeight - x
      180 -> decodedWidth - x to decodedHeight - y
      270 -> decodedWidth - y to x
      else -> x to y
    }
  }
  val scaleX = sourceWidth.toDouble() / decodedWidth
  val scaleY = sourceHeight.toDouble() / decodedHeight
  return LabelBox(floor(points.minOf { it.first } * scaleX).toInt().coerceIn(0, sourceWidth - 1),
    floor(points.minOf { it.second } * scaleY).toInt().coerceIn(0, sourceHeight - 1),
    ceil(points.maxOf { it.first } * scaleX).toInt().coerceIn(1, sourceWidth),
    ceil(points.maxOf { it.second } * scaleY).toInt().coerceIn(1, sourceHeight))
}
