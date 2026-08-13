package app.daymark.glooko

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GlookoDownloadLifecycleTest {
  @Test
  fun issuedDownloadExpiresOnlyAfterItsMatchingBoundedLease() {
    val registry = GlookoIssuedDownloadRegistry(maximumLeaseMs = 1_000L)
    registry.issue("/cache/direct-one.zip", issuedAt = 100L)

    assertFalse(registry.expire("/cache/direct-one.zip", 100L, now = 1_099L))
    assertTrue(registry.activePaths().contains("/cache/direct-one.zip"))
    assertTrue(registry.expire("/cache/direct-one.zip", 100L, now = 1_100L))
    assertTrue(registry.activePaths().isEmpty())
  }

  @Test
  fun staleScheduledCleanupCannotDeleteAReissuedPath() {
    val registry = GlookoIssuedDownloadRegistry(maximumLeaseMs = 1_000L)
    registry.issue("/cache/direct-one.zip", issuedAt = 100L)
    registry.issue("/cache/direct-one.zip", issuedAt = 700L)

    assertFalse(registry.expire("/cache/direct-one.zip", 100L, now = 1_100L))
    assertTrue(registry.activePaths().contains("/cache/direct-one.zip"))
    assertTrue(registry.acknowledge("/cache/direct-one.zip"))
    assertTrue(registry.activePaths().isEmpty())
  }

  @Test
  fun sweepReturnsEveryExpiredLeaseAndPrunesMissingFiles() {
    val registry = GlookoIssuedDownloadRegistry(maximumLeaseMs = 1_000L)
    registry.issue("/cache/expired.zip", issuedAt = 100L)
    registry.issue("/cache/missing.zip", issuedAt = 900L)
    registry.issue("/cache/active.zip", issuedAt = 900L)
    registry.pruneMissing { path -> !path.endsWith("missing.zip") }

    assertEquals(listOf("/cache/expired.zip"), registry.takeExpired(now = 1_100L))
    assertEquals(setOf("/cache/active.zip"), registry.activePaths())
  }

  @Test
  fun retiredSweepSelectsLegacyFilesButNeverCurrentDirectDownloads() {
    val directory = Files.createTempDirectory("glooko-download-lifecycle").toFile()
    try {
      val legacyZip = File(directory, "c84f-export.zip").apply { writeBytes(byteArrayOf(1)) }
      val legacyPdf = File(directory, "c84f-report.pdf").apply { writeBytes(byteArrayOf(2)) }
      File(directory, "direct-current.zip").writeBytes(byteArrayOf(3))
      File(directory, "nested").mkdir()

      assertEquals(
        setOf(legacyZip.name, legacyPdf.name),
        retiredGlookoDownloadFiles(directory.listFiles()?.toList().orEmpty())
          .map(File::getName)
          .toSet(),
      )
    } finally {
      directory.deleteRecursively()
    }
  }
}
