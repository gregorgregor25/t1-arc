package io.github.gregorgregor25.t1arc.glucosedisplay

import org.junit.Assert.*
import org.junit.Test

class GlucoseWidgetSizeTest {
  @Test fun `launcher without modern sizes follows each resize and both orientations`() {
    val original = glucoseWidgetSizes(emptyList(), 410, 850, 140, 270)
    assertTrue(original.exact.isEmpty())
    assertEquals(WidgetSize(410f, 270f), original.portrait)
    assertEquals(WidgetSize(850f, 140f), original.landscape)
    val resized = glucoseWidgetSizes(emptyList(), 310, 650, 210, 400)
    assertEquals(WidgetSize(310f, 400f), resized.portrait)
    assertEquals(WidgetSize(650f, 210f), resized.landscape)
  }

  @Test fun `valid exact dimensions are retained without distorting their aspect ratio`() {
    val size = WidgetSize(1200f, 75f)
    assertEquals(listOf(size), glucoseWidgetSizes(listOf(size, size), 0, 0, 0, 0).exact)
  }

  @Test fun `invalid exact sizes fall back to legacy dimensions`() {
    val invalid = listOf(WidgetSize(Float.NaN, 100f), WidgetSize(300f, 0f), WidgetSize(Float.POSITIVE_INFINITY, 200f))
    val sizes = glucoseWidgetSizes(invalid, 410, 410, 270, 270)
    assertTrue(sizes.exact.isEmpty())
    assertEquals(WidgetSize(410f, 270f), sizes.portrait)
    assertEquals(sizes.portrait, sizes.landscape)
  }

  @Test fun `absent size options remain usable`() {
    val fallback = glucoseWidgetSizes(emptyList(), -1, 0, 0, -1)
    assertEquals(WidgetSize(380f, 238f), fallback.portrait)
    assertEquals(fallback.portrait, fallback.landscape)
  }

  @Test fun `Nova smaller area landscape must not become the portrait card`() {
    val portrait = WidgetSize(313.14285f, 233.14285f)
    val landscape = WidgetSize(531.0476f, 118.09524f)
    assertTrue(landscape.width * landscape.height < portrait.width * portrait.height)
    val sizes = glucoseWidgetSizes(listOf(landscape, portrait), 313, 531, 118, 233)
    assertEquals(portrait, sizes.portrait)
    assertEquals(landscape, sizes.landscape)
    val resized = WidgetSize(400.25f, 400.5f)
    assertEquals(resized, glucoseWidgetSizes(listOf(landscape, resized), 400, 531, 118, 400).portrait)
  }

  @Test fun `existing full-card sizes keep the full card`() {
    assertEquals(WidgetVariant.FULL, GlucoseWidgetLayoutPolicy.variant(380f, 238f))
    assertEquals(WidgetVariant.FULL, GlucoseWidgetLayoutPolicy.variant(313.14285f, 233.14285f))
    // Nova's landscape 4 x 2 stays on the card it has always shown.
    assertEquals(WidgetVariant.FULL, GlucoseWidgetLayoutPolicy.variant(531.0476f, 118.09524f))
    assertEquals(WidgetVariant.FULL, GlucoseWidgetLayoutPolicy.variant(280f, 110f))
    assertEquals(WidgetVariant.FULL, GlucoseWidgetLayoutPolicy.variant(Float.NaN, 0f))
  }

  @Test fun `sizes below the old resize limit use the compact card`() {
    assertEquals(WidgetVariant.COMPACT, GlucoseWidgetLayoutPolicy.variant(340f, 60f))
    assertEquals(WidgetVariant.COMPACT, GlucoseWidgetLayoutPolicy.variant(150f, 150f))
    assertEquals(WidgetVariant.COMPACT, GlucoseWidgetLayoutPolicy.variant(110f, 50f))
  }

  @Test fun `compact card adds insulin and carbs on board only when there is room`() {
    assertEquals(CompactWidgetPlan(row = true, showOnBoard = true),
      GlucoseWidgetLayoutPolicy.compactPlan(340f, 60f, hasOnBoard = true))
    assertEquals(CompactWidgetPlan(row = true, showOnBoard = false),
      GlucoseWidgetLayoutPolicy.compactPlan(220f, 60f, hasOnBoard = true))
    assertEquals(CompactWidgetPlan(row = false, showOnBoard = true),
      GlucoseWidgetLayoutPolicy.compactPlan(150f, 150f, hasOnBoard = true))
    assertEquals(CompactWidgetPlan(row = false, showOnBoard = false),
      GlucoseWidgetLayoutPolicy.compactPlan(110f, 50f, hasOnBoard = true))
    assertEquals(CompactWidgetPlan(row = true, showOnBoard = false),
      GlucoseWidgetLayoutPolicy.compactPlan(340f, 60f, hasOnBoard = false))
  }
}
