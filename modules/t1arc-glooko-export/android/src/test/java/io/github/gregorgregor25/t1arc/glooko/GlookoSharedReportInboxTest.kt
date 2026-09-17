package io.github.gregorgregor25.t1arc.glooko

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GlookoSharedReportInboxTest {
  @Test
  fun acceptsOnlyVersionedPdfHeaders() {
    assertTrue(isPdfHeader("%PDF-1.7".toByteArray()))
    assertFalse(isPdfHeader("%PDF".toByteArray()))
    assertFalse(isPdfHeader("%PDFX1.7".toByteArray()))
    assertFalse(isPdfHeader("<html>".toByteArray()))
  }

  @Test
  fun pruningRemovesCrashPartsExpiredReportsAndOverflowOnly() {
    val directory = Files.createTempDirectory("glooko-shared-inbox").toFile()
    val now = SHARED_REPORT_MAX_AGE_MS + 100_000L
    try {
      val reports =
        (1..6).map { index ->
          File(directory, "$index.pdf").apply {
            writeBytes("%PDF-$index".toByteArray())
            assertTrue(setLastModified(now - index * 1_000L))
            File(absolutePath + ".name").writeText("report-$index.pdf")
          }
        }
      val expired = File(directory, "expired.pdf").apply {
        writeBytes("%PDF-old".toByteArray())
        assertTrue(setLastModified(now - SHARED_REPORT_MAX_AGE_MS))
        File(absolutePath + ".name").writeText("expired.pdf")
      }
      val crashPart = File(directory, ".crash.part").apply { writeBytes(byteArrayOf(1)) }
      val orphanSidecar = File(directory, "missing.pdf.name").apply { writeText("missing.pdf") }

      assertTrue(pruneSharedReportInbox(directory, now))

      assertFalse(expired.exists())
      assertFalse(crashPart.exists())
      assertFalse(orphanSidecar.exists())
      assertEquals(
        reports.take(4).map(File::getName).toSet(),
        directory
          .listFiles { file -> file.extension.equals("pdf", true) }
          .orEmpty()
          .map(File::getName)
          .toSet(),
      )
      reports.take(4).forEach { report ->
        assertTrue(File(report.absolutePath + ".name").exists())
      }
      reports.drop(4).forEach { report ->
        assertFalse(File(report.absolutePath + ".name").exists())
      }
    } finally {
      directory.deleteRecursively()
    }
  }
}
