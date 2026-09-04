package io.github.gregorgregor25.t1arc.glooko

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GlookoReportArtifactCleanupTest {
  @Test
  fun rendererSweepSelectsOnlyOwnedPdfScratchFiles() {
    val directory = Files.createTempDirectory("glooko-renderer-cleanup").toFile()
    try {
      val owned = File(directory, "${GLOOKO_RENDERER_PREFIX}one.pdf").apply {
        writeBytes(byteArrayOf(1))
      }
      File(directory, "${GLOOKO_RENDERER_PREFIX}one.zip").writeBytes(byteArrayOf(2))
      File(directory, "unrelated.pdf").writeBytes(byteArrayOf(3))

      assertEquals(listOf(owned), rendererArtifacts(directory.listFiles()!!.toList()))
    } finally {
      directory.deleteRecursively()
    }
  }

  @Test
  fun pickerSweepSelectsPdfCopiesWithoutTouchingOtherImports() {
    val directory = Files.createTempDirectory("glooko-picker-cleanup").toFile()
    try {
      val report = File(directory, "picked-report.PDF").apply {
        writeBytes(byteArrayOf(1))
      }
      File(directory, "glooko-export.zip").writeBytes(byteArrayOf(2))
      File(directory, "dexcom.csv").writeBytes(byteArrayOf(3))

      assertEquals(
        listOf(report),
        manualPickerReportArtifacts(directory.listFiles()!!.toList()),
      )
    } finally {
      directory.deleteRecursively()
    }
  }

  @Test
  fun expiryIsBoundedAndDoesNotTreatFutureTimestampsAsOld() {
    val directory = Files.createTempDirectory("glooko-expiry").toFile()
    try {
      val file = File(directory, "report.pdf").apply { writeBytes(byteArrayOf(1)) }
      assertTrue(file.setLastModified(1_000L))
      assertFalse(isExpiredArtifact(file, now = 1_999L, maximumAgeMs = 1_000L))
      assertTrue(isExpiredArtifact(file, now = 2_000L, maximumAgeMs = 1_000L))
      assertFalse(isExpiredArtifact(file, now = 999L, maximumAgeMs = 1_000L))
    } finally {
      directory.deleteRecursively()
    }
  }

  @Test
  fun privateDeletionIsIdempotent() {
    val directory = Files.createTempDirectory("glooko-delete").toFile()
    try {
      val first = File(directory, "first.pdf").apply { writeBytes(byteArrayOf(1)) }
      val missing = File(directory, "missing.pdf")

      assertTrue(deletePrivateArtifacts(listOf(first, missing)))
      assertFalse(first.exists())
      assertTrue(deletePrivateArtifacts(listOf(first, missing)))
    } finally {
      directory.deleteRecursively()
    }
  }
}
