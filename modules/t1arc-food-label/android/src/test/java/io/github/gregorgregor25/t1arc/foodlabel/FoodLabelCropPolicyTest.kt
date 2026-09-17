package io.github.gregorgregor25.t1arc.foodlabel

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FoodLabelCropPolicyTest {
  @Test fun mapsUprightCoordinatesBackIntoEveryJpegRotation() {
    val box = LabelBox(100, 200, 300, 600)
    val expected = listOf(0 to LabelBox(200, 400, 600, 1200),
      90 to LabelBox(400, 2400, 1200, 2800), 180 to LabelBox(3400, 1800, 3800, 2600),
      270 to LabelBox(2800, 200, 3600, 600))
    expected.forEach { (angle, result) ->
      assertEquals(result, sourceLabelBox(box, angle, 2000, 1500, 4000, 3000))
    }
  }
  @Test fun keepsAllColumnsAndCompetingTablesInTheDetailImage() {
    val lines = listOf(LocatedLabelText("Per 100g", LabelBox(400, 200, 500, 220)),
      LocatedLabelText("Carbohydrate", LabelBox(200, 300, 350, 320)),
      LocatedLabelText("20g", LabelBox(450, 300, 480, 320)),
      LocatedLabelText("6g", LabelBox(800, 300, 830, 320)),
      LocatedLabelText("Protein", LabelBox(200, 340, 300, 360)),
      LocatedLabelText("Per 100g prepared", LabelBox(400, 800, 600, 820)),
      LocatedLabelText("Carbohydrate", LabelBox(200, 850, 350, 870)))
    val box = nutritionDetailBox(lines, 1000, 1200)!!
    assertTrue(box.left <= 200 && box.right >= 830 && box.top <= 200 && box.bottom >= 870)
  }
  @Test fun doesNotCropIsolatedProductWeightsOrUnrecognizedText() {
    assertNull(nutritionDetailBox(listOf(LocatedLabelText("Net 100g", LabelBox(10, 10, 100, 30))), 200, 200))
    assertNull(nutritionDetailBox(emptyList(), 200, 200))
  }
  @Test fun sourceBoxIsClampedToTheImageEdges() {
    assertEquals(LabelBox(0, 0, 4000, 3000), sourceLabelBox(LabelBox(-100, -100, 2500, 2000), 0, 2000, 1500, 4000, 3000))
  }
}
