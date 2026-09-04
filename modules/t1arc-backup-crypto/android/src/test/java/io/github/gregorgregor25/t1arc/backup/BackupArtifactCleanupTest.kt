package io.github.gregorgregor25.t1arc.backup

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BackupArtifactCleanupTest {
  @Test
  fun cleanupDeletesOnlyExpiredOwnedPlaintextContainers() {
    val directory = Files.createTempDirectory("backup-plaintext-cleanup").toFile()
    try {
      val expired =
        File(directory, "${PLAINTEXT_BACKUP_PREFIX}old-abc$PLAINTEXT_BACKUP_SUFFIX")
          .apply { writeBytes(byteArrayOf(1)) }
      val current =
        File(directory, "${PLAINTEXT_BACKUP_PREFIX}current-abc$PLAINTEXT_BACKUP_SUFFIX")
          .apply { writeBytes(byteArrayOf(2)) }
      val future =
        File(directory, "${PLAINTEXT_BACKUP_PREFIX}future-abc$PLAINTEXT_BACKUP_SUFFIX")
          .apply { writeBytes(byteArrayOf(3)) }
      val unrelated = File(directory, "user-health-backup.container").apply {
        writeBytes(byteArrayOf(4))
      }
      val wrongSuffix = File(directory, "${PLAINTEXT_BACKUP_PREFIX}old-abc.json").apply {
        writeBytes(byteArrayOf(5))
      }
      val matchingDirectory =
        File(directory, "${PLAINTEXT_BACKUP_PREFIX}folder$PLAINTEXT_BACKUP_SUFFIX")
          .apply { mkdir() }

      assertTrue(expired.setLastModified(1_000L))
      assertTrue(current.setLastModified(1_001L))
      assertTrue(future.setLastModified(2_001L))
      assertTrue(unrelated.setLastModified(1_000L))
      assertTrue(wrongSuffix.setLastModified(1_000L))
      assertTrue(matchingDirectory.setLastModified(1_000L))

      assertEquals(
        listOf(expired),
        expiredPlaintextBackupArtifacts(
          directory.listFiles()!!.asIterable(),
          now = 2_000L,
          maximumAgeMs = 1_000L,
        ),
      )
      assertTrue(
        deleteExpiredPlaintextBackupArtifacts(
          directory,
          now = 2_000L,
          maximumAgeMs = 1_000L,
        ),
      )
      assertFalse(expired.exists())
      assertTrue(current.exists())
      assertTrue(future.exists())
      assertTrue(unrelated.exists())
      assertTrue(wrongSuffix.exists())
      assertTrue(matchingDirectory.exists())
    } finally {
      directory.deleteRecursively()
    }
  }
}
