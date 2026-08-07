package app.daymark.glooko

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.net.http.SslError
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.JavascriptInterface
import android.webkit.SslErrorHandler
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Base64
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine
import kotlin.math.max

internal data class SilentGlookoExportResult(
  val status: String,
  val uri: String? = null,
  val fileName: String? = null,
  val byteLength: Long = 0,
  val message: String? = null,
  val reason: String? = null,
  val diagnostic: String? = null,
)

private enum class GlookoDownloadKind {
  CSV_ARCHIVE,
  PDF_REPORT,
}

private val PDF_GENERATED_DOWNLOAD_LABELS =
  setOf("download", "download pdf", "download report", "view pdf", "view report")
private val CSV_GENERATED_DOWNLOAD_LABELS =
  setOf("download csv", "download export", "download data", "download file", "download your data")

internal fun isSilentGlookoGeneratedDownloadControl(
  label: String,
  originalSubmitLabel: String?,
  alreadyDownloaded: Boolean,
  hasFileLink: Boolean,
  insideExportDialog: Boolean,
  expectedPdf: Boolean,
): Boolean {
  if (alreadyDownloaded) return false
  val normalisedLabel = label.replace(Regex("\\s+"), " ").trim().lowercase(Locale.ROOT)
  val normalisedSubmitLabel =
    originalSubmitLabel
      ?.replace(Regex("\\s+"), " ")
      ?.trim()
      ?.lowercase(Locale.ROOT)
      ?.takeIf(String::isNotEmpty)
  if (normalisedSubmitLabel == normalisedLabel) return false
  val transitionedSubmit =
    normalisedSubmitLabel != null && normalisedSubmitLabel != normalisedLabel
  return if (expectedPdf) {
    normalisedLabel in PDF_GENERATED_DOWNLOAD_LABELS
  } else {
    hasFileLink ||
      normalisedLabel in CSV_GENERATED_DOWNLOAD_LABELS ||
      (normalisedLabel == "download" && (!insideExportDialog || transitionedSubmit))
  }
}

internal fun hasSilentGlookoPostSubmitTimedOut(
  nowElapsedRealtime: Long,
  submittedAtElapsedRealtime: Long?,
  downloadRequestedAtElapsedRealtime: Long?,
  downloadInProgress: Boolean,
  generationTimeoutMs: Long,
  downloadCaptureTimeoutMs: Long,
): Boolean {
  if (submittedAtElapsedRealtime == null || downloadInProgress) return false
  val waitStartedAt =
    downloadRequestedAtElapsedRealtime ?: submittedAtElapsedRealtime
  val timeout =
    if (downloadRequestedAtElapsedRealtime == null) {
      generationTimeoutMs
    } else {
      downloadCaptureTimeoutMs
    }
  return nowElapsedRealtime >= waitStartedAt &&
    nowElapsedRealtime - waitStartedAt >= timeout
}

internal fun silentGlookoWatchdogDeadline(
  exportStartedAtElapsedRealtime: Long,
  submittedAtElapsedRealtime: Long?,
  downloadRequestedAtElapsedRealtime: Long?,
  downloadStartedAtElapsedRealtime: Long?,
  preSubmitTimeoutMs: Long,
  generationTimeoutMs: Long,
  downloadCaptureTimeoutMs: Long,
  downloadTransferTimeoutMs: Long,
): Long =
  when {
    downloadStartedAtElapsedRealtime != null ->
      downloadStartedAtElapsedRealtime + downloadTransferTimeoutMs
    downloadRequestedAtElapsedRealtime != null ->
      downloadRequestedAtElapsedRealtime + downloadCaptureTimeoutMs
    submittedAtElapsedRealtime != null ->
      submittedAtElapsedRealtime + generationTimeoutMs
    else -> exportStartedAtElapsedRealtime + preSubmitTimeoutMs
  }

/**
 * Uses the same private WebView cookie jar as the visible connector. The
 * WebView is attached to a private virtual display, never the physical screen,
 * so Chromium can complete generated downloads without interrupting whatever
 * the user is doing. If Glooko asks for authentication, the connector can use
 * the user's opt-in Android-keystore credential without returning the secret
 * to JavaScript or diagnostics.
 */
internal class GlookoSilentExporter(context: Context) {
  companion object {
    private const val DASHBOARD_URL = "https://my.glooko.com/"
    private const val BRIDGE_NAME = "DaymarkSilentGlookoBridge"
    private const val LOG_TAG = "T1ArcGlooko"
    private const val MAX_DOWNLOAD_BYTES = 50L * 1024L * 1024L
    private const val MAX_AUTOMATION_ATTEMPTS = 24
    private const val POST_SUBMIT_GENERATION_TIMEOUT_MS = 2L * 60L * 1000L
    private const val DOWNLOAD_CAPTURE_TIMEOUT_MS = 30L * 1000L
    private const val DOWNLOAD_TRANSFER_TIMEOUT_MS = 150L * 1000L
    private const val POST_SUBMIT_POLL_MS = 3_000L
    private const val PRE_SUBMIT_WATCHDOG_TIMEOUT_MS = 5L * 60L * 1000L
    private val running = AtomicBoolean(false)
  }

  private val appContext = context.applicationContext
  private val mainHandler = Handler(Looper.getMainLooper())
  private val downloadExecutor = Executors.newSingleThreadExecutor()
  private val completed = AtomicBoolean(false)
  private val downloadInProgress = AtomicBoolean(false)
  private val downloadStartedAtElapsedRealtime = AtomicLong(0L)
  private val traceStartedAt = SystemClock.elapsedRealtime()
  private val traceEvents = mutableListOf<String>()
  private val popupWebViews = mutableListOf<WebView>()
  private lateinit var webView: WebView
  private lateinit var offscreenHost: GlookoOffscreenWebViewHost
  private var automationAttempts = 0
  private var automationGeneration = 0
  private var watchdogGeneration = 0
  private var exportSubmittedAtElapsedRealtime: Long? = null
  private var downloadRequestedAtElapsedRealtime: Long? = null
  private var postSubmitTraceBucket = 0
  private var requestedDays = 1
  private var requestedStartDate: String? = null
  private var requestedEndDate: String? = null
  private var requestedDownloadKind = GlookoDownloadKind.CSV_ARCHIVE
  private var loginCheckGeneration = 0
  private var credentialLoginAttempted = false
  private var continuation: ((SilentGlookoExportResult) -> Unit)? = null

  suspend fun export(days: Int): SilentGlookoExportResult =
    exportInternal(
      days.coerceIn(1, 90),
      null,
      null,
      GlookoDownloadKind.CSV_ARCHIVE,
    )

  suspend fun exportReport(days: Int): SilentGlookoExportResult =
    exportInternal(
      days.coerceIn(7, 90),
      null,
      null,
      GlookoDownloadKind.PDF_REPORT,
    )

  suspend fun exportRange(
    startDate: String,
    endDate: String,
  ): SilentGlookoExportResult {
    val start = java.time.LocalDate.parse(startDate)
    val end = java.time.LocalDate.parse(endDate)
    val days = java.time.temporal.ChronoUnit.DAYS.between(start, end) + 1
    require(days in 1..90) {
      "Glooko custom exports must contain between 1 and 90 calendar days."
    }
    return exportInternal(
      days.toInt(),
      start.toString(),
      end.toString(),
      GlookoDownloadKind.CSV_ARCHIVE,
    )
  }

  private suspend fun exportInternal(
    days: Int,
    startDate: String?,
    endDate: String?,
    downloadKind: GlookoDownloadKind,
  ): SilentGlookoExportResult =
    suspendCoroutine { suspended ->
      if (!running.compareAndSet(false, true)) {
        suspended.resume(
          SilentGlookoExportResult(
            status = "cancelled",
            message = "Another Glooko refresh is already running.",
            reason = "busy",
            diagnostic = "Automatic connector skipped because another attempt is active.",
          ),
        )
        return@suspendCoroutine
      }
      requestedDays = days
      requestedStartDate = startDate
      requestedEndDate = endDate
      requestedDownloadKind = downloadKind
      continuation = suspended::resume
      mainHandler.post {
        try {
          start()
        } catch (error: Exception) {
          finish(
            SilentGlookoExportResult(
              status = "cancelled",
              message = error.message ?: "Automatic Glooko refresh could not start.",
            ),
          )
        }
      }
    }

  @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
  private fun start() {
    trace(
      if (requestedDownloadKind == GlookoDownloadKind.PDF_REPORT) {
        "Automatic PDF report connector started"
      } else {
        "Automatic connector started"
      },
    )
    cleanOldDownloads()
    val cookieManager = CookieManager.getInstance()
    cookieManager.setAcceptCookie(true)
    val sessionVault = GlookoSessionVault(appContext)
    val currentCookieNames =
      sessionVault.currentSessionCookieNames(cookieManager)
    if (currentCookieNames.isNotEmpty()) {
      trace(
        "Current Glooko WebView session reused securely " +
          "(${currentCookieNames.joinToString(", ")})",
      )
    } else {
      val restoredCookieNames = sessionVault.restore(cookieManager)
      if (restoredCookieNames.isNotEmpty()) {
        trace(
          "Saved Glooko session restored securely " +
            "(${restoredCookieNames.joinToString(", ")})",
        )
      } else {
        trace("No reusable Glooko session was available")
      }
    }
    val metrics = appContext.resources.displayMetrics
    val width = max(metrics.widthPixels, 720)
    val height = max(metrics.heightPixels, 1_280)
    offscreenHost = GlookoOffscreenWebViewHost(appContext, width, height)
    webView =
      WebView(offscreenHost.webViewContext).apply {
        visibility = View.VISIBLE
        settings.apply {
          javaScriptEnabled = true
          domStorageEnabled = true
          databaseEnabled = true
          mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
          allowFileAccess = false
          allowContentAccess = false
          cacheMode = WebSettings.LOAD_DEFAULT
          javaScriptCanOpenWindowsAutomatically = true
          setSupportMultipleWindows(true)
          offscreenPreRaster = true
        }
        cookieManager.setAcceptThirdPartyCookies(this, false)
        addJavascriptInterface(ExportBridge(this), BRIDGE_NAME)
        setDownloadListener(
          DownloadListener { url, userAgent, disposition, mimeType, length ->
            handleDownload(this, url, userAgent, disposition, mimeType, length)
          },
        )
        webChromeClient = createWebChromeClient()
        webViewClient =
          object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
              view: WebView?,
              request: WebResourceRequest?,
            ): Boolean {
              val uri = request?.url ?: return true
              return !isAllowedGlookoUri(uri)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
              super.onPageFinished(view, url)
              if (completed.get() || url == null) return
              val uri = Uri.parse(url)
              if (!isAllowedGlookoUri(uri)) {
                fail("Glooko left its secure site.", "network")
                return
              }
              CookieManager.getInstance().flush()
              if (looksLikeLogin(url)) {
                attemptCredentialLogin(view)
                return
              }
              loginCheckGeneration += 1
              trace("Saved Glooko session opened")
              view?.evaluateJavascript(
                downloadCaptureScript(
                  requestedDownloadKind == GlookoDownloadKind.PDF_REPORT,
                ),
                null,
              )
              if (exportSubmittedAtElapsedRealtime == null) {
                automationAttempts = 0
              }
              scheduleAutomationAttempt(800L)
            }

            override fun onReceivedSslError(
              view: WebView?,
              handler: SslErrorHandler?,
              error: SslError?,
            ) {
              handler?.cancel()
              fail("Glooko's secure connection could not be verified.", "network")
            }
          }
      }
    // Enabled only for the paired-device diagnostic pass below. The final
    // release turns this off again after the export request is verified.
    WebView.setWebContentsDebuggingEnabled(false)
    offscreenHost.attach(webView)
    // A deterministic virtual viewport lets responsive export controls render
    // normally in the private window.
    webView.measure(
      View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
    )
    webView.layout(0, 0, width, height)
    scheduleOverallWatchdog()
    // Start at the authenticated application rather than the sign-in route.
    // A missing/expired session is redirected to sign-in, while a valid
    // session goes directly to the dashboard.
    webView.loadUrl(DASHBOARD_URL)
  }

  @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
  private fun createWebChromeClient(): WebChromeClient =
    object : WebChromeClient() {
      override fun onCreateWindow(
        view: WebView?,
        isDialog: Boolean,
        isUserGesture: Boolean,
        resultMsg: Message?,
      ): Boolean {
        if (completed.get()) return false
        val transport = resultMsg?.obj as? WebView.WebViewTransport ?: return false
        trace("Glooko requested a secondary report window")
        val parentChromeClient = this
        val popup =
          WebView(offscreenHost.webViewContext).apply {
            visibility = View.VISIBLE
            settings.apply {
              javaScriptEnabled = true
              domStorageEnabled = true
              databaseEnabled = true
              mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
              allowFileAccess = false
              allowContentAccess = false
              cacheMode = WebSettings.LOAD_DEFAULT
              javaScriptCanOpenWindowsAutomatically = true
              setSupportMultipleWindows(true)
              offscreenPreRaster = true
            }
            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
            addJavascriptInterface(ExportBridge(this), BRIDGE_NAME)
            setDownloadListener { url, userAgent, disposition, mimeType, length ->
              handleDownload(
                this,
                url,
                userAgent,
                disposition,
                mimeType,
                length,
              )
            }
            webChromeClient = parentChromeClient
            webViewClient =
              object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                  popupView: WebView?,
                  request: WebResourceRequest?,
                ): Boolean {
                  val scheme = request?.url?.scheme.orEmpty()
                  return !scheme.equals("https", ignoreCase = true) &&
                    !scheme.equals("blob", ignoreCase = true)
                }

                override fun onPageFinished(popupView: WebView?, url: String?) {
                  super.onPageFinished(popupView, url)
                  if (completed.get() || popupView == null) return
                  trace("Secondary report window opened")
                  popupView.evaluateJavascript(
                    downloadCaptureScript(
                      requestedDownloadKind == GlookoDownloadKind.PDF_REPORT,
                    ),
                    null,
                  )
                }

                override fun onReceivedSslError(
                  popupView: WebView?,
                  handler: SslErrorHandler?,
                  error: SslError?,
                ) {
                  handler?.cancel()
                  fail("Glooko's report connection could not be verified.", "network")
                }
              }
          }
        offscreenHost.attach(popup)
        val metrics = appContext.resources.displayMetrics
        val width = max(metrics.widthPixels, 720)
        val height = max(metrics.heightPixels, 1_280)
        popup.measure(
          View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
          View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
        )
        popup.layout(0, 0, width, height)
        popupWebViews += popup
        transport.webView = popup
        resultMsg.sendToTarget()
        return true
      }

      override fun onCloseWindow(window: WebView?) {
        if (window != null && window !== webView) destroyPopup(window)
      }
    }

  private fun destroyPopup(popup: WebView) {
    popupWebViews.remove(popup)
    if (::offscreenHost.isInitialized) offscreenHost.detach(popup)
    popup.stopLoading()
    popup.removeJavascriptInterface(BRIDGE_NAME)
    popup.loadUrl("about:blank")
    popup.clearHistory()
    popup.removeAllViews()
    popup.destroy()
  }

  private fun attemptCredentialLogin(view: WebView?) {
    val credentials = GlookoCredentialVault(appContext).read()
    if (credentials == null) {
      scheduleLoginCheck(
        message =
          "Set up encrypted automatic sign-in in Sources, then try again.",
      )
      return
    }
    if (credentialLoginAttempted) {
      scheduleLoginCheck(
        message =
          "Glooko did not accept the encrypted sign-in. Update it in Sources.",
        reason = "credentials-rejected",
      )
      return
    }
    credentialLoginAttempted = true
    loginCheckGeneration += 1
    trace("Encrypted Glooko sign-in submitted")
    view?.evaluateJavascript(glookoLoginScript(credentials)) { raw ->
      when (raw?.trim('"')) {
        "submitted" -> Unit
        "missing-form" -> {
          trace("Glooko sign-in form was not available")
          finish(
            SilentGlookoExportResult(
              status = "session-required",
              message =
                "Glooko's sign-in page changed. Open Sync now and sign in manually.",
              reason = "session-required",
              diagnostic = diagnostic(),
            ),
          )
        }
        else -> {
          trace("Encrypted Glooko sign-in could not be submitted")
          finish(
            SilentGlookoExportResult(
              status = "session-required",
              message =
                "Automatic sign-in could not be completed. Update it in Sources.",
              reason = "credentials-rejected",
              diagnostic = diagnostic(),
            ),
          )
        }
      }
    }
  }

  private fun scheduleLoginCheck(
    message: String,
    reason: String = "session-required",
  ) {
    val generation = ++loginCheckGeneration
    trace("Glooko sign-in redirect detected")
    mainHandler.postDelayed(
      {
        if (
          completed.get() ||
          generation != loginCheckGeneration ||
          !::webView.isInitialized ||
          !looksLikeLogin(webView.url.orEmpty())
        ) {
          return@postDelayed
        }
        trace(
          if (reason == "credentials-rejected") {
            "Encrypted Glooko sign-in was not accepted"
          } else {
            "Encrypted Glooko sign-in is required"
          },
        )
        GlookoSessionVault(appContext).markRejected()
        finish(
          SilentGlookoExportResult(
            status = "session-required",
            message = message,
            reason = reason,
            diagnostic = diagnostic(),
          ),
        )
      },
      5_000L,
    )
  }

  private fun scheduleAutomationAttempt(delayMs: Long) {
    val generation = ++automationGeneration
    mainHandler.postDelayed(
      {
        if (
          completed.get() ||
          !::webView.isInitialized ||
          generation != automationGeneration
        ) {
          return@postDelayed
        }
        if (downloadInProgress.get()) {
          scheduleAutomationAttempt(POST_SUBMIT_POLL_MS)
          return@postDelayed
        }
        val now = SystemClock.elapsedRealtime()
        val waitingForDownload = exportSubmittedAtElapsedRealtime != null
        if (
          hasSilentGlookoPostSubmitTimedOut(
            now,
            exportSubmittedAtElapsedRealtime,
            downloadRequestedAtElapsedRealtime,
            downloadInProgress.get(),
            POST_SUBMIT_GENERATION_TIMEOUT_MS,
            DOWNLOAD_CAPTURE_TIMEOUT_MS,
          )
        ) {
          fail(postSubmitTimeoutMessage(), "timeout")
          return@postDelayed
        }
        if (!waitingForDownload && automationAttempts >= MAX_AUTOMATION_ATTEMPTS) {
          fail(
            "Glooko's automatic export control was not available. Manual sync still works.",
            "unknown",
          )
          return@postDelayed
        }
        if (!waitingForDownload) automationAttempts += 1
        webView.evaluateJavascript(
          if (requestedDownloadKind == GlookoDownloadKind.PDF_REPORT) {
            reportAutomationScript(requestedDays, waitingForDownload)
          } else {
            automationScript(
              requestedDays,
              requestedStartDate,
              requestedEndDate,
              waitingForDownload,
            )
          },
        ) resultCallback@ { raw ->
          if (completed.get() || generation != automationGeneration) {
            return@resultCallback
          }
          val result = raw?.trim('"').orEmpty()
          when {
            result == "submitted" -> {
              markExportSubmitted()
              scheduleAutomationAttempt(POST_SUBMIT_POLL_MS)
            }
            result == "waiting-download" -> {
              markExportSubmitted()
              tracePostSubmitWait()
              scheduleAutomationAttempt(POST_SUBMIT_POLL_MS)
            }
            result == "download" -> {
              markExportSubmitted()
              if (downloadRequestedAtElapsedRealtime == null) {
                downloadRequestedAtElapsedRealtime = SystemClock.elapsedRealtime()
                trace("Generated export download requested")
                scheduleOverallWatchdog()
              }
              scheduleAutomationAttempt(2_500L)
            }
            result == "opened" -> {
              trace("Automatic export options opened")
              scheduleAutomationAttempt(1_200L)
            }
            result == "login" ->
              attemptCredentialLogin(webView)
            else -> {
              if (
                result.startsWith("state:") &&
                automationAttempts in setOf(1, 6, 12, 18, 24)
              ) {
                trace("Report page ${result.removePrefix("state:").take(100)}")
              }
              if (waitingForDownload) tracePostSubmitWait()
              scheduleAutomationAttempt(
                if (waitingForDownload) POST_SUBMIT_POLL_MS else 1_500L,
              )
            }
          }
        }
      },
      delayMs,
    )
  }

  private fun markExportSubmitted(): Boolean {
    if (completed.get() || exportSubmittedAtElapsedRealtime != null) return false
    exportSubmittedAtElapsedRealtime = SystemClock.elapsedRealtime()
    trace("Automatic export submitted; waiting for generated download")
    scheduleOverallWatchdog()
    return true
  }

  private fun tracePostSubmitWait() {
    val submittedAt = exportSubmittedAtElapsedRealtime ?: return
    val bucket =
      ((SystemClock.elapsedRealtime() - submittedAt) / 30_000L).toInt()
    if (bucket <= postSubmitTraceBucket) return
    postSubmitTraceBucket = bucket
    trace("Still waiting for Glooko's generated download")
  }

  private fun postSubmitTimeoutMessage(): String =
    if (downloadRequestedAtElapsedRealtime != null) {
      "Glooko offered the generated export, but its download did not start within 30 seconds. T1 Arc will retry later."
    } else {
      "Glooko accepted the export request, but the generated download did not arrive within two minutes. T1 Arc will retry later."
    }

  private fun overallTimeoutMessage(): String =
    when {
      downloadInProgress.get() ->
        "The generated Glooko export started downloading, but it did not finish in time. T1 Arc will retry later."
      exportSubmittedAtElapsedRealtime != null -> postSubmitTimeoutMessage()
      else -> "Automatic Glooko refresh timed out and will retry later."
    }

  private fun currentWatchdogDeadline(): Long =
    silentGlookoWatchdogDeadline(
      exportStartedAtElapsedRealtime = traceStartedAt,
      submittedAtElapsedRealtime = exportSubmittedAtElapsedRealtime,
      downloadRequestedAtElapsedRealtime = downloadRequestedAtElapsedRealtime,
      downloadStartedAtElapsedRealtime =
        downloadStartedAtElapsedRealtime.get().takeIf { it > 0L },
      preSubmitTimeoutMs = PRE_SUBMIT_WATCHDOG_TIMEOUT_MS,
      generationTimeoutMs = POST_SUBMIT_GENERATION_TIMEOUT_MS,
      downloadCaptureTimeoutMs = DOWNLOAD_CAPTURE_TIMEOUT_MS,
      downloadTransferTimeoutMs = DOWNLOAD_TRANSFER_TIMEOUT_MS,
    )

  private fun scheduleOverallWatchdog() {
    if (completed.get()) return
    val generation = ++watchdogGeneration
    val delayMs =
      max(1L, currentWatchdogDeadline() - SystemClock.elapsedRealtime())
    mainHandler.postDelayed(
      {
        if (completed.get() || generation != watchdogGeneration) {
          return@postDelayed
        }
        val remainingMs =
          currentWatchdogDeadline() - SystemClock.elapsedRealtime()
        if (remainingMs > 0L) {
          scheduleOverallWatchdog()
          return@postDelayed
        }
        fail(overallTimeoutMessage(), "timeout")
      },
      delayMs,
    )
  }

  private fun markDownloadStarted() {
    if (
      downloadStartedAtElapsedRealtime.compareAndSet(
        0L,
        SystemClock.elapsedRealtime(),
      )
    ) {
      mainHandler.post {
        if (!completed.get()) scheduleOverallWatchdog()
      }
    }
  }

  private fun resumeDownloadCaptureAfterIntermediateResponse() {
    downloadInProgress.set(false)
    downloadStartedAtElapsedRealtime.set(0L)
    mainHandler.post {
      if (completed.get()) return@post
      downloadRequestedAtElapsedRealtime = SystemClock.elapsedRealtime()
      scheduleOverallWatchdog()
      scheduleAutomationAttempt(1_000L)
    }
  }

  private fun handleDownload(
    sourceWebView: WebView,
    url: String?,
    userAgent: String?,
    disposition: String?,
    mimeType: String?,
    contentLength: Long,
  ) {
    if (completed.get() || url.isNullOrBlank()) return
    if (!downloadInProgress.compareAndSet(false, true)) return
    markDownloadStarted()
    trace("Browser download detected")
    if (contentLength > MAX_DOWNLOAD_BYTES) {
      downloadInProgress.set(false)
      fail("The Glooko export exceeded the local safety limit.", "unknown")
      return
    }
    val isBlob = url.startsWith("blob:", ignoreCase = true)
    val isHttps = url.startsWith("https://", ignoreCase = true)
    if (!isBlob && !isHttps) {
      downloadInProgress.set(false)
      fail("Glooko returned an unsupported download address.", "network")
      return
    }
    val escapedUrl = javascriptString(url)
    val fallback =
      javascriptString(
        URLUtil.guessFileName(
          url,
          disposition,
          mimeType ?: if (
            requestedDownloadKind == GlookoDownloadKind.PDF_REPORT
          ) {
            "application/pdf"
          } else {
            "application/zip"
          },
        ),
      )
    val failure =
      if (isHttps) {
        "window.$BRIDGE_NAME.onDownloadFetchFailure('$escapedUrl')"
      } else {
        "window.$BRIDGE_NAME.onFailure('blob')"
      }
    sourceWebView.evaluateJavascript(
      """
        (function () {
          fetch('$escapedUrl', {credentials: 'include'}).then(r => {
            if (!r.ok) throw new Error('http');
            return r.blob();
          }).then(blob => {
            const reader = new FileReader();
            reader.onload = () => {
              const value = String(reader.result || '');
              const comma = value.indexOf(',');
              if (comma > 0) window.$BRIDGE_NAME.onExportBytes(
                value.slice(comma + 1), '$fallback'
              );
            };
            reader.onerror = () => $failure;
            reader.readAsDataURL(blob);
          }).catch(() => $failure);
        })();
      """.trimIndent(),
      null,
    )
  }

  private fun downloadHttpExport(
    initialUrl: String,
    userAgent: String?,
    contentDisposition: String?,
    refererUrl: String? = null,
  ) {
    val effectiveUserAgent =
      userAgent ?: if (::webView.isInitialized) webView.settings.userAgentString else ""
    downloadExecutor.execute {
      var connection: HttpURLConnection? = null
      var temporaryFile: File? = null
      try {
        var currentUrl = initialUrl
        var disposition = contentDisposition
        var redirects = 0
        while (true) {
          val parsed = Uri.parse(currentUrl)
          if (!parsed.scheme.equals("https", ignoreCase = true)) {
            throw IllegalStateException("Glooko returned a non-secure download address.")
          }
          val isGlookoHost = isAllowedGlookoUri(parsed)
          connection =
            (URL(currentUrl).openConnection() as HttpURLConnection).apply {
              instanceFollowRedirects = false
              connectTimeout = 30_000
              readTimeout = 90_000
              requestMethod = "GET"
              setRequestProperty(
                "Accept",
                if (requestedDownloadKind == GlookoDownloadKind.PDF_REPORT) {
                  "application/pdf,*/*"
                } else {
                  "application/zip,text/csv,*/*"
                },
              )
              setRequestProperty("User-Agent", effectiveUserAgent)
              CookieManager.getInstance().getCookie(currentUrl)?.let {
                setRequestProperty("Cookie", it)
              }
              if (refererUrl?.startsWith("https://", ignoreCase = true) == true) {
                setRequestProperty("Referer", refererUrl)
              }
            }
          val status = connection.responseCode
          trace("Download server responded with HTTP $status")
          if (isGlookoHost) {
            connection.headerFields
              .filterKeys { key -> key?.equals("Set-Cookie", ignoreCase = true) == true }
              .values
              .flatten()
              .forEach { cookie ->
                CookieManager.getInstance().setCookie(currentUrl, cookie)
              }
          }
          if (status in 300..399) {
            val location =
              connection.getHeaderField("Location")
                ?: throw IllegalStateException("Glooko returned an incomplete redirect.")
            if (redirects >= 5) {
              throw IllegalStateException("Glooko redirected the export too many times.")
            }
            currentUrl = URL(URL(currentUrl), location).toString()
            redirects += 1
            connection.disconnect()
            continue
          }
          if (status !in 200..299) {
            throw IllegalStateException("Glooko returned HTTP $status for the export.")
          }
          disposition = connection.getHeaderField("Content-Disposition") ?: disposition
          if (connection.contentLengthLong > MAX_DOWNLOAD_BYTES) {
            throw IllegalStateException("The Glooko export exceeded the local safety limit.")
          }
          val fileName =
            safeFileName(
              URLUtil.guessFileName(currentUrl, disposition, connection.contentType),
            )
          temporaryFile = newDownloadFile(fileName)
          var written = 0L
          connection.inputStream.use { input ->
            FileOutputStream(temporaryFile).use { output ->
              val buffer = ByteArray(16 * 1024)
              while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                written += read
                if (written > MAX_DOWNLOAD_BYTES) {
                  throw IllegalStateException(
                    "The Glooko export exceeded the local safety limit.",
                  )
                }
                output.write(buffer, 0, read)
              }
            }
          }
          val validDownload =
            if (requestedDownloadKind == GlookoDownloadKind.PDF_REPORT) {
              isPdfDocument(temporaryFile)
            } else {
              isZipArchive(temporaryFile) || fileName.endsWith(".csv", true)
            }
          if (!validDownload) {
            temporaryFile.delete()
            temporaryFile = null
            trace("Intermediate export response ignored")
            resumeDownloadCaptureAfterIntermediateResponse()
            return@execute
          }
          val displayName =
            if (requestedDownloadKind == GlookoDownloadKind.PDF_REPORT) {
              "${fileName.substringBeforeLast('.', fileName)}.pdf"
            } else if (isZipArchive(temporaryFile)) {
              "${fileName.substringBeforeLast('.', fileName)}.zip"
            } else {
              "${fileName.substringBeforeLast('.', fileName)}.csv"
            }
          completeDownload(temporaryFile, displayName, written)
          return@execute
        }
      } catch (error: Exception) {
        temporaryFile?.delete()
        downloadInProgress.set(false)
        trace("Authenticated report transfer failed")
        fail(error.message ?: "Automatic Glooko download failed.", "network")
      } finally {
        connection?.disconnect()
      }
    }
  }

  private inner class ExportBridge(private val sourceWebView: WebView) {
    @JavascriptInterface
    fun onExportSubmitted() {
      mainHandler.post {
        if (markExportSubmitted()) {
          scheduleAutomationAttempt(POST_SUBMIT_POLL_MS)
        }
      }
    }

    @JavascriptInterface
    fun onTrace(code: String?) {
      val event =
        when (code) {
          "export-clicked" -> "Export action detected"
          "fetch-file" -> "Export file detected in fetch"
          "xhr-file" -> "Export file detected in request"
          "blob-file" -> "Generated export file detected"
          else -> null
        }
      if (event != null) trace(event)
    }

    @JavascriptInterface
    fun onFailure(code: String?) {
      trace("Browser export capture reported ${code?.take(30) ?: "an error"}")
      resumeDownloadCaptureAfterIntermediateResponse()
    }

    @JavascriptInterface
    fun onDownloadFetchFailure(url: String?) {
      if (url.isNullOrBlank() || completed.get()) return
      mainHandler.post {
        trace("Browser transfer handed off to the authenticated downloader")
        downloadHttpExport(
          url,
          sourceWebView.settings.userAgentString,
          null,
          sourceWebView.url,
        )
      }
    }

    @JavascriptInterface
    fun onDownloadUrl(url: String?) {
      if (url.isNullOrBlank() || completed.get()) return
      mainHandler.post {
        handleDownload(
          sourceWebView,
          url,
          sourceWebView.settings.userAgentString,
          null,
          if (requestedDownloadKind == GlookoDownloadKind.PDF_REPORT) {
            "application/pdf"
          } else {
            null
          },
          -1,
        )
      }
    }

    @JavascriptInterface
    fun onExportBytes(base64: String?, fileName: String?) {
      if (completed.get() || base64.isNullOrBlank()) return
      markDownloadStarted()
      downloadInProgress.set(true)
      downloadExecutor.execute {
        var file: File? = null
        try {
          if (base64.length > ((MAX_DOWNLOAD_BYTES * 4L) / 3L + 16_384L)) {
            throw IllegalStateException("The Glooko export exceeded the local safety limit.")
          }
          val bytes = Base64.getDecoder().decode(base64)
          if (bytes.isEmpty() || bytes.size > MAX_DOWNLOAD_BYTES) {
            throw IllegalStateException("Glooko returned an invalid export.")
          }
          val pdf = isPdfDocument(bytes)
          val zip = isZipArchive(bytes)
          if (
            requestedDownloadKind == GlookoDownloadKind.PDF_REPORT &&
            !pdf
          ) {
            throw IllegalStateException("Glooko returned an invalid PDF report.")
          }
          if (
            requestedDownloadKind == GlookoDownloadKind.CSV_ARCHIVE &&
            !zip &&
            !fileName.orEmpty().endsWith(".csv", true)
          ) {
            throw IllegalStateException("Glooko returned an invalid data export.")
          }
          val safe =
            safeFileName(
              fileName ?: if (requestedDownloadKind == GlookoDownloadKind.PDF_REPORT) {
                "glooko-daily-overview.pdf"
              } else {
                "glooko-export.zip"
              },
            )
          val displayName =
            "${safe.substringBeforeLast('.', safe)}.${
              if (pdf) "pdf" else if (zip) "zip" else "csv"
            }"
          file = newDownloadFile(displayName)
          FileOutputStream(file).use { it.write(bytes) }
          completeDownload(file, displayName, bytes.size.toLong())
        } catch (error: Exception) {
          file?.delete()
          fail(error.message ?: "The generated Glooko export could not be read.", "unknown")
        }
      }
    }
  }

  private fun completeDownload(file: File, displayName: String, byteLength: Long) {
    downloadInProgress.set(false)
    trace("Automatic export downloaded")
    finish(
      SilentGlookoExportResult(
        status = "downloaded",
        uri = Uri.fromFile(file).toString(),
        fileName = displayName,
        byteLength = byteLength,
        diagnostic = diagnostic(),
      ),
    )
  }

  private fun fail(message: String, reason: String) {
    trace("Automatic connector stopped: $reason")
    finish(
      SilentGlookoExportResult(
        status = "cancelled",
        message = message,
        reason = reason,
        diagnostic = diagnostic(),
      ),
    )
  }

  private fun finish(result: SilentGlookoExportResult) {
    if (!completed.compareAndSet(false, true)) return
    mainHandler.removeCallbacksAndMessages(null)
    CookieManager.getInstance().flush()
    val callback = continuation
    continuation = null
    mainHandler.post {
      popupWebViews.toList().forEach(::destroyPopup)
      if (::webView.isInitialized) {
        webView.stopLoading()
        webView.removeJavascriptInterface(BRIDGE_NAME)
        webView.loadUrl("about:blank")
        webView.clearHistory()
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.removeAllViews()
        webView.destroy()
      }
      if (::offscreenHost.isInitialized) offscreenHost.close()
      downloadExecutor.shutdownNow()
      running.set(false)
      callback?.invoke(result.copy(diagnostic = result.diagnostic ?: diagnostic()))
    }
  }

  private fun trace(message: String) {
    val elapsedSeconds = (SystemClock.elapsedRealtime() - traceStartedAt) / 1000
    synchronized(traceEvents) {
      val entry = "+${elapsedSeconds}s $message"
      if (traceEvents.lastOrNull() != entry) traceEvents += entry
      while (traceEvents.size > 24) traceEvents.removeAt(0)
      Log.i(LOG_TAG, entry)
      appContext
        .getSharedPreferences(GLOOKO_TRACE_PREFERENCES, Context.MODE_PRIVATE)
        .edit()
        .putString(GLOOKO_LAST_TRACE_KEY, traceEvents.joinToString("\n"))
        .apply()
    }
  }

  private fun diagnostic() =
    synchronized(traceEvents) {
      traceEvents.joinToString("\n")
    }

  private fun newDownloadFile(fileName: String): File {
    val directory = File(appContext.cacheDir, "glooko-downloads")
    if (!directory.exists() && !directory.mkdirs()) {
      throw IllegalStateException("A private download folder could not be created.")
    }
    return File(directory, "${UUID.randomUUID()}-$fileName")
  }

  private fun cleanOldDownloads() {
    val cutoff = System.currentTimeMillis() - 24L * 60L * 60L * 1000L
    File(appContext.cacheDir, "glooko-downloads").listFiles()?.forEach { file ->
      if (file.lastModified() < cutoff) file.delete()
    }
  }

  private fun safeFileName(value: String): String {
    val leaf = value.substringAfterLast('/').substringAfterLast('\\')
    val cleaned = leaf.replace(Regex("[^A-Za-z0-9._ -]"), "_").trim().take(120)
    return cleaned.ifBlank { "glooko-export.zip" }
  }

  private fun isZipArchive(file: File): Boolean =
    file.inputStream().use { input ->
      val signature = ByteArray(4)
      input.read(signature) == signature.size && isZipArchive(signature)
    }

  private fun isZipArchive(bytes: ByteArray): Boolean =
    bytes.size >= 4 &&
      bytes[0] == 0x50.toByte() &&
      bytes[1] == 0x4b.toByte() &&
      (
        (bytes[2] == 0x03.toByte() && bytes[3] == 0x04.toByte()) ||
          (bytes[2] == 0x05.toByte() && bytes[3] == 0x06.toByte()) ||
          (bytes[2] == 0x07.toByte() && bytes[3] == 0x08.toByte())
      )

  private fun isPdfDocument(file: File): Boolean =
    file.inputStream().use { input ->
      val signature = ByteArray(4)
      input.read(signature) == signature.size && isPdfDocument(signature)
    }

  private fun isPdfDocument(bytes: ByteArray): Boolean =
    bytes.size >= 4 &&
      bytes[0] == '%'.code.toByte() &&
      bytes[1] == 'P'.code.toByte() &&
      bytes[2] == 'D'.code.toByte() &&
      bytes[3] == 'F'.code.toByte()

  private fun isAllowedGlookoUri(uri: Uri): Boolean {
    if (!uri.scheme.equals("https", ignoreCase = true)) return false
    val host = uri.host?.lowercase(Locale.ROOT) ?: return false
    return host == "glooko.com" || host.endsWith(".glooko.com")
  }

  private fun looksLikeLogin(url: String): Boolean {
    val lower = url.lowercase(Locale.ROOT)
    return lower.contains("/users/sign_in") || lower.contains("/login")
  }

  private fun javascriptString(value: String) =
    value.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "")

  private fun javascriptStringArray(values: Set<String>) =
    values.joinToString(prefix = "[", postfix = "]") {
      "'${javascriptString(it)}'"
    }

  private fun automationScript(
    days: Int,
    requestedStartDate: String?,
    requestedEndDate: String?,
    alreadySubmitted: Boolean,
  ): String {
    val isoDate = Regex("""\d{4}-\d{2}-\d{2}""")
    val safeStart = requestedStartDate?.takeIf(isoDate::matches)
    val safeEnd = requestedEndDate?.takeIf(isoDate::matches)
    val customRange = safeStart != null && safeEnd != null
    val startValue = if (customRange) "'$safeStart'" else "iso(start)"
    val endValue = if (customRange) "'$safeEnd'" else "iso(now)"
    val generatedLabels = javascriptStringArray(CSV_GENERATED_DOWNLOAD_LABELS)
    return """
      (function () {
        try {
          const visible = (el) => {
            const r = el.getBoundingClientRect();
            const s = window.getComputedStyle(el);
            return r.width > 0 && r.height > 0 &&
              s.visibility !== 'hidden' && s.display !== 'none';
          };
          const text = (el) => (el.innerText || el.textContent || el.value || '')
            .replace(/\s+/g, ' ').trim().toLowerCase();
          if (document.querySelector('input[type="password"]') ||
              /users\/sign_in|\/login/i.test(location.pathname)) return 'login';
          const all = Array.from(document.querySelectorAll(
            'button,a,input[type="button"],input[type="submit"],[role="button"]'
          ));
          let storedExportSubmitted = false;
          try {
            storedExportSubmitted =
              sessionStorage.getItem('t1arcCsvSubmitted') === '1';
          } catch (_) {}
          const exportSubmitted = $alreadySubmitted || storedExportSubmitted;
          const generatedLabels = new Set($generatedLabels);
          const generatedControl = all.find((el) => {
            if (
              !exportSubmitted ||
              !visible(el) ||
              el.disabled ||
              el.dataset.daymarkDownloaded
            ) return false;
            const label = text(el);
            const originalSubmitLabel =
              String(el.dataset.daymarkSubmitLabel || '');
            if (originalSubmitLabel && originalSubmitLabel === label) {
              return false;
            }
            const transitionedSubmit =
              originalSubmitLabel && originalSubmitLabel !== label;
            const href = String(el.getAttribute('href') || '');
            const downloadName = String(el.getAttribute('download') || '');
            const fileLink = /\.(csv|zip)(?:$|[?#])/i.test(href) ||
              /\.(csv|zip)$/i.test(downloadName);
            const explicitLabel = generatedLabels.has(label);
            const outsideExportDialog = !el.closest(
              '[role="dialog"],[aria-modal="true"],.modal,' +
              '[class*="modal" i],[class*="dialog" i]'
            );
            return fileLink || explicitLabel ||
              (label === 'download' &&
                (outsideExportDialog || transitionedSubmit));
          });
          if (generatedControl) {
            generatedControl.dataset.daymarkDownloaded = '1';
            generatedControl.click();
            return 'download';
          }
          if (exportSubmitted) return 'waiting-download';
          const opener = all.find((el) =>
            visible(el) && text(el).includes('export to csv'));
          const standardOverlay = document.querySelector(
            '[role="dialog"],[aria-modal="true"],.modal,' +
            '[class*="modal" i],[class*="dialog" i]'
          );
          const promptOverlay = Array.from(document.querySelectorAll(
            'form,section,div'
          )).filter((el) =>
            visible(el) &&
            text(el).includes('export') &&
            text(el).includes('sensitive information') &&
            el.querySelector('button,input,select,[role="button"]')
          ).sort((left, right) =>
            left.getBoundingClientRect().width * left.getBoundingClientRect().height -
            right.getBoundingClientRect().width * right.getBoundingClientRect().height
          )[0];
          const overlay = standardOverlay && visible(standardOverlay)
            ? standardOverlay
            : promptOverlay;
          if (!overlay && opener && !opener.dataset.daymarkOpened) {
            opener.dataset.daymarkOpened = '1';
            opener.click();
            return 'opened';
          }
          const scope = overlay || document;
          const targetLabels = $customRange
            ? ['custom']
            : ${days} <= 14
              ? ['2 weeks', '14 days']
              : ${days} <= 30
                ? ['30 days', '4 weeks', '1 month']
                : ['90 days', '3 months'];
          let rangeSelected =
            document.documentElement.dataset.daymarkRangeSelected === '1';
          Array.from(scope.querySelectorAll('select')).forEach((select) => {
            const exact = Array.from(select.options).find((option) =>
              $customRange
                ? text(option).includes('custom') ||
                  String(option.value || '').toLowerCase().includes('custom')
                : targetLabels.some((label) => text(option).includes(label)) ||
                  option.value === '${days}');
            if (exact) {
              const setter = Object.getOwnPropertyDescriptor(
                window.HTMLSelectElement.prototype, 'value'
              )?.set;
              if (setter) setter.call(select, exact.value);
              else select.value = exact.value;
              select.dispatchEvent(new Event('input', { bubbles: true }));
              select.dispatchEvent(new Event('change', { bubbles: true }));
              rangeSelected = true;
              document.documentElement.dataset.daymarkRangeSelected = '1';
            }
          });
          if (!$customRange && !rangeSelected) {
            const rangeControls = Array.from(scope.querySelectorAll(
              'button,[role="button"],[role="option"],li,label'
            )).filter(visible);
            const desired = rangeControls.find((el) =>
              targetLabels.some((label) => text(el) === label) &&
              el.getAttribute('aria-selected') !== 'true');
            const current = rangeControls.find((el) =>
              /^(2 weeks|14 days|30 days|4 weeks|1 month|90 days|3 months)$/i
                .test(text(el)));
            if (desired && desired !== current) {
              desired.click();
              document.documentElement.dataset.daymarkRangeSelected = '1';
              return 'opened';
            }
            if (
              current &&
              !targetLabels.some((label) => text(current) === label)
            ) {
              current.click();
              return 'opened';
            }
            if (
              current &&
              targetLabels.some((label) => text(current) === label)
            ) {
              document.documentElement.dataset.daymarkRangeSelected = '1';
            }
          }
          const now = new Date();
          const start = new Date(now.getTime() - (${days} - 1) * 86400000);
          const iso = (date) => [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0')
          ].join('-');
          let dates = Array.from(scope.querySelectorAll('input[type="date"]'));
          if ($customRange && dates.length < 2) {
            const customControl = Array.from(scope.querySelectorAll(
              'button,label,[role="option"],[role="radio"]'
            )).find((el) => visible(el) && text(el).includes('custom'));
            if (customControl && !customControl.dataset.daymarkCustomSelected) {
              customControl.dataset.daymarkCustomSelected = '1';
              customControl.click();
            }
            return 'opened';
          }
          if (dates.length >= 2) {
            const nativeSetter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype, 'value'
            )?.set;
            if (nativeSetter) {
              nativeSetter.call(dates[0], $startValue);
              nativeSetter.call(dates[1], $endValue);
            } else {
              dates[0].value = $startValue;
              dates[1].value = $endValue;
            }
            dates.forEach((input) => {
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
            });
          }
          const submit = Array.from(scope.querySelectorAll(
            'button,input[type="button"],input[type="submit"],a'
          )).find((el) =>
            visible(el) &&
            !el.disabled &&
            el !== opener &&
            (text(el) === 'export' || text(el) === 'download'));
          if (submit && !submit.dataset.daymarkSubmitted) {
            submit.dataset.daymarkSubmitted = '1';
            submit.dataset.daymarkSubmitLabel = text(submit);
            try {
              sessionStorage.setItem('t1arcCsvSubmitted', '1');
            } catch (_) {}
            if (
              window.$BRIDGE_NAME &&
              window.$BRIDGE_NAME.onExportSubmitted
            ) window.$BRIDGE_NAME.onExportSubmitted();
            submit.click();
            return 'submitted';
          }
          return overlay ? 'modal' : 'waiting';
        } catch (_) {
          return 'waiting';
        }
      })();
    """.trimIndent()
  }

  /**
   * Selects a rolling report window and every supported report section. The
   * retained PDF is the user's complete source document; normalisation can
   * improve later without requiring another Glooko download.
   */
  private fun reportAutomationScript(
    days: Int,
    alreadySubmitted: Boolean,
  ): String {
    val generatedLabels = javascriptStringArray(PDF_GENERATED_DOWNLOAD_LABELS)
    return """
      (function () {
        try {
          const visible = (el) => {
            const r = el.getBoundingClientRect();
            const s = window.getComputedStyle(el);
            return r.width > 0 && r.height > 0 &&
              s.visibility !== 'hidden' && s.display !== 'none';
          };
          const text = (el) => (el.innerText || el.textContent || el.value || '')
            .replace(/\s+/g, ' ').trim().toLowerCase();
          if (document.querySelector('input[type="password"]') ||
              /users\/sign_in|\/login/i.test(location.pathname)) return 'login';
          const controls = Array.from(document.querySelectorAll(
            'button,a,input[type="button"],input[type="submit"],[role="button"]'
          ));
          let storedReportSubmitted = false;
          try {
            storedReportSubmitted =
              sessionStorage.getItem('t1arcReportSubmitted') === '1';
          } catch (_) {}
          const reportSubmitted = $alreadySubmitted || storedReportSubmitted;
          const generatedLabels = new Set($generatedLabels);
          const generatedControl = controls.find((el) => {
            if (
              !reportSubmitted ||
              !visible(el) ||
              el.disabled ||
              el.dataset.t1arcReportDownloaded
            ) return false;
            const label = text(el);
            const originalSubmitLabel =
              String(el.dataset.t1arcReportSubmitLabel || '');
            if (originalSubmitLabel && originalSubmitLabel === label) {
              return false;
            }
            return generatedLabels.has(label);
          });
          if (generatedControl) {
            generatedControl.dataset.t1arcReportDownloaded = '1';
            generatedControl.click();
            return 'download';
          }
          if (reportSubmitted) return 'waiting-download';
          const opener = controls.find((el) => {
            const label = text(el);
            return visible(el) &&
              (label.includes('create pdf report') ||
                label === 'create pdf' ||
                label.includes('create report') && label.includes('pdf') ||
                label.includes('pdf report') && label.includes('create'));
          });
          const standardOverlay = document.querySelector(
            '[role="dialog"],[aria-modal="true"],.modal,' +
            '[class*="modal" i],[class*="dialog" i]'
          );
          const promptOverlay = Array.from(document.querySelectorAll(
            'form,section,div'
          )).filter((el) => {
            if (!visible(el)) return false;
            const label = text(el);
            return label.includes('pdf') &&
              (label.includes('daily overview') || label.includes('week view')) &&
              el.querySelector('button,input,select,[role="button"]');
          }).sort((left, right) =>
            left.getBoundingClientRect().width * left.getBoundingClientRect().height -
            right.getBoundingClientRect().width * right.getBoundingClientRect().height
          )[0];
          const overlay = standardOverlay && visible(standardOverlay)
            ? standardOverlay
            : promptOverlay;
          if (!overlay && opener && !opener.dataset.t1arcReportOpened) {
            opener.dataset.t1arcReportOpened = '1';
            opener.click();
            return 'opened';
          }
          const scope = overlay || document;
          const targetLabels = ${days} <= 7
            ? ['1 week', '7 days']
            : ${days} <= 14
              ? ['2 weeks', '14 days']
              : ${days} <= 30
                ? ['30 days', '4 weeks', '1 month']
                : ['90 days', '3 months'];
          let rangeSelected =
            document.documentElement.dataset.t1arcReportRangeSelected === '1';
          Array.from(scope.querySelectorAll('select')).forEach((select) => {
            const exact = Array.from(select.options).find((option) =>
              targetLabels.some((label) => text(option).includes(label)) ||
              option.value === '${days}');
            if (!exact) return;
            const setter = Object.getOwnPropertyDescriptor(
              window.HTMLSelectElement.prototype, 'value'
            )?.set;
            if (setter) setter.call(select, exact.value);
            else select.value = exact.value;
            select.dispatchEvent(new Event('input', { bubbles: true }));
            select.dispatchEvent(new Event('change', { bubbles: true }));
            rangeSelected = true;
            document.documentElement.dataset.t1arcReportRangeSelected = '1';
          });
          if (!rangeSelected) {
            const rangeControls = Array.from(scope.querySelectorAll(
              'button,[role="button"],[role="option"],[role="radio"],li,label'
            )).filter(visible);
            const desired = rangeControls.find((el) =>
              targetLabels.some((label) => text(el) === label));
            if (
              desired &&
              desired.getAttribute('aria-selected') !== 'true' &&
              desired.getAttribute('aria-checked') !== 'true' &&
              !desired.dataset.t1arcRangeSelected
            ) {
              desired.dataset.t1arcRangeSelected = '1';
              desired.click();
              document.documentElement.dataset.t1arcReportRangeSelected = '1';
              return 'opened';
            }
          }
          const now = new Date();
          const start = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() - (${days} - 1)
          );
          const iso = (date) => [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0')
          ].join('-');
          const dates = Array.from(scope.querySelectorAll('input[type="date"]'));
          if (dates.length >= 2) {
            const nativeSetter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype, 'value'
            )?.set;
            const values = [iso(start), iso(now)];
            dates.slice(0, 2).forEach((input, index) => {
              if (nativeSetter) nativeSetter.call(input, values[index]);
              else input.value = values[index];
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
            });
          }
          const reportNames = [
            'summary', 'logbook', 'overview', 'daily overview',
            'day-by-day analysis', 'week view', 'overlay',
            'calendar', 'insights', 'devices'
          ];
          const labels = Array.from(scope.querySelectorAll(
            'label,button,[role="button"],[role="checkbox"],[role="option"]'
          )).filter(visible);
          let selectionChanged = false;
          reportNames.forEach((name) => {
            const label = labels.find((candidate) => {
              const value = text(candidate);
              return value === name || value.startsWith(name + ' ') ||
                value.endsWith(' ' + name);
            });
            if (!label) return;
            const forId = label.getAttribute('for');
            const input = label.querySelector('input[type="checkbox"]') ||
              (forId && document.getElementById(forId));
            const selected =
              !!(input && input.checked) ||
              label.getAttribute('aria-checked') === 'true' ||
              label.getAttribute('aria-pressed') === 'true' ||
              label.getAttribute('aria-selected') === 'true' ||
              /(^|\s)(active|checked|selected)(\s|$)/i.test(
                String(label.className || '')
              ) ||
              /(^|\s)(active|checked|selected)(\s|$)/i.test(
                String(label.parentElement?.className || '')
              );
            if (input && !selected) {
              input.click();
              selectionChanged = true;
            } else if (
              !input &&
              !selected &&
              !label.dataset.t1arcReportSelected
            ) {
              label.dataset.t1arcReportSelected = '1';
              label.click();
              selectionChanged = true;
            }
          });
          if (selectionChanged) return 'opened';
          const submit = Array.from(scope.querySelectorAll(
            'button,input[type="button"],input[type="submit"],a,[role="button"]'
          )).find((el) => {
            if (!visible(el) || el === opener) return false;
            const label = text(el);
            return label === 'create pdf' ||
              label === 'create report' ||
              label === 'generate pdf' ||
              label === 'download pdf' ||
              label === 'download report';
          });
          if (
            submit &&
            !submit.disabled &&
            !submit.dataset.t1arcReportSubmitted
          ) {
            submit.dataset.t1arcReportSubmitted = '1';
            submit.dataset.t1arcReportSubmitLabel = text(submit);
            try {
              sessionStorage.setItem('t1arcReportSubmitted', '1');
            } catch (_) {}
            if (
              window.$BRIDGE_NAME &&
              window.$BRIDGE_NAME.onExportSubmitted
            ) window.$BRIDGE_NAME.onExportSubmitted();
            submit.click();
            return 'submitted';
          }
          return 'state:' +
            'path=' + location.pathname.slice(0, 50) +
            ',opener=' + (opener ? '1' : '0') +
            ',overlay=' + (overlay ? '1' : '0') +
            ',controls=' + controls.length +
            ',reports=' + labels.length +
            ',submit=' + (submit ? (submit.disabled ? 'disabled' : 'ready') : '0') +
            ',submitted=' + (reportSubmitted ? '1' : '0');
        } catch (_) {
          return 'waiting';
        }
      })();
    """.trimIndent()
  }

  private fun downloadCaptureScript(expectedPdf: Boolean): String {
    val looksLikeFileExpression =
      if (expectedPdf) {
        """
          value.includes('application/pdf') || value.includes('.pdf') ||
            (active() && (value.includes('report') || value.includes('download')))
        """.trimIndent()
      } else {
        """
          value.includes('text/csv') || value.includes('application/csv') ||
            value.includes('application/zip') || value.includes('application/x-zip') ||
            value.includes('.zip') || value.includes('.csv') ||
            (active() && value.includes('application/octet-stream'))
        """.trimIndent()
      }
    val defaultFileName =
      if (expectedPdf) "glooko-daily-overview.pdf" else "glooko-export.zip"
    val responseNameExpression =
      if (expectedPdf) {
        "'glooko-daily-overview.pdf'"
      } else {
        "((response.headers.get('content-type') || '').includes('csv') ? " +
          "'glooko-export.csv' : 'glooko-export.zip')"
      }
    val xhrFileNameExpression =
      if (expectedPdf) {
        "'glooko-daily-overview.pdf'"
      } else {
        "type.includes('csv') ? 'glooko-export.csv' : 'glooko-export.zip'"
      }
    return """
      (function () {
        if (window.__daymarkSilentCapture) return;
        window.__daymarkSilentCapture = true;
        const bridge = window.$BRIDGE_NAME;
        let exportUntil = 0;
        const generatedBlobs = new Map();
        const markExport = () => {
          exportUntil = Date.now() + 180000;
          bridge.onTrace('export-clicked');
        };
        const active = () => Date.now() < exportUntil;
        const looksLikeFile = (url, type, disposition) => {
          const value = [url || '', type || '', disposition || ''].join(' ').toLowerCase();
          return $looksLikeFileExpression;
        };
        const isBlobLike = (value) =>
          value && typeof value.size === 'number' &&
            typeof value.slice === 'function';
        const asBlob = (value, type) => {
          if (isBlobLike(value)) return value;
          if (value instanceof ArrayBuffer) return new Blob([value], { type: type || '' });
          if (ArrayBuffer.isView && ArrayBuffer.isView(value)) {
            return new Blob([value.buffer], { type: type || '' });
          }
          return null;
        };
        const sendBlob = (blob, name, trace) => {
          if (!isBlobLike(blob) || !blob.size || blob.size > 52428800) return;
          bridge.onTrace(trace);
          const reader = new FileReader();
          reader.onload = () => {
            const value = String(reader.result || '');
            const comma = value.indexOf(',');
            if (comma > 0) bridge.onExportBytes(
              value.slice(comma + 1), name || '$defaultFileName'
            );
          };
          reader.readAsDataURL(blob);
        };
        const responseName = (response) => {
          const cd = response.headers.get('content-disposition') || '';
          const match = cd.match(/filename\*?=(?:UTF-8''|["']?)([^"';\r\n]+)/i);
          return match ? decodeURIComponent(match[1].replace(/["']/g, '')) :
            $responseNameExpression;
        };
        document.addEventListener('click', (event) => {
          const control = event.target && event.target.closest &&
            event.target.closest('button,a,input[type="button"],input[type="submit"]');
          const label = control &&
            (control.innerText || control.textContent || control.value || '').toLowerCase();
          if (
            label &&
            (label.includes('export') || label.includes('create pdf') ||
              label === 'download' || label.includes('download report') ||
              label.includes('download pdf') ||
              label.includes('download csv') ||
              label.includes('download data'))
          ) markExport();
          const href = control && control.href;
          const downloadName = control && control.download;
          if (href && href.startsWith('blob:') && (active() || downloadName)) {
            const generated = generatedBlobs.get(href);
            if (generated) {
              sendBlob(generated, downloadName || '$defaultFileName', 'blob-file');
            } else {
              window.fetch(href).then((response) => response.blob()).then((blob) =>
                sendBlob(blob, downloadName || '$defaultFileName', 'blob-file')
              ).catch(() => {});
            }
          } else if (href && looksLikeFile(href, '', downloadName || '')) {
            bridge.onDownloadUrl(href);
          }
        }, true);
        document.addEventListener('submit', () => { if (active()) markExport(); }, true);
        const originalFetch = window.fetch && window.fetch.bind(window);
        if (originalFetch) {
          window.fetch = async function (...args) {
            const response = await originalFetch.apply(this, args);
            try {
              const type = response.headers.get('content-type') || '';
              const disposition = response.headers.get('content-disposition') || '';
              if (looksLikeFile(response.url || args[0], type, disposition)) {
                response.clone().blob().then((blob) =>
                  sendBlob(blob, responseName(response), 'fetch-file')
                ).catch(() => {});
              }
            } catch (_) {}
            return response;
          };
        }
        const originalWindowOpen = window.open && window.open.bind(window);
        if (originalWindowOpen) {
          window.open = function (url) {
            const value = String(url || '');
            if (value && looksLikeFile(value, '', '')) {
              bridge.onDownloadUrl(value);
              return null;
            }
            return originalWindowOpen.apply(this, arguments);
          };
        }
        const originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url) {
          this.__daymarkUrl = String(url || '');
          this.addEventListener('load', function () {
            try {
              const type = this.getResponseHeader('content-type') || '';
              const disposition = this.getResponseHeader('content-disposition') || '';
              if (!looksLikeFile(this.responseURL || this.__daymarkUrl, type, disposition)) return;
              let blob = asBlob(this.response, type);
              if (!blob && typeof this.responseText === 'string') {
                blob = new Blob([this.responseText], { type });
              }
              sendBlob(blob, $xhrFileNameExpression, 'xhr-file');
            } catch (_) {}
          });
          return originalOpen.apply(this, arguments);
        };
        if (URL && URL.createObjectURL) {
          const original = URL.createObjectURL.bind(URL);
          URL.createObjectURL = function (object) {
            const value = original(object);
            const blob = asBlob(object, object && object.type);
            if (blob && (active() || looksLikeFile('', blob.type, ''))) {
              generatedBlobs.set(value, blob);
              sendBlob(blob, $xhrFileNameExpression, 'blob-file');
            }
            return value;
          };
          if (URL.revokeObjectURL) {
            const originalRevoke = URL.revokeObjectURL.bind(URL);
            URL.revokeObjectURL = function (value) {
              if (generatedBlobs.has(value)) {
                setTimeout(() => {
                  generatedBlobs.delete(value);
                  originalRevoke(value);
                }, 30000);
                return;
              }
              originalRevoke(value);
            };
          }
        }
      })();
    """.trimIndent()
  }
}
