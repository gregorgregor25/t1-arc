package app.daymark.glooko

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.JavascriptInterface
import android.webkit.SslErrorHandler
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Base64
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class GlookoExportActivity : Activity(), DownloadListener {
  companion object {
    const val EXTRA_DAYS = "days"
    const val EXTRA_START_DATE = "startDate"
    const val EXTRA_END_DATE = "endDate"
    const val RESULT_URI = "uri"
    const val RESULT_FILE_NAME = "fileName"
    const val RESULT_BYTE_LENGTH = "byteLength"
    const val RESULT_STATUS = "status"
    const val RESULT_MESSAGE = "message"
    const val RESULT_DIAGNOSTIC = "diagnostic"

    private const val LOGIN_URL = "https://my.glooko.com/users/sign_in"
    private const val MAX_DOWNLOAD_BYTES = 50L * 1024L * 1024L
    private const val MAX_AUTOMATION_ATTEMPTS = 24
    private const val BRIDGE_NAME = "DaymarkGlookoBridge"
  }

  private lateinit var webView: WebView
  private lateinit var root: LinearLayout
  private lateinit var statusText: TextView
  private lateinit var progress: ProgressBar
  private val mainHandler = Handler(Looper.getMainLooper())
  private val downloadExecutor = Executors.newSingleThreadExecutor()
  private val finishingDownload = AtomicBoolean(false)
  private val popupWebViews = mutableListOf<WebView>()
  private val traceEvents = mutableListOf<String>()
  private val traceStartedAt = SystemClock.elapsedRealtime()
  private var backInvokedCallback: OnBackInvokedCallback? = null
  private var automationAttempts = 0
  private var requestedDays = 30
  private var requestedStartDate: String? = null
  private var requestedEndDate: String? = null
  private var credentialLoginAttempted = false

  @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val forceFreshLogin =
      getSharedPreferences(GLOOKO_TRACE_PREFERENCES, MODE_PRIVATE)
        .getString(GLOOKO_LAST_TRACE_KEY, null)
        ?.contains("requires sign-in", ignoreCase = true) == true
    window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    traceEvent("Secure Glooko window opened")
    requestedDays = intent.getIntExtra(EXTRA_DAYS, 30).coerceIn(1, 90)
    requestedStartDate = intent.getStringExtra(EXTRA_START_DATE)
    requestedEndDate = intent.getStringExtra(EXTRA_END_DATE)
    cleanOldDownloads()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      backInvokedCallback =
        OnBackInvokedCallback {
          cancelAndFinish()
        }.also { callback ->
          onBackInvokedDispatcher.registerOnBackInvokedCallback(
            OnBackInvokedDispatcher.PRIORITY_DEFAULT,
            callback,
          )
        }
    }

    val density = resources.displayMetrics.density
    val horizontalPadding = (18 * density).toInt()
    val verticalPadding = (12 * density).toInt()

    statusText =
      TextView(this).apply {
        text = "Opening Glooko securely…"
        textSize = 14f
        setTextColor(resolveTextColor())
        setPadding(horizontalPadding, verticalPadding, horizontalPadding, verticalPadding)
      }
    progress =
      ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
        isIndeterminate = true
        max = 100
      }
    val closeButton =
      Button(this).apply {
        text = "Back to app"
        setOnClickListener { cancelAndFinish() }
      }
    val topBar =
      LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setBackgroundColor(resolveSurfaceColor())
        addView(
          statusText,
          LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f),
        )
        addView(
          closeButton,
          LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
          ),
        )
      }

    webView =
      WebView(this).apply {
        setBackgroundColor(resolveBackgroundColor())
        settings.apply {
          javaScriptEnabled = true
          domStorageEnabled = true
          databaseEnabled = true
          mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
          allowFileAccess = false
          allowContentAccess = false
          javaScriptCanOpenWindowsAutomatically = true
          setSupportMultipleWindows(true)
          cacheMode = WebSettings.LOAD_DEFAULT
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
        addJavascriptInterface(ExportBridge(), BRIDGE_NAME)
        setDownloadListener(this@GlookoExportActivity)
        webChromeClient = createWebChromeClient()
        webViewClient = createWebViewClient()
      }
    WebView.setWebContentsDebuggingEnabled(false)

    root =
      LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(resolveBackgroundColor())
        addView(
          topBar,
          LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
          ),
        )
        addView(
          progress,
          LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            (3 * density).toInt(),
          ),
        )
        addView(
          webView,
          LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f,
          ),
        )
    }
    setContentView(root)
    GlookoSessionVault(this).prepareInteractiveSession(
      CookieManager.getInstance(),
      forceFreshLogin,
    ) {
      webView.loadUrl(LOGIN_URL)
    }
  }

  @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
  private fun createWebChromeClient() =
    object : WebChromeClient() {
      override fun onProgressChanged(view: WebView?, newProgress: Int) {
        if (view !== webView) return
        this@GlookoExportActivity.progress.isIndeterminate =
          newProgress <= 0 || newProgress >= 100
        this@GlookoExportActivity.progress.progress = newProgress
        this@GlookoExportActivity.progress.visibility =
          if (newProgress >= 100) View.GONE else View.VISIBLE
      }

      override fun onCreateWindow(
        view: WebView?,
        isDialog: Boolean,
        isUserGesture: Boolean,
        resultMsg: Message?,
      ): Boolean {
        val transport = resultMsg?.obj as? WebView.WebViewTransport ?: return false
        traceEvent("Glooko requested a secondary download window")
        val parentChromeClient = this
        val popup =
          WebView(this@GlookoExportActivity).apply {
            visibility = View.INVISIBLE
            settings.apply {
              javaScriptEnabled = true
              domStorageEnabled = true
              databaseEnabled = true
              mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
              allowFileAccess = false
              allowContentAccess = false
              javaScriptCanOpenWindowsAutomatically = true
              setSupportMultipleWindows(true)
              cacheMode = WebSettings.LOAD_DEFAULT
            }
            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
            addJavascriptInterface(ExportBridge(), BRIDGE_NAME)
            setDownloadListener { url, userAgent, disposition, mimeType, length ->
              handleDownloadStart(
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
                  val uri = request?.url ?: return true
                  return !uri.scheme.equals("https", ignoreCase = true) &&
                    !uri.scheme.equals("blob", ignoreCase = true)
                }

                override fun onPageFinished(popupView: WebView?, url: String?) {
                  super.onPageFinished(popupView, url)
                  traceEvent("Secondary window finished without a download")
                  if (
                    popupView != null &&
                    url != null &&
                    isAllowedGlookoUri(Uri.parse(url))
                  ) {
                    popupView.evaluateJavascript(downloadCaptureScript(), null)
                  }
                }

                override fun onReceivedSslError(
                  popupView: WebView?,
                  handler: SslErrorHandler?,
                  error: SslError?,
                ) {
                  handler?.cancel()
                  fail("Glooko's download connection could not be verified.")
                }
              }
          }
        popupWebViews += popup
        root.addView(
          popup,
          LinearLayout.LayoutParams(1, 1),
        )
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
    root.removeView(popup)
    popup.stopLoading()
    popup.removeJavascriptInterface(BRIDGE_NAME)
    popup.loadUrl("about:blank")
    popup.removeAllViews()
    popup.destroy()
  }

  private fun createWebViewClient() =
    object : WebViewClient() {
      override fun shouldOverrideUrlLoading(
        view: WebView?,
        request: WebResourceRequest?,
      ): Boolean {
        val uri = request?.url ?: return true
        if (isAllowedGlookoUri(uri)) return false
        openExternal(uri)
        return true
      }

      override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
        super.onPageStarted(view, url, favicon)
        setStatus("Loading Glooko…")
      }

      override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)
        if (url == null || !isAllowedGlookoUri(Uri.parse(url))) return
        CookieManager.getInstance().flush()
        injectDownloadCapture()
        automationAttempts = 0
        if (looksLikeLogin(url)) {
          traceEvent("Glooko sign-in page loaded")
          attemptCredentialLogin(view)
        } else {
          val retainedCookieNames = retainGlookoSession(url)
          if (retainedCookieNames.isNotEmpty()) {
            traceEvent(
              "Signed-in session retained securely " +
                "(${retainedCookieNames.joinToString(", ")})",
            )
          }
          traceEvent("Signed-in Glooko dashboard loaded")
          setStatus("Signed in. Preparing a $requestedDays-day delayed export…")
          scheduleAutomationAttempt(900)
        }
      }

      override fun onReceivedSslError(
        view: WebView?,
        handler: SslErrorHandler?,
        error: SslError?,
      ) {
        handler?.cancel()
        fail("Glooko’s secure connection could not be verified.")
      }

      override fun onReceivedError(
        view: WebView?,
        request: WebResourceRequest?,
        error: WebResourceError?,
      ) {
        if (request?.isForMainFrame == true) {
          setStatus("Glooko did not load. Check the connection and try again.")
        }
      }

      override fun onReceivedHttpError(
        view: WebView?,
        request: WebResourceRequest?,
        errorResponse: WebResourceResponse?,
      ) {
        if (request?.isForMainFrame == true && (errorResponse?.statusCode ?: 0) >= 500) {
          setStatus("Glooko is temporarily unavailable.")
        }
      }
    }

  private fun scheduleAutomationAttempt(delayMs: Long) {
    mainHandler.postDelayed(
      {
        if (isFinishing || finishingDownload.get()) return@postDelayed
        val url = webView.url ?: return@postDelayed
        if (looksLikeLogin(url)) return@postDelayed
        if (automationAttempts >= MAX_AUTOMATION_ATTEMPTS) {
          traceEvent("Automatic export control was not found")
          setStatus("Use Glooko’s Export to CSV control; the download will import here.")
          return@postDelayed
        }
        automationAttempts += 1
        webView.evaluateJavascript(
          automationScript(
            requestedDays,
            requestedStartDate,
            requestedEndDate,
          ),
        ) { rawResult ->
          val result = rawResult?.trim('"') ?: ""
          when (result) {
            "submitted" -> {
              traceEvent("Automatic export control submitted")
              setStatus("Waiting for Glooko’s download (this can take 1–2 minutes)…")
            }
            "opened" -> {
              traceEvent("Automatic export options opened")
              setStatus("Export options opened. Preparing the date range…")
              scheduleAutomationAttempt(1300)
            }
            "login" -> attemptCredentialLogin(webView)
            else -> scheduleAutomationAttempt(1600)
          }
        }
      },
      delayMs,
    )
  }

  private fun injectDownloadCapture() {
    webView.evaluateJavascript(downloadCaptureScript(), null)
  }

  override fun onDownloadStart(
    url: String?,
    userAgent: String?,
    contentDisposition: String?,
    mimeType: String?,
    contentLength: Long,
  ) = handleDownloadStart(
    webView,
    url,
    userAgent,
    contentDisposition,
    mimeType,
    contentLength,
  )

  private fun handleDownloadStart(
    sourceView: WebView,
    url: String?,
    userAgent: String?,
    contentDisposition: String?,
    mimeType: String?,
    contentLength: Long,
  ) {
    if (url.isNullOrBlank()) return
    traceEvent("Android received a browser download")
    if (url.startsWith("blob:", ignoreCase = true)) {
      traceEvent("Browser download used generated blob data")
      setStatus("Reading the export locally…")
      sourceView.evaluateJavascript(blobCaptureScript(url, contentDisposition), null)
      return
    }
    if (!url.startsWith("https://", ignoreCase = true)) {
      traceEvent("Browser download used an unsupported address")
      fail("Glooko returned an unsupported download address.")
      return
    }
    downloadHttpExport(url, userAgent, contentDisposition, contentLength)
  }

  private fun downloadHttpExport(
    initialUrl: String,
    userAgent: String?,
    contentDisposition: String?,
    contentLength: Long,
  ) {
    if (contentLength > MAX_DOWNLOAD_BYTES) {
      traceEvent("Browser download exceeded the size limit")
      fail("The Glooko export is larger than the 50 MB safety limit.")
      return
    }
    traceEvent("Secure browser download started")
    setStatus("Downloading the export directly to this device…")
    val effectiveUserAgent = userAgent ?: webView.settings.userAgentString
    downloadExecutor.execute {
      var connection: HttpURLConnection? = null
      var temporaryFile: File? = null
      try {
        var currentUrl = initialUrl
        var disposition = contentDisposition
        var redirects = 0
        var externalDownloadNoted = false
        while (true) {
          val parsed = Uri.parse(currentUrl)
          if (!parsed.scheme.equals("https", ignoreCase = true)) {
            throw IllegalStateException("Glooko returned a non-secure download address.")
          }
          val isGlookoHost = isAllowedGlookoUri(parsed)
          if (!isGlookoHost && !externalDownloadNoted) {
            externalDownloadNoted = true
            traceEvent("Glooko used a separate secure file host")
          }
          connection =
            (URL(currentUrl).openConnection() as HttpURLConnection).apply {
              instanceFollowRedirects = false
              connectTimeout = 30_000
              readTimeout = 90_000
              requestMethod = "GET"
              setRequestProperty("Accept", "application/zip,text/csv,*/*")
              setRequestProperty(
                "User-Agent",
                effectiveUserAgent,
              )
              if (isGlookoHost) {
                CookieManager.getInstance().getCookie(currentUrl)?.let {
                  setRequestProperty("Cookie", it)
                }
              }
            }
          val status = connection.responseCode
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
            val location = connection.getHeaderField("Location")
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
          val reportedLength = connection.contentLengthLong
          if (reportedLength > MAX_DOWNLOAD_BYTES) {
            throw IllegalStateException("The Glooko export is larger than the 50 MB safety limit.")
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
                    "The Glooko export is larger than the 50 MB safety limit.",
                  )
                }
                output.write(buffer, 0, read)
              }
            }
          }
          if (written <= 0) throw IllegalStateException("Glooko returned an empty export.")
          if (!isZipArchive(temporaryFile)) {
            temporaryFile.delete()
            temporaryFile = null
            traceEvent("Intermediate export response ignored; waiting for ZIP")
            setStatus(
              "Glooko accepted the request. Waiting for the actual ZIP " +
                "(this can take 1–2 minutes)…",
            )
            return@execute
          }
          val normalisedFileName = normaliseExportFileName(fileName, temporaryFile)
          CookieManager.getInstance().flush()
          traceEvent("Export bytes downloaded successfully")
          finishWithDownload(temporaryFile, normalisedFileName, written)
          return@execute
        }
      } catch (error: Exception) {
        temporaryFile?.delete()
        traceEvent("Secure browser download failed")
        fail(error.message ?: "The Glooko export could not be downloaded.")
      } finally {
        connection?.disconnect()
      }
    }
  }

  private inner class ExportBridge {
    @JavascriptInterface
    fun onStatus(value: String?) {
      if (!value.isNullOrBlank()) setStatus(value.take(180))
    }

    @JavascriptInterface
    fun onTrace(code: String?) {
      val message =
        when (code) {
          "hooks-installed" -> "Download capture hooks installed"
          "export-clicked" -> "Export action detected in Glooko"
          "export-form" -> "Export form submitted in Glooko"
          "fetch-candidate" -> "Export-like fetch response detected"
          "xhr-candidate" -> "Export-like XHR response detected"
          "object-url-candidate" -> "Generated export file detected"
          "anchor-candidate" -> "Export download link detected"
          "popup-candidate" -> "Export popup address detected"
          "blob-reading" -> "Export bytes are being read locally"
          "json-download-link" -> "Generated export download address detected"
          "intermediate-response" -> "Intermediate export response ignored; waiting for ZIP"
          else -> null
        }
      if (message != null) traceEvent(message)
    }

    @JavascriptInterface
    fun onExportBytes(base64: String?, fileName: String?) {
      if (base64.isNullOrBlank()) {
        traceEvent("Generated export was empty")
        fail("Glooko returned an empty export.")
        return
      }
      traceEvent("Generated export bytes reached the app")
      setStatus("Securing the downloaded export…")
      downloadExecutor.execute {
        var file: File? = null
        try {
          if (base64.length > ((MAX_DOWNLOAD_BYTES * 4L) / 3L + 16_384L)) {
            throw IllegalStateException("The Glooko export is larger than the 50 MB safety limit.")
          }
          val bytes = Base64.getDecoder().decode(base64)
          if (bytes.isEmpty()) throw IllegalStateException("Glooko returned an empty export.")
          if (bytes.size > MAX_DOWNLOAD_BYTES) {
            throw IllegalStateException("The Glooko export is larger than the 50 MB safety limit.")
          }
          if (!isZipArchive(bytes)) {
            traceEvent("Intermediate export response ignored; waiting for ZIP")
            setStatus(
              "Glooko accepted the request. Waiting for the actual ZIP " +
                "(this can take 1–2 minutes)…",
            )
            return@execute
          }
          val displayName =
            normaliseExportFileName(
              safeFileName(fileName ?: "glooko-export.zip"),
              bytes,
            )
          file = newDownloadFile(displayName)
          FileOutputStream(file).use { it.write(bytes) }
          traceEvent("Generated export was captured successfully")
          finishWithDownload(file, displayName, bytes.size.toLong())
        } catch (error: Exception) {
          file?.delete()
          traceEvent("Generated export capture failed")
          fail(error.message ?: "The Glooko export could not be read.")
        }
      }
    }
  }

  private fun finishWithDownload(
    file: File,
    displayName: String,
    byteLength: Long,
  ) {
    if (!finishingDownload.compareAndSet(false, true)) {
      file.delete()
      return
    }
    runOnUiThread {
      CookieManager.getInstance().flush()
      retainGlookoSession(webView.url)
      setResult(
        RESULT_OK,
        Intent().apply {
          putExtra(RESULT_STATUS, "downloaded")
          putExtra(RESULT_URI, Uri.fromFile(file).toString())
          putExtra(RESULT_FILE_NAME, displayName)
          putExtra(RESULT_BYTE_LENGTH, byteLength)
          putExtra(RESULT_DIAGNOSTIC, diagnosticText())
        },
      )
      finish()
    }
  }

  private fun fail(message: String) {
    traceEvent("Connector reported an error")
    runOnUiThread {
      if (!isFinishing) {
        finishingDownload.set(false)
        setStatus(message)
      }
    }
  }

  private fun cancelAndFinish() {
    if (::webView.isInitialized && !looksLikeLogin(webView.url.orEmpty())) {
      CookieManager.getInstance().flush()
      retainGlookoSession(webView.url)
    }
    traceEvent("Returned to the app without a captured file")
    setResult(
      RESULT_OK,
      Intent().apply {
        putExtra(RESULT_STATUS, "cancelled")
        putExtra(
          RESULT_MESSAGE,
          "No Glooko ZIP or CSV download was detected. The export request may have completed, but its browser download was not captured.",
        )
        putExtra(RESULT_DIAGNOSTIC, diagnosticText())
      },
    )
    finish()
  }

  @Deprecated("Deprecated in Java")
  override fun onBackPressed() {
    cancelAndFinish()
  }

  override fun onDestroy() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      backInvokedCallback?.let { callback ->
        onBackInvokedDispatcher.unregisterOnBackInvokedCallback(callback)
      }
      backInvokedCallback = null
    }
    mainHandler.removeCallbacksAndMessages(null)
    downloadExecutor.shutdownNow()
    popupWebViews.toList().forEach(::destroyPopup)
    if (::webView.isInitialized) {
      webView.stopLoading()
      webView.removeJavascriptInterface(BRIDGE_NAME)
      webView.loadUrl("about:blank")
      webView.clearHistory()
      webView.removeAllViews()
      webView.destroy()
    }
    super.onDestroy()
  }

  private fun isAllowedGlookoUri(uri: Uri): Boolean {
    if (!uri.scheme.equals("https", ignoreCase = true)) return false
    val host = uri.host?.lowercase(Locale.ROOT) ?: return false
    return host == "glooko.com" || host.endsWith(".glooko.com")
  }

  private fun looksLikeLogin(url: String): Boolean {
    val lower = url.lowercase(Locale.ROOT)
    return lower.contains("/users/sign_in") || lower.contains("/login")
  }

  private fun attemptCredentialLogin(view: WebView?) {
    val credentials = GlookoCredentialVault(this).read()
    if (credentials == null) {
      setStatus("Sign into Glooko, or enable encrypted automatic sign-in in Sources.")
      return
    }
    if (credentialLoginAttempted) {
      traceEvent("Encrypted Glooko sign-in was not accepted")
      setStatus(
        "Glooko did not accept the encrypted sign-in. Update it in Sources or sign in here.",
      )
      return
    }
    credentialLoginAttempted = true
    traceEvent("Encrypted Glooko sign-in submitted")
    setStatus("Signing into Glooko securely on this phone…")
    view?.evaluateJavascript(glookoLoginScript(credentials)) { raw ->
      when (raw?.trim('"')) {
        "submitted" -> Unit
        "missing-form" -> {
          traceEvent("Glooko sign-in form was not available")
          setStatus("Sign into Glooko on this page to continue.")
        }
        else -> {
          traceEvent("Encrypted Glooko sign-in could not be submitted")
          setStatus("Automatic sign-in could not be completed. Sign in here to continue.")
        }
      }
    }
  }

  private fun retainGlookoSession(vararg urls: String?): Set<String> =
    GlookoSessionVault(this).capture(
      CookieManager.getInstance(),
      buildList {
        add(LOGIN_URL)
        urls.filterNotNullTo(this)
      },
    )

  private fun openExternal(uri: Uri) {
    try {
      startActivity(Intent(Intent.ACTION_VIEW, uri))
    } catch (_: Exception) {
      setStatus("That external link could not be opened.")
    }
  }

  private fun setStatus(message: String) {
    runOnUiThread {
      if (::statusText.isInitialized) statusText.text = message
    }
  }

  private fun traceEvent(message: String) {
    val elapsedSeconds = (SystemClock.elapsedRealtime() - traceStartedAt) / 1000
    val snapshot =
      synchronized(traceEvents) {
        val entry = "+${elapsedSeconds}s $message"
        if (traceEvents.lastOrNull() != entry) traceEvents += entry
        while (traceEvents.size > 24) traceEvents.removeAt(0)
        traceEvents.joinToString("\n")
      }
    getSharedPreferences(GLOOKO_TRACE_PREFERENCES, MODE_PRIVATE)
      .edit()
      .putString(GLOOKO_LAST_TRACE_KEY, snapshot)
      .apply()
  }

  private fun diagnosticText(): String =
    synchronized(traceEvents) {
      traceEvents.joinToString("\n")
    }

  private fun newDownloadFile(fileName: String): File {
    val directory = File(cacheDir, "glooko-downloads")
    if (!directory.exists() && !directory.mkdirs()) {
      throw IllegalStateException("A private download folder could not be created.")
    }
    return File(directory, "${UUID.randomUUID()}-$fileName")
  }

  private fun cleanOldDownloads() {
    val cutoff = System.currentTimeMillis() - 24L * 60L * 60L * 1000L
    File(cacheDir, "glooko-downloads").listFiles()?.forEach { file ->
      if (file.lastModified() < cutoff) file.delete()
    }
  }

  private fun safeFileName(value: String): String {
    val leaf = value.substringAfterLast('/').substringAfterLast('\\')
    val cleaned = leaf.replace(Regex("[^A-Za-z0-9._ -]"), "_").trim().take(120)
    val candidate = cleaned.ifBlank { "glooko-export.zip" }
    return if (
      candidate.endsWith(".zip", ignoreCase = true) ||
        candidate.endsWith(".csv", ignoreCase = true)
    ) {
      candidate
    } else {
      "$candidate.zip"
    }
  }

  private fun normaliseExportFileName(
    value: String,
    file: File,
  ): String {
    return normaliseExportFileName(value, isZipArchive(file))
  }

  private fun normaliseExportFileName(
    value: String,
    bytes: ByteArray,
  ): String =
    normaliseExportFileName(
      value,
      isZipArchive(bytes),
    )

  private fun isZipArchive(file: File): Boolean =
    file.inputStream().use { input ->
      val signature = ByteArray(4)
      input.read(signature) == signature.size && isZipArchive(signature)
    }

  private fun isZipArchive(bytes: ByteArray): Boolean {
    if (bytes.size < 4 || bytes[0] != 0x50.toByte() || bytes[1] != 0x4b.toByte()) {
      return false
    }
    return (
      (bytes[2] == 0x03.toByte() && bytes[3] == 0x04.toByte()) ||
        (bytes[2] == 0x05.toByte() && bytes[3] == 0x06.toByte()) ||
        (bytes[2] == 0x07.toByte() && bytes[3] == 0x08.toByte())
    )
  }

  private fun normaliseExportFileName(
    value: String,
    zip: Boolean,
  ): String {
    val safe = safeFileName(value)
    val stem =
      when {
        safe.endsWith(".zip", ignoreCase = true) -> safe.dropLast(4)
        safe.endsWith(".csv", ignoreCase = true) -> safe.dropLast(4)
        else -> safe
      }.ifBlank { "glooko-export" }
    return "$stem.${if (zip) "zip" else "csv"}"
  }

  private fun resolveTextColor(): Int {
    val attributes = obtainStyledAttributes(intArrayOf(android.R.attr.textColorPrimary))
    return try {
      attributes.getColor(0, Color.rgb(20, 42, 47))
    } finally {
      attributes.recycle()
    }
  }

  private fun resolveSurfaceColor(): Int {
    val attributes = obtainStyledAttributes(intArrayOf(android.R.attr.colorBackground))
    return try {
      attributes.getColor(0, Color.rgb(241, 248, 250))
    } finally {
      attributes.recycle()
    }
  }

  private fun resolveBackgroundColor() = resolveSurfaceColor()

  private fun automationScript(
    days: Int,
    requestedStartDate: String?,
    requestedEndDate: String?,
  ): String {
    val isoDate = Regex("""\d{4}-\d{2}-\d{2}""")
    val safeStart = requestedStartDate?.takeIf(isoDate::matches)
    val safeEnd = requestedEndDate?.takeIf(isoDate::matches)
    val customRange = safeStart != null && safeEnd != null
    val startValue = if (customRange) "'$safeStart'" else "iso(start)"
    val endValue = if (customRange) "'$safeEnd'" else "iso(now)"
    return """
      (function () {
        try {
          const visible = (el) => {
            const r = el.getBoundingClientRect();
            const s = window.getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
          };
          const text = (el) => (el.innerText || el.textContent || el.value || '')
            .replace(/\s+/g, ' ').trim().toLowerCase();
          if (document.querySelector('input[type="password"]') ||
              /users\/sign_in|\/login/i.test(location.pathname)) return 'login';

          const all = Array.from(document.querySelectorAll('button,a,input[type="button"],input[type="submit"]'));
          const opener = all.find((el) => visible(el) &&
            (text(el) === 'export to csv' || text(el).includes('export to csv')));
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
          const selects = Array.from(scope.querySelectorAll('select'));
          selects.forEach((select) => {
            const options = Array.from(select.options);
            const exact = $customRange
              ? options.find((option) =>
                  text(option).includes('custom') ||
                  String(option.value || '').toLowerCase().includes('custom'))
              : options.find((option) =>
                  targetLabels.some((label) => text(option).includes(label)) ||
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
          let dateInputs = Array.from(scope.querySelectorAll('input[type="date"]'));
          if ($customRange && dateInputs.length < 2) {
            const customControl = Array.from(scope.querySelectorAll(
              'button,label,[role="option"],[role="radio"]'
            )).find((el) => visible(el) && text(el).includes('custom'));
            if (customControl && !customControl.dataset.daymarkCustomSelected) {
              customControl.dataset.daymarkCustomSelected = '1';
              customControl.click();
            }
            return 'opened';
          }
          if (dateInputs.length >= 2) {
            const nativeSetter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype, 'value'
            )?.set;
            if (nativeSetter) {
              nativeSetter.call(dateInputs[0], $startValue);
              nativeSetter.call(dateInputs[1], $endValue);
            } else {
              dateInputs[0].value = $startValue;
              dateInputs[1].value = $endValue;
            }
            dateInputs.forEach((input) => {
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
            });
          }

          const modalButtons = Array.from(scope.querySelectorAll(
            'button,input[type="button"],input[type="submit"],a'
          ));
          const submit = modalButtons.find((el) =>
            visible(el) &&
            !el.disabled &&
            el !== opener &&
            (text(el) === 'export' || text(el) === 'download'));
          if (submit && !submit.dataset.daymarkSubmitted) {
            submit.dataset.daymarkSubmitted = '1';
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

  private fun downloadCaptureScript() =
    """
      (function () {
        if (window.__daymarkDownloadCaptureInstalled) return;
        window.__daymarkDownloadCaptureInstalled = true;
        const bridge = window.$BRIDGE_NAME;
        let exportActiveUntil = 0;
        const exportActive = () => Date.now() < exportActiveUntil;
        const markExportActive = () => {
          exportActiveUntil = Date.now() + 180000;
          bridge.onTrace('export-clicked');
          bridge.onStatus('Waiting for Glooko’s download (this can take 1–2 minutes)…');
        };
        const fileName = (headers, fallback) => {
          try {
            const cd = headers && headers.get && headers.get('content-disposition');
            const match = cd && cd.match(/filename\*?=(?:UTF-8''|["']?)([^"';\r\n]+)/i);
            return match ? decodeURIComponent(match[1].replace(/["']/g, '')) : fallback;
          } catch (_) { return fallback; }
        };
        const shouldCapture = (url, type, disposition) => {
          const value = [url || '', type || '', disposition || ''].join(' ').toLowerCase();
          return value.includes('text/csv') || value.includes('application/csv') ||
            value.includes('application/zip') || value.includes('application/x-zip') ||
            value.includes('export_csv') || value.includes('export-to-csv') ||
            value.includes('/download') || value.includes('attachment') ||
            value.includes('.zip') || value.includes('.csv') ||
            (exportActive() && value.includes('application/octet-stream'));
        };
        const responseLooksLikeFile = (url, type, disposition) => {
          const mime = String(type || '').toLowerCase();
          const cd = String(disposition || '').toLowerCase();
          const address = String(url || '').toLowerCase().split(/[?#]/)[0];
          return mime.includes('text/csv') || mime.includes('application/csv') ||
            mime.includes('application/zip') || mime.includes('application/x-zip') ||
            (exportActive() && mime.includes('application/octet-stream')) ||
            (cd.includes('attachment') &&
              (cd.includes('.zip') || cd.includes('.csv') || cd.includes('filename'))) ||
            address.endsWith('.zip') || address.endsWith('.csv');
        };
        const fallbackName = (type, disposition) => {
          const value = [type || '', disposition || ''].join(' ').toLowerCase();
          return value.includes('csv') ? 'glooko-export.csv' : 'glooko-export.zip';
        };
        const capture = (blob, name, traceCode) => {
          if (!blob || blob.size === 0 || blob.size > 52428800) return;
          bridge.onTrace(traceCode || 'blob-reading');
          const reader = new FileReader();
          reader.onload = () => {
            const result = String(reader.result || '');
            const comma = result.indexOf(',');
            if (comma > 0) bridge.onExportBytes(result.slice(comma + 1), name || 'glooko-export.zip');
          };
          reader.readAsDataURL(blob);
        };

        const originalFetch = window.fetch && window.fetch.bind(window);
        const inspectResponse = (response, requestUrl, traceCode) => {
          try {
            const url = response.url || String(requestUrl || '');
            const type = response.headers.get('content-type') || '';
            const disposition = response.headers.get('content-disposition') || '';
            if (responseLooksLikeFile(url, type, disposition)) {
              bridge.onTrace(traceCode);
              response.clone().blob().then((blob) =>
                capture(
                  blob,
                  fileName(response.headers, fallbackName(type, disposition)),
                  'blob-reading'
                )
              ).catch(() => {});
              return;
            }
            if (exportActive() && shouldCapture(url, type, disposition)) {
              bridge.onTrace('intermediate-response');
            }
            if (exportActive() && type.toLowerCase().includes('json')) {
              response.clone().json().then((payload) => {
                const pending = [payload];
                let inspected = 0;
                while (pending.length && inspected < 80) {
                  const value = pending.shift();
                  inspected += 1;
                  if (typeof value === 'string' && shouldCapture(value, '', '')) {
                    bridge.onTrace('json-download-link');
                    captureUrl(value, 'glooko-export.zip');
                    return;
                  }
                  if (Array.isArray(value)) pending.push.apply(pending, value);
                  else if (value && typeof value === 'object') {
                    pending.push.apply(pending, Object.values(value));
                  }
                }
              }).catch(() => {});
            }
          } catch (_) {}
        };
        const captureUrl = (value, name) => {
          if (!originalFetch || !value) return;
          let url;
          try { url = new URL(String(value), location.href).toString(); }
          catch (_) { return; }
          if (!url.startsWith('https://') && !url.startsWith('blob:')) return;
          if (!exportActive() && !shouldCapture(url, '', '')) return;
          originalFetch(url, { credentials: 'include' })
            .then((response) => inspectResponse(response, url, 'fetch-candidate'))
            .catch(() => {});
        };

        document.addEventListener('click', (event) => {
          try {
            const control = event.target && event.target.closest &&
              event.target.closest('button,a,input[type="button"],input[type="submit"]');
            if (!control) return;
            const label = (control.innerText || control.textContent || control.value || '')
              .replace(/\s+/g, ' ').trim().toLowerCase();
            if (label.includes('export')) markExportActive();
            const href = control.href || '';
            if (href && shouldCapture(href, '', control.download || '')) {
              bridge.onTrace('anchor-candidate');
              captureUrl(href, control.download || 'glooko-export.zip');
            }
          } catch (_) {}
        }, true);

        document.addEventListener('submit', (event) => {
          try {
            const form = event.target;
            const label = (form.innerText || form.textContent || form.action || '')
              .replace(/\s+/g, ' ').trim().toLowerCase();
            if (label.includes('export') || exportActive()) {
              exportActiveUntil = Date.now() + 180000;
              bridge.onTrace('export-form');
              bridge.onStatus('Waiting for Glooko’s download (this can take 1–2 minutes)…');
            }
          } catch (_) {}
        }, true);

        if (URL && URL.createObjectURL) {
          const originalCreateObjectURL = URL.createObjectURL.bind(URL);
          URL.createObjectURL = function (object) {
            const url = originalCreateObjectURL(object);
            try {
              if (object instanceof Blob &&
                  (exportActive() || shouldCapture('', object.type || '', ''))) {
                bridge.onTrace('object-url-candidate');
                capture(
                  object,
                  fallbackName(object.type || '', ''),
                  'blob-reading'
                );
              }
            } catch (_) {}
            return url;
          };
        }

        const originalWindowOpen = window.open;
        if (originalWindowOpen) {
          window.open = function (url) {
            try {
              if (exportActive() && url) {
                bridge.onTrace('popup-candidate');
                captureUrl(url, 'glooko-export.zip');
              }
            } catch (_) {}
            return originalWindowOpen.apply(this, arguments);
          };
        }

        if (originalFetch) {
          window.fetch = async function (...args) {
            const response = await originalFetch.apply(this, args);
            inspectResponse(response, args[0], 'fetch-candidate');
            return response;
          };
        }

        const originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url) {
          this.__daymarkUrl = String(url || '');
          this.addEventListener('load', function () {
            try {
              const type = this.getResponseHeader('content-type') || '';
              const disposition = this.getResponseHeader('content-disposition') || '';
              const responseUrl = this.responseURL || this.__daymarkUrl || '';
              if (!responseLooksLikeFile(responseUrl, type, disposition)) {
                if (exportActive() && shouldCapture(responseUrl, type, disposition)) {
                  bridge.onTrace('intermediate-response');
                }
                return;
              }
              bridge.onTrace('xhr-candidate');
              let blob;
              if (this.response instanceof Blob) blob = this.response;
              else if (this.response instanceof ArrayBuffer) blob = new Blob([this.response], { type });
              else if (typeof this.responseText === 'string') blob = new Blob([this.responseText], { type });
              capture(blob, fileName({ get: (key) =>
                key === 'content-disposition' ? disposition : null
              }, fallbackName(type, disposition)), 'blob-reading');
            } catch (_) {}
          });
          return originalOpen.apply(this, arguments);
        };
        bridge.onTrace('hooks-installed');
      })();
    """.trimIndent()

  private fun blobCaptureScript(
    url: String,
    contentDisposition: String?,
  ): String {
    val escapedUrl = url.replace("\\", "\\\\").replace("'", "\\'")
    val fallback =
      safeFileName(
        URLUtil.guessFileName(url, contentDisposition, "application/zip"),
      ).replace("\\", "\\\\").replace("'", "\\'")
    return """
      (function () {
        fetch('$escapedUrl')
          .then((response) => response.blob())
          .then((blob) => {
            if (!blob || blob.size === 0 || blob.size > 52428800) {
              window.$BRIDGE_NAME.onStatus('The Glooko export exceeded the local safety limit.');
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              const value = String(reader.result || '');
              const comma = value.indexOf(',');
              if (comma > 0) {
                window.$BRIDGE_NAME.onTrace('blob-reading');
                window.$BRIDGE_NAME.onExportBytes(value.slice(comma + 1), '$fallback');
              }
            };
            reader.readAsDataURL(blob);
          })
          .catch(() => window.$BRIDGE_NAME.onStatus(
            'The Glooko export could not be read. Use its download control again.'
          ));
      })();
    """.trimIndent()
  }
}
