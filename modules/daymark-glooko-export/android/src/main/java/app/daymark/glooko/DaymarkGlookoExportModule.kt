package app.daymark.glooko

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.webkit.CookieManager
import android.webkit.WebStorage
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.Serializable

internal const val GLOOKO_TRACE_PREFERENCES = "daymark_glooko_export"
internal const val GLOOKO_LAST_TRACE_KEY = "last_privacy_safe_trace"

private data class ExportRequest(val days: Int) : Serializable

private data class ExportResult(
  val status: String,
  val uri: String? = null,
  val fileName: String? = null,
  val byteLength: Long = 0,
  val message: String? = null,
  val diagnostic: String? = null,
)

private class GlookoExportContract :
  AppContextActivityResultContract<ExportRequest, ExportResult> {
  override fun createIntent(context: Context, input: ExportRequest): Intent =
    Intent(context, GlookoExportActivity::class.java).apply {
      putExtra(GlookoExportActivity.EXTRA_DAYS, input.days)
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

class DaymarkGlookoExportModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DaymarkGlookoExport")

    lateinit var exportLauncher:
      AppContextActivityResultLauncher<ExportRequest, ExportResult>

    RegisterActivityContracts {
      exportLauncher = registerForActivityResult(GlookoExportContract())
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

    AsyncFunction("getLastTraceAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      context
        .getSharedPreferences(GLOOKO_TRACE_PREFERENCES, Context.MODE_PRIVATE)
        .getString(GLOOKO_LAST_TRACE_KEY, null)
    }

    AsyncFunction("clearSessionAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
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
