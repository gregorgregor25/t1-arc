package io.github.gregorgregor25.t1arc.notificationsource

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationCaptureCoordinatorTest {
  private val rule =
    NotificationCaptureRule(
      packageName = "com.insulet.myblue.pdm",
      displayName = "Omnipod 5",
      captureGlucose = true,
      captureInsulin = true,
      glucoseUnit = "mmolL",
    )

  private val enabled = NotificationCaptureConfiguration(true, listOf(rule))
  private val disabled = NotificationCaptureConfiguration(false, emptyList())

  @Test
  fun callbackThatMatchedBeforeDisableCannotAppendAfterAtomicDisableAndClear() {
    val coordinator = NotificationCaptureCoordinator()
    var configuration = enabled
    val queue = mutableListOf<String>()
    var metadataPresent = true
    val pausedCallback =
      requireNotNull(
        coordinator.beginCapture(rule.packageName) { configuration },
      )

    val removed =
      coordinator.disableAndClear(
        pendingCount = queue::size,
        persistDisabledAndClearMetadata = { next ->
          configuration = next
          metadataPresent = false
          true
        },
        eraseQueueAndVerify = {
          queue.clear()
          true
        },
      )
    val retained =
      coordinator.appendIfCurrent(pausedCallback, { configuration }) {
        queue += "paused callback"
      }

    assertEquals(0, removed)
    assertEquals(disabled, configuration)
    assertFalse(metadataPresent)
    assertFalse(retained)
    assertTrue(queue.isEmpty())
  }

  @Test
  fun appendThatCompletesBeforeDisableIsCountedAndCleared() {
    val coordinator = NotificationCaptureCoordinator()
    var configuration = enabled
    val queue = mutableListOf<String>()
    val callback =
      requireNotNull(
        coordinator.beginCapture(rule.packageName) { configuration },
      )

    assertTrue(
      coordinator.appendIfCurrent(callback, { configuration }) {
        queue += "completed callback"
      },
    )
    val removed =
      coordinator.disableAndClear(
        pendingCount = queue::size,
        persistDisabledAndClearMetadata = { next ->
          configuration = next
          true
        },
        eraseQueueAndVerify = {
          queue.clear()
          true
        },
      )

    assertEquals(1, removed)
    assertTrue(queue.isEmpty())
  }

  @Test
  fun reEnableAllowsOnlyCallbacksThatStartedAfterReEnable() {
    val coordinator = NotificationCaptureCoordinator()
    var configuration = enabled
    val queue = mutableListOf<String>()
    val oldCallback =
      requireNotNull(
        coordinator.beginCapture(rule.packageName) { configuration },
      )

    coordinator.disableAndClear(
      pendingCount = queue::size,
      persistDisabledAndClearMetadata = { next ->
        configuration = next
        true
      },
      eraseQueueAndVerify = {
        queue.clear()
        true
      },
    )
    coordinator.replaceConfigurationAndClear(
      configuration = enabled,
      persistStagingDisabled = { next ->
        configuration = next
        true
      },
      eraseQueueAndVerify = {
        queue.clear()
        true
      },
      persistDesired = { next ->
        configuration = next
        true
      },
    )

    assertFalse(
      coordinator.appendIfCurrent(oldCallback, { configuration }) {
        queue += "old callback"
      },
    )
    val newCallback =
      requireNotNull(
        coordinator.beginCapture(rule.packageName) { configuration },
      )
    assertTrue(
      coordinator.appendIfCurrent(newCallback, { configuration }) {
        queue += "new callback"
      },
    )
    assertEquals(listOf("new callback"), queue)
  }

  @Test
  fun failedDisableCommitClearsPendingDataAndBlocksCaptureUntilSuccessfulReplacement() {
    val coordinator = NotificationCaptureCoordinator()
    var configuration = enabled
    val queue = mutableListOf("existing capture")
    val callback =
      requireNotNull(
        coordinator.beginCapture(rule.packageName) { configuration },
      )

    assertThrows(IllegalStateException::class.java) {
      coordinator.disableAndClear(
        pendingCount = queue::size,
        persistDisabledAndClearMetadata = { false },
        eraseQueueAndVerify = {
          queue.clear()
          true
        },
      )
    }

    assertTrue(queue.isEmpty())
    assertFalse(
      coordinator.appendIfCurrent(callback, { configuration }) {
        queue += "stale callback"
      },
    )
    assertNull(coordinator.beginCapture(rule.packageName) { configuration })

    coordinator.replaceConfigurationAndClear(
      configuration = enabled,
      persistStagingDisabled = { next ->
        configuration = next
        true
      },
      eraseQueueAndVerify = {
        queue.clear()
        true
      },
      persistDesired = { next ->
        configuration = next
        true
      },
    )
    assertTrue(coordinator.beginCapture(rule.packageName) { configuration } != null)
  }

  @Test
  fun failedErasureWithReadableRetainedQueueRejectsAndBlocksCapture() {
    val coordinator = NotificationCaptureCoordinator()
    var configuration = enabled
    val queue = mutableListOf("retained readable capture")
    val queueKeyPresent = true
    val callback =
      requireNotNull(
        coordinator.beginCapture(rule.packageName) { configuration },
      )

    assertThrows(IllegalStateException::class.java) {
      coordinator.disableAndClear(
        pendingCount = queue::size,
        persistDisabledAndClearMetadata = { next ->
          configuration = next
          true
        },
        eraseQueueAndVerify = {
          cryptographicallyEraseCapturedQueue(
            destroyKey = { /* Simulated key-store deletion failure. */ },
            keyExists = { queueKeyPresent },
            deleteArtifactsBestEffort = { /* Simulated file deletion failure. */ },
          )
        },
      )
    }

    assertEquals(listOf("retained readable capture"), queue)
    assertTrue(queueKeyPresent)
    configuration = enabled
    assertNull(coordinator.beginCapture(rule.packageName) { configuration })
    assertFalse(
      coordinator.appendIfCurrent(callback, { configuration }) {
        queue += "stale callback"
      },
    )
  }

  @Test
  fun verifiedKeyDestructionMakesLingeringCiphertextUnreadableAndUsesAFreshKey() {
    data class Ciphertext(val key: Int, val value: String)

    var activeKey: Int? = 1
    val oldCiphertext = Ciphertext(key = 1, value = "sensitive capture")
    fun open(ciphertext: Ciphertext): String? =
      ciphertext.value.takeIf { activeKey == ciphertext.key }

    val erased =
      cryptographicallyEraseCapturedQueue(
        destroyKey = { activeKey = null },
        keyExists = { activeKey != null },
        deleteArtifactsBestEffort = {
          error("Simulated undeletable AtomicFile artifact")
        },
      )

    assertTrue(erased)
    assertNull(open(oldCiphertext))
    activeKey = 2
    val newCiphertext = Ciphertext(key = 2, value = "new capture")
    assertEquals("new capture", open(newCiphertext))
    assertNull(open(oldCiphertext))
  }

  @Test
  fun failedKeyDestructionLeavesReadableCiphertextAndFailsVerification() {
    data class Ciphertext(val key: Int, val value: String)

    var activeKey: Int? = 1
    val oldCiphertext = Ciphertext(key = 1, value = "sensitive capture")

    val erased =
      cryptographicallyEraseCapturedQueue(
        destroyKey = { /* Simulated key-store deletion failure. */ },
        keyExists = { activeKey != null },
        deleteArtifactsBestEffort = { /* Simulated file deletion failure. */ },
      )

    assertFalse(erased)
    assertEquals(
      "sensitive capture",
      oldCiphertext.value.takeIf { activeKey == oldCiphertext.key },
    )
  }

  @Test
  fun changedRuleInvalidatesAnInFlightCallback() {
    val coordinator = NotificationCaptureCoordinator()
    var configuration = enabled
    val queue = mutableListOf<String>()
    val callback =
      requireNotNull(
        coordinator.beginCapture(rule.packageName) { configuration },
      )
    configuration =
      enabled.copy(
        rules = listOf(rule.copy(captureInsulin = false)),
      )

    assertFalse(
      coordinator.appendIfCurrent(callback, { configuration }) {
        queue += "changed-rule callback"
      },
    )
    assertTrue(queue.isEmpty())
  }

  @Test
  fun configurationReplacementStagesDisabledClearsQueueAndFencesOldCallbacks() {
    val coordinator = NotificationCaptureCoordinator()
    var configuration = enabled
    val queue = mutableListOf("old queued capture")
    val events = mutableListOf<String>()
    val oldCallback =
      requireNotNull(
        coordinator.beginCapture(rule.packageName) { configuration },
      )
    val replacement =
      enabled.copy(rules = listOf(rule.copy(captureInsulin = false)))

    val saved =
      coordinator.replaceConfigurationAndClear(
        configuration = replacement,
        persistStagingDisabled = { staged ->
          events += "stage"
          configuration = staged
          true
        },
        eraseQueueAndVerify = {
          events += "erase"
          queue.clear()
          true
        },
        persistDesired = { desired ->
          events += "desired"
          configuration = desired
          true
        },
      )

    assertEquals(listOf("stage", "erase", "desired"), events)
    assertEquals(replacement, saved)
    assertEquals(replacement, configuration)
    assertTrue(queue.isEmpty())
    assertFalse(
      coordinator.appendIfCurrent(oldCallback, { configuration }) {
        queue += "stale callback"
      },
    )
    assertTrue(coordinator.beginCapture(rule.packageName) { configuration } != null)
    assertEquals(1L, coordinator.currentConfigurationRevision())
  }

  @Test
  fun failedReplacementLeavesCaptureDurablyStagedDisabled() {
    val coordinator = NotificationCaptureCoordinator()
    var configuration = enabled
    var erased = false

    assertThrows(IllegalStateException::class.java) {
      coordinator.replaceConfigurationAndClear(
        configuration = enabled.copy(rules = listOf(rule.copy(captureInsulin = false))),
        persistStagingDisabled = { staged ->
          configuration = staged
          true
        },
        eraseQueueAndVerify = {
          erased = true
          true
        },
        persistDesired = { false },
      )
    }

    assertEquals(disabled, configuration)
    assertTrue(erased)
    assertNull(coordinator.beginCapture(rule.packageName) { configuration })
    assertEquals(1L, coordinator.currentConfigurationRevision())
  }
}
