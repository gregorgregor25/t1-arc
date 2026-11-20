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

  /** The whole function, found by matching braces, with all whitespace collapsed to single spaces. */
  private fun function(name: String): String {
    val start = engine.indexOf("fun $name(")
    assertTrue("GlucoseAlarmEngine.$name is missing", start >= 0)
    val open = engine.indexOf('{', start)
    assertTrue("GlucoseAlarmEngine.$name has no body", open > start)
    var depth = 0
    for (index in open until engine.length) {
      when (engine[index]) {
        '{' -> depth++
        '}' -> if (--depth == 0) return engine.substring(start, index + 1).replace(Regex("""\s+"""), " ")
      }
    }
    throw AssertionError("GlucoseAlarmEngine.$name has no end")
  }

  @Test
  fun `silencing uses the policy that ends a running snooze`() {
    val acknowledge = function("acknowledge")
    assertEquals(1, Regex("""GlucoseAlarmPolicy\.episodeAfterAcknowledge\(""").findAll(acknowledge).count())
    assertTrue(Regex("""episode = GlucoseAlarmPolicy\.episodeAfterAcknowledge\( ?old, ?elapsed, ?pauseUntilElapsed, ?pauseUntilWall,? ?\)""")
      .containsMatchIn(acknowledge))
    assertTrue(Regex("""val pauseUntilElapsed = lowPauseUntilElapsed\( ?context, ?elapsed,? ?\)""").containsMatchIn(acknowledge))
    // The policy alone decides the acknowledged state and every snooze field.
    for (field in listOf("acknowledged", "snoozeUntilElapsed", "snoozeUntilWall", "snoozedAtElapsed",
      "userSnoozeUntilElapsed")) {
      assertFalse("acknowledge sets $field itself", Regex("""\b$field ?=[^=]""").containsMatchIn(acknowledge))
    }
    assertFalse("acknowledge copies the episode itself", acknowledge.contains(".copy("))
    assertTrue(acknowledge.contains("persist(context)"))
  }
}
