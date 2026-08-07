package app.daymark.glooko

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
import android.webkit.CookieManager
import android.webkit.WebStorage
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

internal const val GLOOKO_TRACE_PREFERENCES = "daymark_glooko_export"
internal const val GLOOKO_LAST_TRACE_KEY = "last_privacy_safe_trace"

private data class ExportRequest(
  val days: Int,
  val startDate: String? = null,
  val endDate: String? = null,
) : Serializable

private data class ExportResult(
  val status: String,
  val uri: String? = null,
  val fileName: String? = null,
  val byteLength: Long = 0,
  val message: String? = null,
  val diagnostic: String? = null,
)

private data class CredentialRequest(
  val requestedAt: Long = System.currentTimeMillis(),
) : Serializable

private data class CredentialResult(
  val status: String,
  val maskedEmail: String? = null,
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
  val xStart = (bitmap.width * 0.1).toInt()
  val xEnd = (bitmap.width * 0.97).toInt()
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
  val xStart = bitmap.width * 0.1
  val xEnd = bitmap.width * 0.97
  val flags =
    (0 until 288).map { index ->
      val minute = index * 5 + 2.5
      val x =
        (xStart + (xEnd - xStart) * (minute / (24.0 * 60.0))).toInt()
      colourCount(bitmap, x, band.yStart, band.yEnd, predicate) >= threshold
    }
  return flaggedRuns(flags)
}

private val dailyChartDate =
  Regex(
    "(?:^|\\n)\\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)," +
      "\\s+(\\d{1,2})\\s+([A-Za-z]{3})\\s+\\d{4}\\s*(?:\\n|$)",
    RegexOption.IGNORE_CASE,
  )

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
      val date = dailyChartDate.find(pageText) ?: return@mapIndexedNotNull null
      index to "${date.groupValues[1]}/${date.groupValues[2]}"
    }
  Log.i(
    "T1ArcGlooko",
    "Found ${dailyPages.size} Daily Overview chart pages in the report",
  )
  if (dailyPages.isEmpty()) return emptyList()

  val temporary = File.createTempFile("t1arc-glooko-report-", ".pdf", context.cacheDir)
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
    temporary.delete()
  }
}

private class GlookoExportContract :
  AppContextActivityResultContract<ExportRequest, ExportResult> {
  override fun createIntent(context: Context, input: ExportRequest): Intent =
    Intent(context, GlookoExportActivity::class.java).apply {
      putExtra(GlookoExportActivity.EXTRA_DAYS, input.days)
      input.startDate?.let {
        putExtra(GlookoExportActivity.EXTRA_START_DATE, it)
      }
      input.endDate?.let {
        putExtra(GlookoExportActivity.EXTRA_END_DATE, it)
      }
    }

  override fun parseResult(
    input: ExportRequest,
    resultCode: Int,
    intent: Intent?,
  ): ExportResult {
    if (intent?.getStringExtra(GlookoExportActivity.RESULT_STATUS) == "cancelled") {
      return ExportResult(
        status = "cancelled",
        message = intent.getStringExtra(GlookoExportActivity.RESULT_MESSAGE),
        diagnostic = intent.getStringExtra(GlookoExportActivity.RESULT_DIAGNOSTIC),
      )
    }
    if (resultCode != Activity.RESULT_OK || intent == null) {
      return ExportResult(
        status = "cancelled",
        message = intent?.getStringExtra(GlookoExportActivity.RESULT_MESSAGE),
        diagnostic = intent?.getStringExtra(GlookoExportActivity.RESULT_DIAGNOSTIC),
      )
    }
    val uri = intent.getStringExtra(GlookoExportActivity.RESULT_URI)
    val fileName = intent.getStringExtra(GlookoExportActivity.RESULT_FILE_NAME)
    val byteLength = intent.getLongExtra(GlookoExportActivity.RESULT_BYTE_LENGTH, 0)
    if (uri.isNullOrBlank() || fileName.isNullOrBlank() || byteLength <= 0) {
      return ExportResult(
        status = "cancelled",
        message = intent.getStringExtra(GlookoExportActivity.RESULT_MESSAGE),
        diagnostic = intent.getStringExtra(GlookoExportActivity.RESULT_DIAGNOSTIC),
      )
    }
    return ExportResult(
      status = "downloaded",
      uri = uri,
      fileName = fileName,
      byteLength = byteLength,
      diagnostic = intent.getStringExtra(GlookoExportActivity.RESULT_DIAGNOSTIC),
    )
  }
}

private class GlookoCredentialContract :
  AppContextActivityResultContract<CredentialRequest, CredentialResult> {
  override fun createIntent(
    context: Context,
    input: CredentialRequest,
  ): Intent =
    Intent(context, GlookoCredentialActivity::class.java)

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
    )
}

class DaymarkGlookoExportModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DaymarkGlookoExport")

    lateinit var exportLauncher:
      AppContextActivityResultLauncher<ExportRequest, ExportResult>
    lateinit var credentialLauncher:
      AppContextActivityResultLauncher<CredentialRequest, CredentialResult>

    RegisterActivityContracts {
      exportLauncher = registerForActivityResult(GlookoExportContract())
      credentialLauncher =
        registerForActivityResult(GlookoCredentialContract())
    }

    AsyncFunction("startExportAsync") Coroutine { days: Int ->
      require(days in 1..90) { "Glooko export range must be between 1 and 90 days." }
      val result = exportLauncher.launch(ExportRequest(days))
      if (result.status == "downloaded") {
        buildMap<String, Any> {
          put("status", result.status)
          result.uri?.let { put("uri", it) }
          result.fileName?.let { put("fileName", it) }
          put("byteLength", result.byteLength.toDouble())
          result.diagnostic?.let { put("diagnostic", it) }
        }
      } else {
        buildMap<String, Any> {
          put("status", "cancelled")
          result.message?.let { put("message", it) }
          result.diagnostic?.let { put("diagnostic", it) }
        }
      }
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
      val result =
        exportLauncher.launch(
          ExportRequest(
            days = days.toInt(),
            startDate = start.toString(),
            endDate = end.toString(),
          ),
        )
      if (result.status == "downloaded") {
        buildMap<String, Any> {
          put("status", result.status)
          result.uri?.let { put("uri", it) }
          result.fileName?.let { put("fileName", it) }
          put("byteLength", result.byteLength.toDouble())
          result.diagnostic?.let { put("diagnostic", it) }
        }
      } else {
        buildMap<String, Any> {
          put("status", "cancelled")
          result.message?.let { put("message", it) }
          result.diagnostic?.let { put("diagnostic", it) }
        }
      }
    }

    AsyncFunction("startSilentExportAsync") Coroutine { days: Int ->
      require(days in 1..90) { "Glooko export range must be between 1 and 90 days." }
      val context = requireNotNull(appContext.reactContext)
      val result = GlookoSilentExporter(context).export(days)
      buildMap<String, Any> {
        put("status", result.status)
        result.uri?.let { put("uri", it) }
        result.fileName?.let { put("fileName", it) }
        if (result.byteLength > 0) put("byteLength", result.byteLength.toDouble())
        result.message?.let { put("message", it) }
        result.diagnostic?.let { put("diagnostic", it) }
        result.reason?.let { put("reason", it) }
      }
    }

    AsyncFunction("startSilentReportExportAsync") Coroutine { days: Int ->
      require(days in 7..90) {
        "Glooko PDF report range must be between 7 and 90 days."
      }
      val context = requireNotNull(appContext.reactContext)
      val result = GlookoSilentExporter(context).exportReport(days)
      buildMap<String, Any> {
        put("status", result.status)
        result.uri?.let { put("uri", it) }
        result.fileName?.let { put("fileName", it) }
        if (result.byteLength > 0) put("byteLength", result.byteLength.toDouble())
        result.message?.let { put("message", it) }
        result.diagnostic?.let { put("diagnostic", it) }
        result.reason?.let { put("reason", it) }
      }
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
      val result =
        GlookoSilentExporter(context).exportRange(
          start.toString(),
          end.toString(),
        )
      buildMap<String, Any> {
        put("status", result.status)
        result.uri?.let { put("uri", it) }
        result.fileName?.let { put("fileName", it) }
        if (result.byteLength > 0) put("byteLength", result.byteLength.toDouble())
        result.message?.let { put("message", it) }
        result.diagnostic?.let { put("diagnostic", it) }
        result.reason?.let { put("reason", it) }
      }
    }

    AsyncFunction("getLastTraceAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      context
        .getSharedPreferences(GLOOKO_TRACE_PREFERENCES, Context.MODE_PRIVATE)
        .getString(GLOOKO_LAST_TRACE_KEY, null)
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
        Log.i(
          "T1ArcGlooko",
          "Indexed ${intervals.size} pump-state intervals from ${report.pageTexts.size} report pages",
        )
        buildMap<String, Any> {
          put("text", report.text)
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

    AsyncFunction("openCredentialSetupAsync") Coroutine { ->
      val result = credentialLauncher.launch(CredentialRequest())
      buildMap<String, Any> {
        put("status", result.status)
        result.maskedEmail?.let { put("maskedEmail", it) }
      }
    }

    AsyncFunction("getCredentialStatusAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      val vault = GlookoCredentialVault(context)
      buildMap<String, Any> {
        put("configured", vault.isConfigured())
        vault.maskedEmail()?.let { put("maskedEmail", it) }
      }
    }

    AsyncFunction("clearCredentialsAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      GlookoCredentialVault(context).clear()
      GlookoSessionVault(context).clear()
      CookieManager.getInstance().removeAllCookies(null)
      CookieManager.getInstance().flush()
      WebStorage.getInstance().deleteAllData()
      true
    }

    AsyncFunction("clearSessionAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      GlookoCredentialVault(context).clear()
      val vault = GlookoSessionVault(context)
      vault.clear()
      CookieManager.getInstance().removeAllCookies(null)
      CookieManager.getInstance().flush()
      WebStorage.getInstance().deleteAllData()
      context.cacheDir
        .resolve("glooko-downloads")
        .listFiles()
        ?.forEach { file -> file.delete() }
      true
    }
  }
}
