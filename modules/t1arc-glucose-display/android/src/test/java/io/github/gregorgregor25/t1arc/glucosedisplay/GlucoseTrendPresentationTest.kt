package io.github.gregorgregor25.t1arc.glucosedisplay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GlucoseTrendPresentationTest {
  @Test fun phoneRetainsDistinctSourceTriples() {
    assertEquals("↑↑↑" to "Rising very quickly", GlucoseTrendPresentation.phone("tripleUp"))
    assertEquals("↓↓↓" to "Falling very quickly", GlucoseTrendPresentation.phone("tripleDown"))
    assertEquals("⇈" to "Rising quickly", GlucoseTrendPresentation.phone("doubleUp"))
    assertEquals("⇊" to "Falling quickly", GlucoseTrendPresentation.phone("doubleDown"))
    assertNull(GlucoseTrendPresentation.phone("unknown"))
  }

  @Test fun installedCompanionReceivesOnlyItsFrozenDirectionContract() {
    // These are the directions supported by the already installed companion,
    // deliberately independent of the expanded phone/shared presentation file.
    val installedDirections = setOf("doubleDown", "down", "slightDown", "flat",
      "slightUp", "up", "doubleUp", "unknown")
    for (direction in installedDirections) {
      assertEquals(direction, GlucoseTrendPresentation.installedWearDirection(direction))
    }
    assertEquals("doubleUp", GlucoseTrendPresentation.installedWearDirection("tripleUp"))
    assertEquals("doubleDown", GlucoseTrendPresentation.installedWearDirection("tripleDown"))
    for (direction in installedDirections + setOf("tripleUp", "tripleDown")) {
      assertTrue(GlucoseTrendPresentation.installedWearDirection(direction) in installedDirections)
    }
  }
}
