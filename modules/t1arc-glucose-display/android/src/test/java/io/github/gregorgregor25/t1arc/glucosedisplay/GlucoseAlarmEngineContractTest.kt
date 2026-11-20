package io.github.gregorgregor25.t1arc.glucosedisplay

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

private fun alarmMainSource(relative: String): String {
  val moduleRelative = "modules/t1arc-glucose-display/android/src/main/$relative"
  return listOf(
      File(moduleRelative),
      File("../$moduleRelative"),
      File("src/main/$relative"),
    )
    .firstOrNull(File::isFile)
    ?.readText()
    ?.replace("\r\n", "\n")
    ?: error("Could not locate $relative")
}

/**
 * The engine needs an Android context, so its silence handler is checked at the
 * source level: it must hand the episode to the tested policy, not edit the
 * snooze fields itself.
 */
class GlucoseAlarmEngineContractTest {
  private val engine = alarmMainSource("java/io/github/gregorgregor25/t1arc/glucosedisplay/GlucoseAlarmEngine.kt")

  private fun function(name: String): String {
    val start = engine.indexOf("\n  fun $name(")
    assertTrue("GlucoseAlarmEngine.$name is missing", start >= 0)
    val end = engine.indexOf("\n  }\n", start)
    assertTrue("GlucoseAlarmEngine.$name has no end", end > start)
    return engine.substring(start, end)
  }

  @Test
  fun `silencing uses the policy that ends a running snooze`() {
    val acknowledge = function("acknowledge")
    assertEquals(1, Regex("""GlucoseAlarmPolicy\.episodeAfterAcknowledge\(""").findAll(acknowledge).count())
    assertTrue(acknowledge.contains("episode = GlucoseAlarmPolicy.episodeAfterAcknowledge(old, elapsed, pauseUntilElapsed, pauseUntilWall)"))
    assertTrue(acknowledge.contains("val pauseUntilElapsed = lowPauseUntilElapsed(context, elapsed)"))
    // The policy alone decides the acknowledged state and every snooze field.
    for (field in listOf("acknowledged =", "snoozeUntilElapsed =", "snoozeUntilWall =", "snoozedAtElapsed =",
      "userSnoozeUntilElapsed =", ".copy(")) {
      assertFalse("acknowledge sets $field itself", acknowledge.contains(field))
    }
    assertTrue(acknowledge.contains("persist(context)"))
  }
}
