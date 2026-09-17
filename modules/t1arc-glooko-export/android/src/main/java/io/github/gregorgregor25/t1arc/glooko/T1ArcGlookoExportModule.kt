package io.github.gregorgregor25.t1arc.glooko

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.util.Log
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.Serializable
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper

internal const val GLOOKO_TRACE_PREFERENCES = "t1arc_glooko_export"
internal const val GLOOKO_LAST_TRACE_KEY = "last_privacy_safe_trace"

private data class CredentialRequest(
  val requestedAt: Long = System.currentTimeMillis(),
  val existingDataBindingRequired: Boolean = false,
) : Serializable

private data class CredentialResult(
  val status: String,
  val maskedEmail: String? = null,
  val credentialGeneration: Long? = null,
  val timeZone: String? = null,
  val existingDataBindingApproved: Boolean = false,
)

private data class ExtractedReport(
  val text: String,
  val pageTexts: List<String>,
)

private data class PumpTrackInterval(
  val dateLabel: String,
  val startMinute: Int,
  val endMinute: Int,
  val kind: String,
  val pageNumber: Int,
)

// Glooko's Daily Overview plot runs from x=71.11pt to x=588.10pt on the
// 612pt report page. The previous 10%-97% approximation shifted the first
// samples by almost half an hour and the last samples by about 15 minutes.
// Fractions keep the mapping stable when Android renders the page at a
// different pixel density.
internal const val GLOOKO_DAILY_PLOT_LEFT_FRACTION = 0.1161928105
internal const val GLOOKO_DAILY_PLOT_RIGHT_FRACTION = 0.9609477124

internal fun glookoDailyPlotX(
  bitmapWidth: Int,
  minute: Double,
): Int {
  require(bitmapWidth > 0) { "The report bitmap width must be positive." }
  require(minute in 0.0..(24.0 * 60.0)) {
    "The report minute must be within one day."
  }
  val xStart = bitmapWidth * GLOOKO_DAILY_PLOT_LEFT_FRACTION
  val xEnd = bitmapWidth * GLOOKO_DAILY_PLOT_RIGHT_FRACTION
  return (
    xStart +
      (xEnd - xStart) * (minute / (24.0 * 60.0))
  ).toInt()
}

private fun SilentGlookoExportResult.toBridgeResult(): Map<String, Any> =
  buildMap {
    put("status", status)
    uri?.let { put("uri", it) }
    fileName?.let { put("fileName", it) }
    if (byteLength > 0) put("byteLength", byteLength.toDouble())
    message?.let { put("message", it) }
    diagnostic?.let { put("diagnostic", it) }
    reason?.let { put("reason", it) }
    credentialGeneration?.let {
      put("credentialGeneration", it.toDouble())
    }
    accountFingerprint?.let { put("accountFingerprint", it) }
    timeZone?.let { put("timeZone", it) }
  }

private fun readReportBytes(context: Context, uriValue: String): ByteArray {
  val uri = Uri.parse(uriValue)
  val input =
    if (uri.scheme.equals("file", ignoreCase = true)) {
      FileInputStream(File(requireNotNull(uri.path)))
    } else {
      requireNotNull(context.contentResolver.openInputStream(uri)) {
        "The selected Glooko report could not be opened."
      }
    }
  val bytes =
    input.use { source ->
      val output = ByteArrayOutputStream()
      val buffer = ByteArray(16 * 1024)
      var total = 0
      while (true) {
        val read = source.read(buffer)
        if (read < 0) break
        total += read
        require(total <= 25 * 1024 * 1024) {
          "The selected Glooko report exceeds the 25 MB safety limit."
        }
        output.write(buffer, 0, read)
      }
      output.toByteArray()
    }
  require(
    bytes.size >= 5 &&
      bytes[0] == '%'.code.toByte() &&
      bytes[1] == 'P'.code.toByte() &&
      bytes[2] == 'D'.code.toByte() &&
      bytes[3] == 'F'.code.toByte(),
  ) {
    "The selected file is not a PDF report."
  }
  return bytes
}

private fun extractReport(bytes: ByteArray): ExtractedReport =
  PDDocument.load(bytes).use { document ->
    val text = PDFTextStripper().getText(document)
    val splitPages = text.split('\u000C')
    val pageTexts =
      if (splitPages.size >= document.numberOfPages) {
        splitPages.take(document.numberOfPages)
      } else {
        (1..document.numberOfPages).map { pageNumber ->
          PDFTextStripper().apply {
            startPage = pageNumber
            endPage = pageNumber
          }.getText(document)
        }
      }
    ExtractedReport(text = text, pageTexts = pageTexts)
  }

private fun activityColour(red: Int, green: Int, blue: Int): Boolean =
  (
    red >= 120 &&
      green >= 185 &&
      blue >= 185 &&
      kotlin.math.abs(green - blue) <= 18 &&
      minOf(green, blue) - red >= 20
  ) ||
    (
      green >= 120 &&
        green - red >= 45 &&
        green - blue >= 15
    )

private fun pauseColour(red: Int, green: Int, blue: Int): Boolean =
  red >= 155 &&
    red - green >= 60 &&
    red - blue >= 45 &&
    kotlin.math.abs(green - blue) <= 40

private fun colourCount(
  bitmap: Bitmap,
  x: Int,
  yStart: Int,
  yEnd: Int,
  predicate: (Int, Int, Int) -> Boolean,
): Int {
  var matches = 0
  for (y in yStart.coerceAtLeast(0)..yEnd.coerceAtMost(bitmap.height - 1)) {
    val colour = bitmap.getPixel(x.coerceIn(0, bitmap.width - 1), y)
    if (
      predicate(
        Color.red(colour),
        Color.green(colour),
        Color.blue(colour),
      )
    ) {
      matches += 1
    }
  }
  return matches
}

private fun flaggedRuns(flags: List<Boolean>): List<Pair<Int, Int>> {
  val runs = mutableListOf<Pair<Int, Int>>()
  var start: Int? = null
  for (index in 0..flags.size) {
    val active = index < flags.size && flags[index]
    if (active && start == null) start = index * 5
    if (!active && start != null) {
      val end = index * 5
      if (end > start) runs += start to end
      start = null
    }
  }
  return runs
}

private data class PixelBand(
  val yStart: Int,
  val yEnd: Int,
  val rowMatches: Int,
)

private fun findTrackBand(
  bitmap: Bitmap,
  predicate: (Int, Int, Int) -> Boolean,
): PixelBand? {
  val xStart = glookoDailyPlotX(bitmap.width, 0.0)
  val xEnd = glookoDailyPlotX(bitmap.width, 24.0 * 60.0)
  val yStart = (bitmap.height * 0.48).toInt()
  val yEnd = (bitmap.height * 0.72).toInt()
  var bestY = -1
  var bestMatches = 0
  for (y in yStart..yEnd) {
    var matches = 0
    for (x in xStart..xEnd step 2) {
      val colour = bitmap.getPixel(x, y)
      if (
        predicate(
          Color.red(colour),
          Color.green(colour),
          Color.blue(colour),
        )
      ) {
        matches += 1
      }
    }
    if (matches > bestMatches) {
      bestY = y
      bestMatches = matches
    }
  }
  if (bestY < 0 || bestMatches < 8) return null
  val padding = (bitmap.height * (8.0 / 792.0)).toInt().coerceAtLeast(4)
  return PixelBand(
    yStart = (bestY - padding).coerceAtLeast(0),
    yEnd = (bestY + padding).coerceAtMost(bitmap.height - 1),
    rowMatches = bestMatches,
  )
}

private fun extractTrackRuns(
  bitmap: Bitmap,
  band: PixelBand?,
  threshold: Int,
  predicate: (Int, Int, Int) -> Boolean,
): List<Pair<Int, Int>> {
  if (band == null) return emptyList()
  val flags =
    (0 until 288).map { index ->
      val minute = index * 5 + 2.5
      val x = glookoDailyPlotX(bitmap.width, minute)
      colourCount(bitmap, x, band.yStart, band.yEnd, predicate) >= threshold
    }
  return flaggedRuns(flags)
}

private val dailyChartDateDayFirst =
  Regex(
    "(?:^|\\n)\\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)," +
      "\\s+(\\d{1,2})\\s+([A-Za-z]{3})\\s+\\d{4}\\s*(?:\\n|$)",
    RegexOption.IGNORE_CASE,
  )

private val dailyChartDateMonthFirst =
  Regex(
    "(?:^|\\n)\\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)," +
      "\\s+([A-Za-z]{3})\\s+(\\d{1,2}),?\\s+\\d{4}\\s*(?:\\n|$)",
    RegexOption.IGNORE_CASE,
  )

internal fun glookoDailyChartDateLabel(pageText: String): String? {
  dailyChartDateDayFirst.find(pageText)?.let { match ->
    return "${match.groupValues[1]}/${match.groupValues[2]}"
  }
  dailyChartDateMonthFirst.find(pageText)?.let { match ->
    return "${match.groupValues[2]}/${match.groupValues[1]}"
  }
  return null
}

internal fun glookoReportSubject(text: String): String? {
  val match =
    Regex(
      """(?im)^\s*([^\r\n]{1,160}?)\s+DOB:\s*((?:[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})|(?:\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})|(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}))""",
    ).find(text) ?: return null
  val name =
    match.groupValues[1]
      .lowercase()
      .replace(Regex("\\s+"), " ")
      .trim()
  val dob =
    match.groupValues[2]
      .lowercase()
      .replace(Regex("\\s+"), " ")
      .trim()
  return "$name|$dob".takeIf { name.length >= 2 && dob.length >= 6 }
}

private fun extractPumpTrackIntervals(
  context: Context,
  bytes: ByteArray,
  pageTexts: List<String>,
): List<PumpTrackInterval> {
  val dailyPages =
    pageTexts.mapIndexedNotNull { index, pageText ->
      if (
        !pageText.contains("Daily Overview", ignoreCase = true) ||
        !pageText.contains("OP5 BASAL", ignoreCase = true)
      ) {
        return@mapIndexedNotNull null
      }
      val dateLabel =
        glookoDailyChartDateLabel(pageText) ?: return@mapIndexedNotNull null
      index to dateLabel
    }
  Log.i(
    "T1ArcGlooko",
    "Found ${dailyPages.size} Daily Overview chart pages in the report",
  )
  if (dailyPages.isEmpty()) return emptyList()

  val rendererDirectory =
    File(context.cacheDir, GLOOKO_RENDERER_DIRECTORY).apply {
      check(exists() || mkdirs()) {
        "The private Glooko report workspace could not be created."
      }
    }
  val temporary =
    File.createTempFile(GLOOKO_RENDERER_PREFIX, ".pdf", rendererDirectory)
  return try {
    FileOutputStream(temporary).use { it.write(bytes) }
    ParcelFileDescriptor.open(
      temporary,
      ParcelFileDescriptor.MODE_READ_ONLY,
    ).use { descriptor ->
      PdfRenderer(descriptor).use { renderer ->
        dailyPages.flatMap { (pageIndex, dateLabel) ->
          renderer.openPage(pageIndex).use { page ->
            val bitmap =
              Bitmap.createBitmap(
                page.width * 2,
                page.height * 2,
                Bitmap.Config.ARGB_8888,
              )
            try {
              bitmap.eraseColor(Color.WHITE)
              val renderScale = 2f
              val renderTransform =
                Matrix().apply {
                  setScale(renderScale, renderScale)
                }
              page.render(
                bitmap,
                null,
                renderTransform,
                PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY,
              )
              val activityBand = findTrackBand(bitmap, ::activityColour)
              val pauseBand = findTrackBand(bitmap, ::pauseColour)
              if (pageIndex == dailyPages.first().first) {
                Log.i(
                  "T1ArcGlooko",
                  "Daily page raster ${page.width}x${page.height}; " +
                    "activity-row matches ${activityBand?.rowMatches ?: 0}; " +
                    "pause-row matches ${pauseBand?.rowMatches ?: 0}",
                )
              }
              val activity =
                extractTrackRuns(
                  bitmap,
                  band = activityBand,
                  threshold = 3,
                  predicate = ::activityColour,
                ).map { (start, end) ->
                  PumpTrackInterval(
                    dateLabel,
                    start,
                    end,
                    "activity-mode",
                    pageIndex + 1,
                  )
                }
              val pauses =
                extractTrackRuns(
                  bitmap,
                  band = pauseBand,
                  threshold = 3,
                  predicate = ::pauseColour,
                ).map { (start, end) ->
                  PumpTrackInterval(
                    dateLabel,
                    start,
                    end,
                    "automated-pause",
                    pageIndex + 1,
                  )
                }
              activity + pauses
            } finally {
              bitmap.recycle()
            }
          }
        }
      }
    }
  } finally {
    if (temporary.exists() && !temporary.delete()) {
      Log.w(
        "T1ArcGlooko",
        "A private report-rendering file could not be removed; cleanup will retry later.",
      )
      GlookoReportArtifactCleanup.scheduleExpirySweep(context)
    }
  }
}

private class GlookoCredentialContract :
  AppContextActivityResultContract<CredentialRequest, CredentialResult> {
  override fun createIntent(
    context: Context,
    input: CredentialRequest,
  ): Intent =
    Intent(context, GlookoCredentialActivity::class.java).apply {
      putExtra(
        GlookoCredentialActivity.EXTRA_EXISTING_DATA_BINDING_REQUIRED,
        input.existingDataBindingRequired,
      )
    }

  override fun parseResult(
    input: CredentialRequest,
    resultCode: Int,
    intent: Intent?,
  ): CredentialResult =
    CredentialResult(
      status =
        if (
          resultCode == Activity.RESULT_OK &&
          intent?.getStringExtra(GlookoCredentialActivity.RESULT_STATUS) == "saved"
        ) {
          "saved"
        } else {
          "cancelled"
        },
      maskedEmail =
        intent?.getStringExtra(
          GlookoCredentialActivity.RESULT_MASKED_EMAIL,
        ),
      credentialGeneration =
        intent
          ?.takeIf {
            it.hasExtra(
              GlookoCredentialActivity.RESULT_CREDENTIAL_GENERATION,
            )
          }
          ?.getLongExtra(
            GlookoCredentialActivity.RESULT_CREDENTIAL_GENERATION,
            0L,
          ),
      timeZone =
        intent?.getStringExtra(
          GlookoCredentialActivity.RESULT_TIME_ZONE,
        ),
      existingDataBindingApproved =
        intent?.getBooleanExtra(
          GlookoCredentialActivity.RESULT_EXISTING_DATA_BINDING_APPROVED,
          false,
        ) == true,
    )
}

class T1ArcGlookoExportModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T1ArcGlookoExport")

    lateinit var credentialLauncher:
      AppContextActivityResultLauncher<CredentialRequest, CredentialResult>

    OnCreate {
      appContext.reactContext?.let { context ->
        if (!GlookoReportArtifactCleanup.sweepAtStartup(context)) {
          Log.w(
            "T1ArcGlooko",
            "Private Glooko staging cleanup was incomplete at startup and will retry later.",
          )
        }
      }
    }

    OnActivityEntersForeground {
      appContext.reactContext?.let { context ->
        if (!GlookoReportArtifactCleanup.sweepInForeground(context)) {
          Log.w(
            "T1ArcGlooko",
            "Private Glooko staging cleanup was incomplete in the foreground and will retry later.",
          )
        }
      }
    }

    RegisterActivityContracts {
      credentialLauncher =
        registerForActivityResult(GlookoCredentialContract())
    }

    AsyncFunction("setRegionalPreferencesAsync") Coroutine {
        timeZone: String,
        regionValue: String,
      ->
      val context = requireNotNull(appContext.reactContext)
      val region =
        runCatching { GlookoRegion.valueOf(regionValue.uppercase()) }
          .getOrElse { throw IllegalArgumentException("The Glooko region is invalid.") }
      GlookoRegionalPreferences(context).save(timeZone, region)
      true
    }

    AsyncFunction("startExportAsync") Coroutine { days: Int ->
      require(days in 1..90) { "Glooko export range must be between 1 and 90 days." }
      val context = requireNotNull(appContext.reactContext)
      GlookoDirectExporter(context).exportRecent(days).toBridgeResult()
    }

    AsyncFunction("startRangeExportAsync") Coroutine { startDate: String, endDate: String ->
      val start =
        runCatching { LocalDate.parse(startDate) }.getOrElse {
          throw IllegalArgumentException("Glooko export start date is invalid.")
        }
      val end =
        runCatching { LocalDate.parse(endDate) }.getOrElse {
          throw IllegalArgumentException("Glooko export end date is invalid.")
        }
      val days = ChronoUnit.DAYS.between(start, end) + 1
      require(days in 1..90) {
        "Glooko custom exports must contain between 1 and 90 calendar days."
      }
      val context = requireNotNull(appContext.reactContext)
      GlookoDirectExporter(context).export(start, end).toBridgeResult()
    }

    AsyncFunction("startSilentExportAsync") Coroutine { days: Int ->
      require(days in 1..90) { "Glooko export range must be between 1 and 90 days." }
      val context = requireNotNull(appContext.reactContext)
      GlookoDirectExporter(context).exportRecent(days).toBridgeResult()
    }

    AsyncFunction("startSilentReportExportAsync") Coroutine { days: Int ->
      require(days in 7..90) {
        "Glooko PDF report range must be between 7 and 90 days."
      }
      val context = requireNotNull(appContext.reactContext)
      GlookoDirectExporter(context).exportRecentReport(days).toBridgeResult()
    }

    AsyncFunction("startSilentRangeExportAsync") Coroutine {
        startDate: String,
        endDate: String,
      ->
      val start =
        runCatching { LocalDate.parse(startDate) }.getOrElse {
          throw IllegalArgumentException("Glooko export start date is invalid.")
        }
      val end =
        runCatching { LocalDate.parse(endDate) }.getOrElse {
          throw IllegalArgumentException("Glooko export end date is invalid.")
        }
      val days = ChronoUnit.DAYS.between(start, end) + 1
      require(days in 1..90) {
        "Glooko custom exports must contain between 1 and 90 calendar days."
      }
      val context = requireNotNull(appContext.reactContext)
      GlookoDirectExporter(context).export(start, end).toBridgeResult()
    }

    AsyncFunction("getLastTraceAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      context
        .getSharedPreferences(GLOOKO_TRACE_PREFERENCES, Context.MODE_PRIVATE)
        .getString(GLOOKO_LAST_TRACE_KEY, null)
    }

    AsyncFunction("releaseDownloadAsync") Coroutine { uriValue: String ->
      val context = requireNotNull(appContext.reactContext)
      GlookoDirectExporter.releaseDownload(context, uriValue)
    }

    AsyncFunction("releaseReportArtifactAsync") Coroutine { uriValue: String ->
      val context = requireNotNull(appContext.reactContext)
      GlookoReportArtifactCleanup.releaseManualPickerReport(context, uriValue)
    }

    AsyncFunction("getPendingSharedReportAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      GlookoSharedReportInbox.pending(context)?.let { report ->
        mapOf(
          "uri" to report.uri,
          "fileName" to report.fileName,
          "byteLength" to report.byteLength.toDouble(),
        )
      }
    }

    AsyncFunction("acknowledgeSharedReportAsync") Coroutine { uriValue: String ->
      val context = requireNotNull(appContext.reactContext)
      GlookoSharedReportInbox.acknowledge(context, uriValue)
    }

    AsyncFunction("releaseReportInboxAccessAsync") Coroutine { uriValue: String ->
      val context = requireNotNull(appContext.reactContext)
      GlookoReportArtifactCleanup.releaseReportFolderGrant(context, uriValue)
    }

    AsyncFunction("clearReportArtifactsAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      GlookoReportArtifactCleanup.clearAll(context)
    }

    AsyncFunction("extractReportTextAsync") Coroutine { uriValue: String ->
      val context = requireNotNull(appContext.reactContext)
      val bytes = readReportBytes(context, uriValue)
      PDFBoxResourceLoader.init(context.applicationContext)
      val text =
        try {
          extractReport(bytes).text
        } finally {
          bytes.fill(0)
        }
      require(text.length <= 2_000_000) {
        "The selected Glooko report contains too much text to process safely."
      }
      text
    }

    AsyncFunction("extractReportDataAsync") Coroutine { uriValue: String ->
      val context = requireNotNull(appContext.reactContext)
      val bytes = readReportBytes(context, uriValue)
      PDFBoxResourceLoader.init(context.applicationContext)
      try {
        val report = extractReport(bytes)
        require(report.text.length <= 2_000_000) {
          "The selected Glooko report contains too much text to process safely."
        }
        val intervals =
          extractPumpTrackIntervals(context, bytes, report.pageTexts)
        val activityCount = intervals.count { it.kind == "activity-mode" }
        val pauseCount = intervals.count { it.kind == "automated-pause" }
        Log.i(
          "T1ArcGlooko",
          "Indexed ${intervals.size} pump-state intervals " +
            "($activityCount activity, $pauseCount automated pause) " +
            "from ${report.pageTexts.size} report pages",
        )
        buildMap<String, Any> {
          put("text", report.text)
          glookoReportSubject(report.text)?.let { subject ->
            put(
              "subjectFingerprint",
              GlookoAccountFingerprint().forReportSubject(subject),
            )
          }
          put(
            "pumpTrackIntervals",
            intervals.map { interval ->
              buildMap<String, Any> {
                put("dateLabel", interval.dateLabel)
                put("startMinute", interval.startMinute)
                put("endMinute", interval.endMinute)
                put("kind", interval.kind)
                put("pageNumber", interval.pageNumber)
              }
            },
          )
        }
      } finally {
        bytes.fill(0)
      }
    }

    AsyncFunction("openCredentialSetupAsync") Coroutine {
        existingDataBindingRequired: Boolean,
      ->
      val result =
        credentialLauncher.launch(
          CredentialRequest(
            existingDataBindingRequired = existingDataBindingRequired,
          ),
        )
      buildMap<String, Any> {
        put("status", result.status)
        result.maskedEmail?.let { put("maskedEmail", it) }
        result.credentialGeneration?.let {
          put("credentialGeneration", it.toDouble())
        }
        result.timeZone?.let { put("timeZone", it) }
        put(
          "existingDataBindingApproved",
          result.existingDataBindingApproved,
        )
      }
    }

    AsyncFunction("getCredentialStatusAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      val vault = GlookoCredentialVault(context)
      val configured = vault.isConfigured()
      buildMap<String, Any> {
        put("configured", configured)
        vault.maskedEmail()?.let { put("maskedEmail", it) }
        vault.region()?.let { put("region", it.name.lowercase()) }
        vault.timeZone()?.let { put("timeZone", it.id) }
        put(
          "credentialGeneration",
          vault.credentialGeneration().toDouble(),
        )
      }
    }

    AsyncFunction("beginCredentialCommitAsync") Coroutine {
        credentialGeneration: Double,
      ->
      val context = requireNotNull(appContext.reactContext)
      val expected = credentialGeneration.toLong()
      val valid =
        credentialGeneration.isFinite() &&
          credentialGeneration == expected.toDouble() &&
          expected > 0L
      val vault = GlookoCredentialVault(context)
      val token =
        if (valid) {
          GlookoCredentialCommitGate.beginCommit(expected) {
            vault.isConfigured() &&
              vault.credentialGeneration() == expected
          }
        } else {
          null
        }
      buildMap<String, Any> {
        put("acquired", token != null)
        token?.let { put("token", it) }
      }
    }

    AsyncFunction("endCredentialCommitAsync") Coroutine { token: String ->
      GlookoCredentialCommitGate.endCommit(token)
    }

    AsyncFunction("beginDataCommitAsync") Coroutine { ->
      val token = GlookoCredentialCommitGate.beginDataCommit()
      buildMap<String, Any> {
        put("acquired", token != null)
        token?.let { put("token", it) }
      }
    }

    AsyncFunction("endDataCommitAsync") Coroutine { token: String ->
      GlookoCredentialCommitGate.endCommit(token)
    }

    AsyncFunction("beginDataResetAsync") Coroutine { ->
      val token = GlookoCredentialCommitGate.beginDataReset()
      buildMap<String, Any> {
        put("acquired", token != null)
        token?.let { put("token", it) }
      }
    }

    AsyncFunction("endDataResetAsync") Coroutine { token: String ->
      val context = requireNotNull(appContext.reactContext)
      GlookoCredentialVault(context).finishDataReset(token)
    }

    AsyncFunction("clearCredentialsAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      GlookoCredentialVault(context).clear()
      GlookoReportArtifactCleanup.clearAll(context)
    }

    AsyncFunction("clearSessionAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      GlookoCredentialVault(context).clear()
      GlookoReportArtifactCleanup.clearAll(context)
    }
  }
}
