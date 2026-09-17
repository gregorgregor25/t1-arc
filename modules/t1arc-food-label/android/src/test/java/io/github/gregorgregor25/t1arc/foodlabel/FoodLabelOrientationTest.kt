package io.github.gregorgregor25.t1arc.foodlabel

import org.junit.Assert.assertEquals
import org.junit.Test

class FoodLabelOrientationTest {
  private val names = listOf("Nutrition information", "Carbohydrate (g)", "Protein", "Fat")
  @Test fun correctsBothSidewaysDirectionsAndUpsideDown() {
    assertEquals(270, labelQuarterTurn(names.map { it to 90f }))
    assertEquals(90, labelQuarterTurn(names.map { it to -90f }))
    assertEquals(180, labelQuarterTurn(names.map { it to 180f }))
  }
  @Test fun leavesTiltMixedDirectionsAndInsufficientEvidenceAlone() {
    assertEquals(0, labelQuarterTurn(names.map { it to 12f }))
    assertEquals(0, labelQuarterTurn(listOf("Protein" to 90f, "Fat" to 90f)))
    assertEquals(0, labelQuarterTurn(names.mapIndexed { index, name -> name to if (index % 2 == 0) 90f else 0f }))
    assertEquals(0, labelQuarterTurn(names.map { it to Float.NaN }))
  }
}
