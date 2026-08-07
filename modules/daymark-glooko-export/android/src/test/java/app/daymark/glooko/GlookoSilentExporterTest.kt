package app.daymark.glooko

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GlookoSilentExporterTest {
  @Test
  fun transitionedSubmitControlCanBecomeTheGeneratedDownload() {
    assertTrue(
      isSilentGlookoGeneratedDownloadControl(
        label = "Download PDF",
        originalSubmitLabel = "Create report",
        alreadyDownloaded = false,
        hasFileLink = false,
        insideExportDialog = true,
        expectedPdf = true,
      ),
    )
    assertFalse(
      isSilentGlookoGeneratedDownloadControl(
        label = "Create report",
        originalSubmitLabel = "Create report",
        alreadyDownloaded = false,
        hasFileLink = false,
        insideExportDialog = true,
        expectedPdf = true,
      ),
    )
    assertTrue(
      isSilentGlookoGeneratedDownloadControl(
        label = "Download",
        originalSubmitLabel = "Export",
        alreadyDownloaded = false,
        hasFileLink = false,
        insideExportDialog = true,
        expectedPdf = false,
      ),
    )
  }

  @Test
  fun alreadyDownloadedControlDoesNotHideALaterCandidate() {
    val candidates =
      listOf(
        Triple("Download", null, true),
        Triple("Download PDF", "Create report", false),
      )
    val selected =
      candidates.firstOrNull { (label, submitLabel, downloaded) ->
        isSilentGlookoGeneratedDownloadControl(
          label = label,
          originalSubmitLabel = submitLabel,
          alreadyDownloaded = downloaded,
          hasFileLink = false,
          insideExportDialog = false,
          expectedPdf = true,
        )
      }

    assertTrue(selected?.first == "Download PDF")
  }

  @Test
  fun preSubmitRetriesDoNotUseThePostSubmitTimeout() {
    assertFalse(
      hasSilentGlookoPostSubmitTimedOut(
        nowElapsedRealtime = 200_000L,
        submittedAtElapsedRealtime = null,
        downloadRequestedAtElapsedRealtime = null,
        downloadInProgress = false,
        generationTimeoutMs = 120_000L,
        downloadCaptureTimeoutMs = 30_000L,
      ),
    )
  }

  @Test
  fun submittedExportGetsTheFullGenerationWindow() {
    assertFalse(
      hasSilentGlookoPostSubmitTimedOut(
        nowElapsedRealtime = 119_999L,
        submittedAtElapsedRealtime = 0L,
        downloadRequestedAtElapsedRealtime = null,
        downloadInProgress = false,
        generationTimeoutMs = 120_000L,
        downloadCaptureTimeoutMs = 30_000L,
      ),
    )
    assertTrue(
      hasSilentGlookoPostSubmitTimedOut(
        nowElapsedRealtime = 120_000L,
        submittedAtElapsedRealtime = 0L,
        downloadRequestedAtElapsedRealtime = null,
        downloadInProgress = false,
        generationTimeoutMs = 120_000L,
        downloadCaptureTimeoutMs = 30_000L,
      ),
    )
  }

  @Test
  fun requestedDownloadGetsACaptureGraceWindow() {
    assertFalse(
      hasSilentGlookoPostSubmitTimedOut(
        nowElapsedRealtime = 129_999L,
        submittedAtElapsedRealtime = 0L,
        downloadRequestedAtElapsedRealtime = 100_000L,
        downloadInProgress = false,
        generationTimeoutMs = 120_000L,
        downloadCaptureTimeoutMs = 30_000L,
      ),
    )
    assertTrue(
      hasSilentGlookoPostSubmitTimedOut(
        nowElapsedRealtime = 130_000L,
        submittedAtElapsedRealtime = 0L,
        downloadRequestedAtElapsedRealtime = 100_000L,
        downloadInProgress = false,
        generationTimeoutMs = 120_000L,
        downloadCaptureTimeoutMs = 30_000L,
      ),
    )
  }

  @Test
  fun activeDownloadCannotBeTimedOutByTheGenerationWait() {
    assertFalse(
      hasSilentGlookoPostSubmitTimedOut(
        nowElapsedRealtime = 300_000L,
        submittedAtElapsedRealtime = 0L,
        downloadRequestedAtElapsedRealtime = null,
        downloadInProgress = true,
        generationTimeoutMs = 120_000L,
        downloadCaptureTimeoutMs = 30_000L,
      ),
    )
  }

  @Test
  fun watchdogGivesEveryLatePostSubmitPhaseItsFullWindow() {
    assertTrue(
      silentGlookoWatchdogDeadline(
        exportStartedAtElapsedRealtime = 0L,
        submittedAtElapsedRealtime = 290_000L,
        downloadRequestedAtElapsedRealtime = null,
        downloadStartedAtElapsedRealtime = null,
        preSubmitTimeoutMs = 300_000L,
        generationTimeoutMs = 120_000L,
        downloadCaptureTimeoutMs = 30_000L,
        downloadTransferTimeoutMs = 150_000L,
      ) == 410_000L,
    )
    assertTrue(
      silentGlookoWatchdogDeadline(
        exportStartedAtElapsedRealtime = 0L,
        submittedAtElapsedRealtime = 290_000L,
        downloadRequestedAtElapsedRealtime = 405_000L,
        downloadStartedAtElapsedRealtime = null,
        preSubmitTimeoutMs = 300_000L,
        generationTimeoutMs = 120_000L,
        downloadCaptureTimeoutMs = 30_000L,
        downloadTransferTimeoutMs = 150_000L,
      ) == 435_000L,
    )
    assertTrue(
      silentGlookoWatchdogDeadline(
        exportStartedAtElapsedRealtime = 0L,
        submittedAtElapsedRealtime = 290_000L,
        downloadRequestedAtElapsedRealtime = 405_000L,
        downloadStartedAtElapsedRealtime = 434_000L,
        preSubmitTimeoutMs = 300_000L,
        generationTimeoutMs = 120_000L,
        downloadCaptureTimeoutMs = 30_000L,
        downloadTransferTimeoutMs = 150_000L,
      ) == 584_000L,
    )
  }
}
