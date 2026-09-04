package io.github.gregorgregor25.t1arc.glucosedisplay

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

private fun aodMainResource(relative: String): String {
  val moduleRelative = "modules/t1arc-glucose-display/android/src/main/$relative"
  return listOf(
      File(moduleRelative),
      File("../$moduleRelative"),
      File("src/main/$relative"),
    )
    .firstOrNull(File::isFile)
    ?.readText()
    ?: error("Could not locate $relative")
}

class AodAccessibilityServiceContractTest {
  @Test
  fun `AOD service is scoped to System UI without key filtering`() {
    val configuration = aodMainResource("res/xml/t1arc_aod_accessibility_service.xml")

    assertTrue(
      configuration.contains(
        "android:accessibilityEventTypes=\"typeWindowStateChanged|typeWindowContentChanged\""
      )
    )
    assertTrue(configuration.contains("android:canRetrieveWindowContent=\"false\""))
    assertTrue(configuration.contains("android:packageNames=\"com.android.systemui\""))
    assertFalse(configuration.contains("flagRequestFilterKeyEvents"))
    assertFalse(configuration.contains("canRequestFilterKeyEvents"))
    assertFalse(configuration.contains("flagIncludeNotImportantViews"))
  }

  @Test
  fun `AOD service has a distinct T1 Arc migration-safe label`() {
    val strings = aodMainResource("res/values/strings.xml")

    assertTrue(
      strings.contains(
        "<string name=\"t1arc_aod_service_name\">T1 Arc always-on glucose</string>"
      )
    )
  }
}
