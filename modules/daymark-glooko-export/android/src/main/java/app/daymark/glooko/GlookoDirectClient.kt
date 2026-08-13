package app.daymark.glooko

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InterruptedIOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.concurrent.TimeUnit
import java.util.zip.ZipException
import java.util.zip.ZipInputStream
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.FormBody
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody

/** The consumer Glooko service region selected by the user. */
internal enum class GlookoRegion {
  EU,
  US,
}

internal data class GlookoEndpoints(
  val webBaseUrl: HttpUrl,
  val apiBaseUrl: HttpUrl,
) {
  val signInUrl: HttpUrl
    get() = webBaseUrl.resolve("/users/sign_in")!!

  val patientsUrl: HttpUrl
    get() = webBaseUrl.resolve("/patients")!!

  val exportUrl: HttpUrl
    get() = apiBaseUrl.resolve("/api/v3/users/export_csv")!!

  companion object {
    fun forRegion(region: GlookoRegion): GlookoEndpoints =
      when (region) {
        GlookoRegion.EU ->
          GlookoEndpoints(
            webBaseUrl = "https://eu.my.glooko.com/".toHttpUrl(),
            apiBaseUrl = "https://eu.api.glooko.com/".toHttpUrl(),
          )
        GlookoRegion.US ->
          GlookoEndpoints(
            webBaseUrl = "https://my.glooko.com/".toHttpUrl(),
            apiBaseUrl = "https://api.glooko.com/".toHttpUrl(),
          )
      }
  }
}

internal enum class GlookoDirectFailure {
  BAD_CREDENTIALS,
  AUTHENTICATION_CHALLENGE,
  AUTHENTICATION_PROTOCOL_CHANGED,
  REGION_MISMATCH,
  ACCOUNT_CODE_NOT_FOUND,
  ACCOUNT_SELECTION_REQUIRED,
  HTTP_ERROR,
  RATE_LIMITED,
  SERVER_ERROR,
  NETWORK,
  TIMEOUT,
  SESSION_REJECTED,
  EXPORT_NOT_AUTHORIZED,
  EXPORT_TOO_LARGE,
  INVALID_ZIP,
}

/**
 * Contains only a stable failure category and a safe, user-presentable message.
 * Response bodies, request URLs, cookies, credentials, and account codes are
 * deliberately never attached to errors.
 */
internal class GlookoDirectException(
  val failure: GlookoDirectFailure,
  message: String,
) : IOException(message)

internal data class GlookoIdentifiedExport(
  val archive: ByteArray,
  val accountFingerprint: String,
)

/**
 * Direct implementation of Glooko's consumer CSV export flow.
 *
 * The client starts with an empty in-memory cookie jar for every invocation,
 * signs in, discovers the current account's Glooko code from authenticated
 * HTML, and immediately uses it for one export. The account code is neither an
 * input nor an output, which prevents callers from hardcoding or persisting a
 * different user's identifier.
 */
internal class GlookoDirectClient(
  private val region: GlookoRegion,
  baseClient: OkHttpClient = OkHttpClient(),
  private val endpoints: GlookoEndpoints = GlookoEndpoints.forRegion(region),
  private val clock: Clock = Clock.systemUTC(),
  private val retrySleeper: (Long) -> Unit = Thread::sleep,
  private val maxDownloadBytes: Long = DEFAULT_MAX_DOWNLOAD_BYTES,
  private val maxExpandedZipBytes: Long = DEFAULT_MAX_EXPANDED_ZIP_BYTES,
  private val authTimeoutMs: Long = 30_000L,
  private val downloadTimeoutMs: Long = 120_000L,
) {
  companion object {
    private const val USER_AGENT =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36"
    private const val SESSION_COOKIE_NAME = "_logbook-web_session"
    private const val MAX_ATTEMPTS = 3
    private const val MAX_AUTH_BODY_BYTES = 2L * 1024L * 1024L
    private const val DEFAULT_MAX_DOWNLOAD_BYTES = 50L * 1024L * 1024L
    private const val DEFAULT_MAX_EXPANDED_ZIP_BYTES = 120L * 1024L * 1024L
    private const val MAX_EXPANDED_ZIP_ENTRY_BYTES = 48L * 1024L * 1024L
    private const val MAX_ZIP_ENTRIES = 1_024
    private const val MAX_REDIRECTS = 5
    private const val MAX_RETRY_DELAY_MS = 30_000L
    private const val INITIAL_RETRY_DELAY_MS = 500L
    private val UK_TIME_ZONE = ZoneId.of("Europe/London")

    private val META_TAG = Regex("<meta\\b[^>]*>", RegexOption.IGNORE_CASE)
    private val HTML_ATTRIBUTE =
      Regex(
        """([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""",
        RegexOption.IGNORE_CASE,
      )
    private val GLOOKO_CODE =
      Regex(
        """(?i)(?:["']glooko_code["']|\bglooko_code\b)\s*:\s*(["'])([A-Za-z0-9._-]{3,256})\1""",
      )
    private val DASHBOARD_HREF =
      Regex(
        """(?i)href\s*=\s*(["'])([^"']*/patients/[^"']+/dashboard(?:[^"']*)?)\1""",
      )
    private val CHALLENGE_MARKERS =
      listOf(
        "captcha",
        "recaptcha",
        "two-factor",
        "two_factor",
        "multi-factor",
        "mfa",
        "verification code",
      )

    internal fun extractCsrfToken(html: String): String? {
      META_TAG.findAll(html).forEach { tagMatch ->
        val attributes = parseHtmlAttributes(tagMatch.value)
        if (attributes["name"].equals("csrf-token", ignoreCase = true)) {
          return attributes["content"]?.let(::decodeHtmlEntities)?.takeIf(String::isNotBlank)
        }
      }
      return null
    }

    internal fun extractGlookoCodes(html: String): Set<String> =
      sequenceOf(
        html,
        html.replace("\\\"", "\"").replace("\\'", "'"),
      ).flatMap { candidate -> GLOOKO_CODE.findAll(candidate) }
        .map { match -> decodeHtmlEntities(match.groupValues[2]) }
        .filter(String::isNotBlank)
        .toSet()

    internal fun extractGlookoCode(html: String): String? =
      extractGlookoCodes(html).singleOrNull()

    private fun parseHtmlAttributes(tag: String): Map<String, String> =
      HTML_ATTRIBUTE.findAll(tag).associate { match ->
        val value =
          match.groupValues.drop(2).firstOrNull(String::isNotEmpty).orEmpty()
        match.groupValues[1].lowercase() to value
      }

    private fun decodeHtmlEntities(value: String): String =
      value
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
  }

  private val cookieJar = MemoryCookieJar()
  private val authClient =
    baseClient.newBuilder()
      .cookieJar(cookieJar)
      .followRedirects(false)
      .followSslRedirects(false)
      .connectTimeout(authTimeoutMs, TimeUnit.MILLISECONDS)
      .readTimeout(authTimeoutMs, TimeUnit.MILLISECONDS)
      .writeTimeout(authTimeoutMs, TimeUnit.MILLISECONDS)
      .callTimeout(authTimeoutMs, TimeUnit.MILLISECONDS)
      .build()
  private val downloadClient =
    baseClient.newBuilder()
      .cookieJar(CookieJar.NO_COOKIES)
      .followRedirects(false)
      .followSslRedirects(false)
      .connectTimeout(downloadTimeoutMs, TimeUnit.MILLISECONDS)
      .readTimeout(downloadTimeoutMs, TimeUnit.MILLISECONDS)
      .writeTimeout(downloadTimeoutMs, TimeUnit.MILLISECONDS)
      .callTimeout(downloadTimeoutMs, TimeUnit.MILLISECONDS)
      .build()

  init {
    require(maxDownloadBytes in 1..Int.MAX_VALUE.toLong())
    require(maxExpandedZipBytes >= maxDownloadBytes)
    require(authTimeoutMs > 0L)
    require(downloadTimeoutMs > 0L)
  }

  @Synchronized
  fun downloadExport(
    email: String,
    password: String,
    startDate: LocalDate,
    endDate: LocalDate,
  ): ByteArray {
    require(email.isNotBlank()) { "A Glooko email address is required." }
    require(password.isNotBlank()) { "A Glooko password is required." }
    require(!endDate.isBefore(startDate)) { "The export end date cannot precede its start date." }

    cookieJar.clear()
    val sessionCookie = authenticate(email, password)
    val accountCode = discoverAccountCode()
    return downloadArchive(sessionCookie, accountCode, startDate, endDate)
  }

  /**
   * Downloads an export while converting the authenticated account code to an
   * opaque identity inside native code. Only the derived value is returned.
   */
  @Synchronized
  fun downloadIdentifiedExport(
    credentials: GlookoCredentials,
    startDate: LocalDate,
    endDate: LocalDate,
    fingerprintAccount: (String) -> String,
  ): GlookoIdentifiedExport {
    if (credentials.region != region) {
      throw GlookoDirectException(
        GlookoDirectFailure.REGION_MISMATCH,
        "The saved Glooko region does not match this connection.",
      )
    }
    require(!endDate.isBefore(startDate)) {
      "The export end date cannot precede its start date."
    }

    cookieJar.clear()
    val sessionCookie = authenticate(credentials.email, credentials.password)
    val accountCode = discoverAccountCode()
    val accountFingerprint = fingerprintAccount(accountCode)
    require(accountFingerprint.isNotBlank()) {
      "The Glooko account identity could not be protected."
    }
    return GlookoIdentifiedExport(
      archive = downloadArchive(sessionCookie, accountCode, startDate, endDate),
      accountFingerprint = accountFingerprint,
    )
  }

  fun downloadExport(
    credentials: GlookoCredentials,
    startDate: LocalDate,
    endDate: LocalDate,
  ): ByteArray =
    if (credentials.region != region) {
      throw GlookoDirectException(
        GlookoDirectFailure.REGION_MISMATCH,
        "The saved Glooko region does not match this connection.",
      )
    } else {
      downloadExport(
        email = credentials.email,
        password = credentials.password,
        startDate = startDate,
        endDate = endDate,
      )
    }

  private fun authenticate(
    email: String,
    password: String,
  ): Cookie {
    val csrfHtml =
      executeWithRetry(
        authClient,
        Request.Builder()
          .url(endpoints.signInUrl)
          .header("User-Agent", USER_AGENT)
          .header("Accept", "text/html,application/xhtml+xml")
          .get()
          .build(),
      ) { response ->
        if (response.code != HttpURLConnection.HTTP_OK) {
          throw responseFailure(response, "Glooko sign-in is unavailable.")
        }
        readTextBody(response, MAX_AUTH_BODY_BYTES)
      }

    val csrf =
      extractCsrfToken(csrfHtml)
        ?: throw GlookoDirectException(
          GlookoDirectFailure.AUTHENTICATION_PROTOCOL_CHANGED,
          "Glooko changed how sign-in works. Automatic updates are temporarily unavailable.",
        )
    val form =
      FormBody.Builder()
        .add("authenticity_token", csrf)
        .add("user[email]", email)
        .add("user[password]", password)
        .build()
    executeWithRetry(
      authClient,
      Request.Builder()
        .url(endpoints.signInUrl)
        .header("User-Agent", USER_AGENT)
        .header("Accept", "text/html,application/xhtml+xml")
        .post(form)
        .build(),
    ) { response ->
      when (response.code) {
        HttpURLConnection.HTTP_MOVED_TEMP -> {
          val redirect = response.header("Location")?.let(response.request.url::resolve)
          if (redirect != null && isOtherGlookoRegion(redirect)) throw regionMismatch()
          if (redirect != null && looksLikeChallenge(redirect.encodedPath)) {
            throw authenticationChallenge()
          }
        }
        HttpURLConnection.HTTP_OK -> {
          val html = readTextBody(response, MAX_AUTH_BODY_BYTES)
          if (looksLikeChallenge(html)) throw authenticationChallenge()
          throw GlookoDirectException(
            GlookoDirectFailure.BAD_CREDENTIALS,
            "Glooko did not accept the saved email address and password.",
          )
        }
        HttpURLConnection.HTTP_UNAUTHORIZED,
        HttpURLConnection.HTTP_FORBIDDEN,
        ->
          throw authenticationChallenge()
        else -> throw responseFailure(response, "Glooko sign-in could not be completed.")
      }
    }

    return cookieJar.sessionCookie(endpoints.signInUrl)
      ?: throw GlookoDirectException(
        GlookoDirectFailure.AUTHENTICATION_PROTOCOL_CHANGED,
        "Glooko changed how sign-in works. Automatic updates are temporarily unavailable.",
      )
  }

  private fun discoverAccountCode(): String {
    val firstPage = fetchAuthenticatedPage(endpoints.patientsUrl)
    val dashboardUrls =
      DASHBOARD_HREF.findAll(firstPage.html)
        .mapNotNull { match ->
          decodeHtmlEntities(match.groupValues[2])
            .let(firstPage.url::resolve)
            ?.takeIf(::isAllowedWebUrl)
        }
        .toSet()
    if (dashboardUrls.size > 1) throw accountSelectionRequired()

    val firstPageCodes = extractGlookoCodes(firstPage.html)
    if (firstPageCodes.size > 1) throw accountSelectionRequired()
    firstPageCodes.singleOrNull()?.let { return it }

    dashboardUrls.singleOrNull()?.let { dashboardUrl ->
      val dashboardCodes =
        extractGlookoCodes(fetchAuthenticatedPage(dashboardUrl).html)
      if (dashboardCodes.size > 1) throw accountSelectionRequired()
      dashboardCodes.singleOrNull()?.let { return it }
    }

    throw GlookoDirectException(
      GlookoDirectFailure.ACCOUNT_CODE_NOT_FOUND,
      "Glooko changed how account details are provided. Automatic updates are temporarily unavailable.",
    )
  }

  private fun fetchAuthenticatedPage(initialUrl: HttpUrl): AuthenticatedPage {
    var nextUrl = initialUrl
    repeat(MAX_REDIRECTS + 1) { redirectCount ->
      val page =
        executeWithRetry(
          authClient,
          Request.Builder()
            .url(nextUrl)
            .header("User-Agent", USER_AGENT)
            .header("Accept", "text/html,application/xhtml+xml")
            .get()
            .build(),
        ) { response ->
        when (response.code) {
          HttpURLConnection.HTTP_OK -> {
            if (response.request.url.encodedPath == endpoints.signInUrl.encodedPath) {
              throw sessionRejected()
            }
            AuthenticatedPage(
              response.request.url,
              readTextBody(response, MAX_AUTH_BODY_BYTES),
            )
          }
          HttpURLConnection.HTTP_MOVED_PERM,
          HttpURLConnection.HTTP_MOVED_TEMP,
          HttpURLConnection.HTTP_SEE_OTHER,
          307,
          308,
          -> {
            if (redirectCount == MAX_REDIRECTS) {
              throw GlookoDirectException(
                GlookoDirectFailure.AUTHENTICATION_PROTOCOL_CHANGED,
                "Glooko returned too many sign-in redirects.",
              )
            }
            val location = response.header("Location")
            nextUrl =
              location?.let(response.request.url::resolve)?.also { redirect ->
                if (isOtherGlookoRegion(redirect)) throw regionMismatch()
              }?.takeIf(::isAllowedWebUrl)
                ?: throw GlookoDirectException(
                  GlookoDirectFailure.AUTHENTICATION_PROTOCOL_CHANGED,
                  "Glooko returned an invalid sign-in redirect.",
                )
            if (looksLikeChallenge(nextUrl.encodedPath)) throw authenticationChallenge()
            if (nextUrl.encodedPath == endpoints.signInUrl.encodedPath) {
              throw sessionRejected()
            }
            null
          }
          HttpURLConnection.HTTP_UNAUTHORIZED,
          HttpURLConnection.HTTP_FORBIDDEN,
          -> throw sessionRejected()
          else ->
            throw responseFailure(response, "Glooko account details are unavailable right now.")
        }
      }
      if (page != null) return page
    }
    throw GlookoDirectException(
      GlookoDirectFailure.AUTHENTICATION_PROTOCOL_CHANGED,
      "Glooko returned too many sign-in redirects.",
    )
  }

  private fun downloadArchive(
    sessionCookie: Cookie,
    accountCode: String,
    startDate: LocalDate,
    endDate: LocalDate,
  ): ByteArray {
    val startInstant =
      startDate.atStartOfDay(UK_TIME_ZONE).toInstant()
    val endInstant =
      endDate
        .plusDays(1)
        .atStartOfDay(UK_TIME_ZONE)
        .toInstant()
        .minusSeconds(1)
    val exportUrl =
      endpoints.exportUrl.newBuilder()
        .addQueryParameter(
          "startDate",
          DateTimeFormatter.ISO_INSTANT.format(startInstant),
        )
        .addQueryParameter(
          "endDate",
          DateTimeFormatter.ISO_INSTANT.format(endInstant),
        )
        .addQueryParameter("glookoCode", accountCode)
        .build()
    val request =
      Request.Builder()
        .url(exportUrl)
        .header("User-Agent", USER_AGENT)
        .header("Accept", "application/zip, application/json")
        .header("Cookie", "$SESSION_COOKIE_NAME=${sessionCookie.value}")
        .get()
        .build()

    return executeWithRetry(
      downloadClient,
      request,
      retryableConsumeFailures = setOf(GlookoDirectFailure.INVALID_ZIP),
    ) { response ->
        when (response.code) {
          HttpURLConnection.HTTP_OK -> {
            val archive = readBody(response.body, maxDownloadBytes)
            validateZip(archive)
            archive
          }
          HttpURLConnection.HTTP_UNAUTHORIZED,
          HttpURLConnection.HTTP_FORBIDDEN,
          -> throw exportNotAuthorized()
          else -> throw responseFailure(response, "Glooko did not allow this update.")
        }
      }
  }

  private fun <T> executeWithRetry(
    client: OkHttpClient,
    request: Request,
    retryableConsumeFailures: Set<GlookoDirectFailure> = emptySet(),
    consume: (Response) -> T,
  ): T {
    var lastIoFailure = GlookoDirectFailure.NETWORK
    var lastConsumeFailure: GlookoDirectException? = null
    for (attempt in 1..MAX_ATTEMPTS) {
      var retryDelayMs: Long? = null
      try {
        client.newCall(request).execute().use { response ->
          if (response.isTransientFailure() && attempt < MAX_ATTEMPTS) {
            retryDelayMs = retryDelayMs(response, attempt)
          } else {
            return consume(response)
          }
        }
      } catch (_: SocketTimeoutException) {
        lastConsumeFailure = null
        lastIoFailure = GlookoDirectFailure.TIMEOUT
      } catch (_: InterruptedIOException) {
        if (Thread.currentThread().isInterrupted) {
          Thread.currentThread().interrupt()
          throw GlookoDirectException(
            GlookoDirectFailure.NETWORK,
            "The Glooko update was interrupted. Try again.",
          )
        }
        lastConsumeFailure = null
        lastIoFailure = GlookoDirectFailure.TIMEOUT
      } catch (known: GlookoDirectException) {
        if (known.failure !in retryableConsumeFailures) throw known
        lastConsumeFailure = known
      } catch (_: IOException) {
        lastConsumeFailure = null
        lastIoFailure = GlookoDirectFailure.NETWORK
      }
      if (attempt == MAX_ATTEMPTS) {
        lastConsumeFailure?.let { throw it }
        throw exhaustedIoFailure(lastIoFailure)
      }
      sleepBeforeRetry(retryDelayMs ?: exponentialDelayMs(attempt))
    }
    throw exhaustedIoFailure(lastIoFailure)
  }

  private fun exhaustedIoFailure(failure: GlookoDirectFailure) =
    GlookoDirectException(
      failure,
      if (failure == GlookoDirectFailure.TIMEOUT) {
        "Glooko took too long to respond. T1 Arc will try again later."
      } else {
        "Glooko could not be reached. T1 Arc will try again later."
      },
    )

  private fun sleepBeforeRetry(delayMs: Long) {
    try {
      retrySleeper(delayMs)
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
      throw GlookoDirectException(
        GlookoDirectFailure.NETWORK,
        "The Glooko update was interrupted. Try again.",
      )
    }
  }

  private fun retryDelayMs(
    response: Response,
    attempt: Int,
  ): Long {
    if (response.code != 429) return exponentialDelayMs(attempt)
    val retryAfter = response.header("Retry-After") ?: return exponentialDelayMs(attempt)
    val seconds = retryAfter.trim().toLongOrNull()
    if (seconds != null) {
      return seconds.coerceAtLeast(0L)
        .coerceAtMost(MAX_RETRY_DELAY_MS / 1_000L) * 1_000L
    }
    val retryAt =
      try {
        ZonedDateTime.parse(retryAfter, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant()
      } catch (_: DateTimeParseException) {
        return exponentialDelayMs(attempt)
      }
    return (retryAt.toEpochMilli() - clock.millis()).coerceIn(0L, MAX_RETRY_DELAY_MS)
  }

  private fun exponentialDelayMs(attempt: Int): Long =
    (INITIAL_RETRY_DELAY_MS * (1L shl (attempt - 1))).coerceAtMost(MAX_RETRY_DELAY_MS)

  private fun Response.isTransientFailure(): Boolean = code == 429 || code in 500..599

  private fun responseFailure(
    response: Response,
    message: String,
  ): GlookoDirectException =
    GlookoDirectException(
      when {
        response.code == 429 -> GlookoDirectFailure.RATE_LIMITED
        response.code in 500..599 -> GlookoDirectFailure.SERVER_ERROR
        response.isRedirect && response.header("Location")
          ?.let(response.request.url::resolve)
          ?.let(::isOtherGlookoRegion) == true -> GlookoDirectFailure.REGION_MISMATCH
        else -> GlookoDirectFailure.HTTP_ERROR
      },
      message,
    )

  private fun authenticationChallenge() =
    GlookoDirectException(
      GlookoDirectFailure.AUTHENTICATION_CHALLENGE,
      "Glooko requires an additional sign-in step.",
    )

  private fun regionMismatch() =
    GlookoDirectException(
      GlookoDirectFailure.REGION_MISMATCH,
      "This Glooko account is not in the supported region.",
    )

  private fun sessionRejected() =
    GlookoDirectException(
      GlookoDirectFailure.SESSION_REJECTED,
      "Glooko could not keep you signed in. Try again.",
    )

  private fun exportNotAuthorized() =
    GlookoDirectException(
      GlookoDirectFailure.EXPORT_NOT_AUTHORIZED,
      "Glooko did not allow this account to update automatically.",
    )

  private fun accountSelectionRequired() =
    GlookoDirectException(
      GlookoDirectFailure.ACCOUNT_SELECTION_REQUIRED,
      "Automatic updates support one patient per sign-in. Download your data from Glooko and choose the file in T1 Arc.",
    )

  private fun isAllowedWebUrl(url: HttpUrl): Boolean =
    url.scheme == endpoints.webBaseUrl.scheme &&
      url.host == endpoints.webBaseUrl.host &&
      url.port == endpoints.webBaseUrl.port

  private fun isOtherGlookoRegion(url: HttpUrl): Boolean {
    val selectedWebHost = GlookoEndpoints.forRegion(region).webBaseUrl.host
    val selectedApiHost = GlookoEndpoints.forRegion(region).apiBaseUrl.host
    val knownGlookoHosts =
      GlookoRegion.values().flatMap { candidate ->
        val candidateEndpoints = GlookoEndpoints.forRegion(candidate)
        listOf(candidateEndpoints.webBaseUrl.host, candidateEndpoints.apiBaseUrl.host)
      }
    return url.host in knownGlookoHosts &&
      url.host != selectedWebHost &&
      url.host != selectedApiHost
  }

  private fun looksLikeChallenge(value: String): Boolean {
    val normalised = value.lowercase()
    return CHALLENGE_MARKERS.any(normalised::contains)
  }

  private fun readTextBody(
    response: Response,
    maximumBytes: Long,
  ): String {
    val bytes = readBody(response.body, maximumBytes)
    val charset = response.body?.contentType()?.charset(Charsets.UTF_8) ?: Charsets.UTF_8
    return bytes.toString(charset)
  }

  private fun readBody(
    body: ResponseBody?,
    maximumBytes: Long,
  ): ByteArray {
    if (body == null) {
      throw GlookoDirectException(
        GlookoDirectFailure.HTTP_ERROR,
        "Glooko returned an empty response.",
      )
    }
    val declaredLength = body.contentLength()
    if (declaredLength > maximumBytes) {
      throw GlookoDirectException(
        GlookoDirectFailure.EXPORT_TOO_LARGE,
        "Glooko returned too much data at once. Try a shorter date range.",
      )
    }
    val initialCapacity =
      when {
        declaredLength in 1..Int.MAX_VALUE.toLong() -> declaredLength.toInt()
        else -> 8 * 1024
      }
    val output = ByteArrayOutputStream(initialCapacity)
    val buffer = ByteArray(8 * 1024)
    var total = 0L
    body.byteStream().use { input ->
      while (true) {
        val read = input.read(buffer)
        if (read == -1) break
        total += read
        if (total > maximumBytes) {
          throw GlookoDirectException(
            GlookoDirectFailure.EXPORT_TOO_LARGE,
            "Glooko returned too much data at once. Try a shorter date range.",
          )
        }
        output.write(buffer, 0, read)
      }
    }
    return output.toByteArray()
  }

  private fun validateZip(archive: ByteArray) {
    if (
      archive.size < 4 ||
      archive[0] != 0x50.toByte() ||
      archive[1] != 0x4b.toByte() ||
      archive[2] != 0x03.toByte() ||
      archive[3] != 0x04.toByte()
    ) {
      throw invalidZip()
    }
    if (!hasValidEndOfCentralDirectory(archive)) throw invalidZip()

    var entries = 0
    var files = 0
    var expandedBytes = 0L
    try {
      ZipInputStream(ByteArrayInputStream(archive)).use { zip ->
        while (true) {
          val entry = zip.nextEntry ?: break
          entries += 1
          if (entries > MAX_ZIP_ENTRIES) throw invalidZip()
          if (!entry.isDirectory) {
            files += 1
            val buffer = ByteArray(8 * 1024)
            var entryExpandedBytes = 0L
            while (true) {
              val read = zip.read(buffer)
              if (read == -1) break
              expandedBytes += read
              entryExpandedBytes += read
              if (
                expandedBytes > maxExpandedZipBytes ||
                entryExpandedBytes > MAX_EXPANDED_ZIP_ENTRY_BYTES
              ) {
                throw invalidZip()
              }
            }
          }
          zip.closeEntry()
        }
      }
    } catch (known: GlookoDirectException) {
      throw known
    } catch (_: ZipException) {
      throw invalidZip()
    } catch (_: IOException) {
      throw invalidZip()
    }
    if (files == 0) throw invalidZip()
  }

  /** Rejects truncated archives that ZipInputStream alone may otherwise accept. */
  private fun hasValidEndOfCentralDirectory(archive: ByteArray): Boolean {
    val minimumOffset = (archive.size - (65_535 + 22)).coerceAtLeast(0)
    for (offset in archive.size - 22 downTo minimumOffset) {
      if (
        archive[offset] == 0x50.toByte() &&
        archive[offset + 1] == 0x4b.toByte() &&
        archive[offset + 2] == 0x05.toByte() &&
        archive[offset + 3] == 0x06.toByte()
      ) {
        val commentLength = unsignedShort(archive, offset + 20)
        if (offset + 22 + commentLength != archive.size) continue
        val entries = unsignedShort(archive, offset + 10)
        val centralSize = unsignedInt(archive, offset + 12)
        val centralOffset = unsignedInt(archive, offset + 16)
        return entries > 0 &&
          centralOffset <= offset.toLong() &&
          centralSize <= offset.toLong() - centralOffset
      }
    }
    return false
  }

  private fun unsignedShort(
    bytes: ByteArray,
    offset: Int,
  ): Int =
    (bytes[offset].toInt() and 0xff) or
      ((bytes[offset + 1].toInt() and 0xff) shl 8)

  private fun unsignedInt(
    bytes: ByteArray,
    offset: Int,
  ): Long =
    (bytes[offset].toLong() and 0xffL) or
      ((bytes[offset + 1].toLong() and 0xffL) shl 8) or
      ((bytes[offset + 2].toLong() and 0xffL) shl 16) or
      ((bytes[offset + 3].toLong() and 0xffL) shl 24)

  private fun invalidZip() =
    GlookoDirectException(
      GlookoDirectFailure.INVALID_ZIP,
      "Glooko returned an incomplete download. Try again.",
    )

  private data class AuthenticatedPage(
    val url: HttpUrl,
    val html: String,
  )
}

private class MemoryCookieJar : CookieJar {
  private val cookies = mutableListOf<Cookie>()

  @Synchronized
  override fun saveFromResponse(
    url: HttpUrl,
    cookies: List<Cookie>,
  ) {
    val now = System.currentTimeMillis()
    this.cookies.removeAll { existing ->
      existing.expiresAt < now || cookies.any { replacement -> replacement.sameIdentity(existing) }
    }
    this.cookies += cookies.filter { it.expiresAt >= now }
  }

  @Synchronized
  override fun loadForRequest(url: HttpUrl): List<Cookie> {
    val now = System.currentTimeMillis()
    cookies.removeAll { it.expiresAt < now }
    return cookies.filter { it.matches(url) }
  }

  @Synchronized
  fun sessionCookie(url: HttpUrl): Cookie? =
    loadForRequest(url).firstOrNull {
      it.name == "_logbook-web_session" && it.value.isNotBlank()
    }

  @Synchronized
  fun clear() {
    cookies.clear()
  }

  private fun Cookie.sameIdentity(other: Cookie): Boolean =
    name == other.name && domain == other.domain && path == other.path
}
