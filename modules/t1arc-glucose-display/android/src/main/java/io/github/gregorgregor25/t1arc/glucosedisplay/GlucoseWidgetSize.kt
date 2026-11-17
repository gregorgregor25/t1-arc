package io.github.gregorgregor25.t1arc.glucosedisplay

import kotlin.math.abs

internal data class WidgetSize(val width: Float, val height: Float) {
  val valid: Boolean get() = width.isFinite() && height.isFinite() && width > 0 && height > 0
}

internal data class WidgetSizes(val exact: List<WidgetSize>, val portrait: WidgetSize, val landscape: WidgetSize)

/** Older launchers can omit exact sizes even on Android 12+. Their ranges still change on resize. */
internal fun glucoseWidgetSizes(exact: List<WidgetSize>, minWidth: Int, maxWidth: Int,
  minHeight: Int, maxHeight: Int): WidgetSizes {
  val narrow = minWidth.takeIf { it > 0 }?.toFloat() ?: 380f
  val wide = maxWidth.takeIf { it > 0 }?.toFloat() ?: narrow
  val short = minHeight.takeIf { it > 0 }?.toFloat() ?: 238f
  val tall = maxHeight.takeIf { it > 0 }?.toFloat() ?: short
  val valid = exact.filter { it.valid }.distinct()
  fun closest(target: WidgetSize) = valid.minByOrNull {
    abs(it.width - target.width) / target.width + abs(it.height - target.height) / target.height
  } ?: target
  return WidgetSizes(valid, closest(WidgetSize(narrow, tall)), closest(WidgetSize(wide, short)))
}

internal enum class WidgetVariant { FULL, COMPACT }

/** [row] puts the value beside its age; otherwise they stack. */
internal data class CompactWidgetPlan(val row: Boolean, val showOnBoard: Boolean)

/**
 * The full card was never resizable below 280 × 110 dp, so every existing
 * widget keeps it. Only the smaller sizes now allowed use the compact card:
 * value, arrow and age, plus insulin and carbs on board when there is room.
 */
internal object GlucoseWidgetLayoutPolicy {
  const val FULL_MIN_WIDTH_DP = 280f
  const val FULL_MIN_HEIGHT_DP = 110f

  fun variant(width: Float, height: Float): WidgetVariant {
    if (!WidgetSize(width, height).valid) return WidgetVariant.FULL
    return if (width < FULL_MIN_WIDTH_DP || height < FULL_MIN_HEIGHT_DP) WidgetVariant.COMPACT
    else WidgetVariant.FULL
  }

  fun compactPlan(width: Float, height: Float, hasOnBoard: Boolean): CompactWidgetPlan {
    val row = width >= 200f && width >= height * 1.8f
    val room = if (row) width >= 260f && height >= 48f else width >= 130f && height >= 110f
    return CompactWidgetPlan(row, hasOnBoard && room)
  }
}
