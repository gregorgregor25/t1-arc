package io.github.gregorgregor25.t1arc.notificationsource

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationQueueReadPolicyTest {
  @Test
  fun backupOnlyQueueUsesNonDestructiveRecovery() {
    assertEquals(
      NotificationQueueReadPath.OPEN_LEGACY_BACKUP,
      notificationQueueReadPath(
        baseExists = false,
        baseLength = 0L,
        legacyBackupExists = true,
        pendingNewExists = false,
      ),
    )
  }

  @Test
  fun backupWinsOverAnEmptyInterruptedBase() {
    assertEquals(
      NotificationQueueReadPath.OPEN_LEGACY_BACKUP,
      notificationQueueReadPath(
        baseExists = true,
        baseLength = 0L,
        legacyBackupExists = true,
        pendingNewExists = false,
      ),
    )
  }

  @Test
  fun unfinishedFirstWriteWithoutACommittedQueueRemainsEmpty() {
    assertEquals(
      NotificationQueueReadPath.EMPTY,
      notificationQueueReadPath(
        baseExists = false,
        baseLength = 0L,
        legacyBackupExists = false,
        pendingNewExists = true,
      ),
    )
  }

  @Test
  fun nonEmptyBaseUsesAtomicFileRead() {
    assertEquals(
      NotificationQueueReadPath.OPEN_ATOMIC_FILE,
      notificationQueueReadPath(
        baseExists = true,
        baseLength = 42L,
        legacyBackupExists = false,
        pendingNewExists = false,
      ),
    )
  }

  @Test
  fun api26InterruptedFirstWriteIsDiscardedOnlyAfterStructuralProof() {
    // Android 8 AtomicFile writes a first-ever transaction directly to the
    // base path. Process death can therefore leave a short, non-empty base
    // without either the legacy .bak or modern .new marker.
    assertEquals(
      NotificationQueueReadPath.OPEN_ATOMIC_FILE,
      notificationQueueReadPath(
        baseExists = true,
        baseLength = 7L,
        legacyBackupExists = false,
        pendingNewExists = false,
      ),
    )
    assertEquals(
      NotificationQueueFailureAction.DISCARD_EXACT_ARTIFACTS,
      notificationQueueFailureAction(
        failure = NotificationQueueFailure.STRUCTURALLY_INCOMPLETE,
      ),
    )
  }

  @Test
  fun partialOrUnauthenticatedLegacyBackupCannotWedgeTheQueueForever() {
    listOf(
      NotificationQueueFailure.STRUCTURALLY_INCOMPLETE,
      NotificationQueueFailure.CIPHERTEXT_AUTHENTICATION_FAILED,
    ).forEach { failure ->
      assertEquals(
        NotificationQueueFailureAction.DISCARD_EXACT_ARTIFACTS,
        notificationQueueFailureAction(
          failure = failure,
        ),
      )
    }
  }

  @Test
  fun onlyProvenStructuralOrAuthenticationFailuresAreSelfHealed() {
    assertEquals(
      NotificationQueueFailureAction.DISCARD_EXACT_ARTIFACTS,
      notificationQueueFailureAction(
        failure = NotificationQueueFailure.CIPHERTEXT_AUTHENTICATION_FAILED,
      ),
    )
    assertEquals(
      NotificationQueueFailureAction.PRESERVE,
      notificationQueueFailureAction(
        failure = NotificationQueueFailure.AUTHENTICATED_PAYLOAD_INVALID,
      ),
    )
    assertEquals(
      NotificationQueueFailureAction.PRESERVE,
      notificationQueueFailureAction(
        failure = NotificationQueueFailure.TRANSIENT_IO_OR_PROVIDER,
      ),
    )
  }

  @Test
  fun recoveryDeletesOnlyTheExactQueueArtifactsAndVerifiesAbsence() {
    val directory = Files.createTempDirectory("t1arc-notification-queue-test").toFile()
    try {
      val base = File(directory, QUEUE_FILE)
      val artifacts = listOf(base, File(base.path + ".bak"), File(base.path + ".new"))
      artifacts.forEach { it.writeText("partial ciphertext") }
      val unrelated = File(directory, "$QUEUE_FILE.keep").apply { writeText("keep") }

      assertTrue(deleteExactNotificationQueueArtifacts(artifacts))
      assertTrue(artifacts.none(File::exists))
      assertTrue(unrelated.exists())
    } finally {
      directory.deleteRecursively()
    }
  }
}
