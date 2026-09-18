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
