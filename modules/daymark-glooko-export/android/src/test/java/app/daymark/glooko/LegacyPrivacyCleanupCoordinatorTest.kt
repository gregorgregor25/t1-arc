package app.daymark.glooko

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LegacyPrivacyCleanupCoordinatorTest {
  private class Marker(
    var complete: Boolean = false,
    var commitSucceeds: Boolean = true,
  ) : LegacyPrivacyMigrationMarker {
    var markCalls = 0

    override fun isComplete() = complete

    override fun markComplete(): Boolean {
      markCalls += 1
      if (commitSucceeds) complete = true
      return commitSucceeds
    }
  }

  @Test
  fun delayedCallbackDoesNotMarkOrStartAnotherWipe() {
    val marker = Marker()
    var starts = 0
    lateinit var finish: (Boolean) -> Unit
    val coordinator =
      LegacyPrivacyCleanupCoordinator(marker) { callback ->
        starts += 1
        finish = callback
      }

    coordinator.migrate()
    coordinator.migrate()

    assertEquals(1, starts)
    assertFalse(marker.complete)
    finish(true)
    assertTrue(marker.complete)
    assertEquals(1, marker.markCalls)

    coordinator.migrate()
    assertEquals(1, starts)
  }

  @Test
  fun failedAttemptCanBeRetriedAndOnlySuccessIsPersisted() {
    val marker = Marker()
    val results = ArrayDeque<Boolean>()
    var starts = 0
    val coordinator =
      LegacyPrivacyCleanupCoordinator(marker) { callback ->
        starts += 1
        callback(results.removeFirst())
      }

    results.add(false)
    coordinator.migrate()
    assertFalse(marker.complete)
    assertEquals(0, marker.markCalls)

    results.add(true)
    coordinator.migrate()
    assertTrue(marker.complete)
    assertEquals(2, starts)
    assertEquals(1, marker.markCalls)
  }

  @Test
  fun markerCommitFailureLeavesMigrationRetryable() {
    val marker = Marker(commitSucceeds = false)
    val coordinator =
      LegacyPrivacyCleanupCoordinator(marker) { callback -> callback(true) }

    coordinator.migrate()
    coordinator.migrate()

    assertFalse(marker.complete)
    assertEquals(2, marker.markCalls)
  }

  @Test
  fun explicitClearRemainsForcefulAfterMigrationCompletion() {
    val marker = Marker(complete = true)
    var starts = 0
    val coordinator =
      LegacyPrivacyCleanupCoordinator(marker) { callback ->
        starts += 1
        callback(true)
      }
    val results = mutableListOf<Boolean>()

    coordinator.forceClear(results::add)
    coordinator.forceClear(results::add)

    assertEquals(2, starts)
    assertEquals(listOf(true, true), results)
  }
}
