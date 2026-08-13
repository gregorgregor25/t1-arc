package app.daymark.glooko

import java.io.ByteArrayOutputStream
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.concurrent.TimeUnit
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class GlookoDirectClientTest {
  private lateinit var server: MockWebServer
  private val sleeps = mutableListOf<Long>()

  @Before
  fun startServer() {
    server = MockWebServer()
    server.start()
  }

  @After
  fun stopServer() {
    server.shutdown()
  }

  @Test
  fun completesRailsLoginDiscoversAccountCodeAndDownloadsValidatedZip() {
    val zip = validZip()
    enqueueSuccessfulLogin("""window.analyticsUser = {"glooko_code":"eu-west-1-demo-user-1234"};""")
    server.enqueue(
      MockResponse()
        .setResponseCode(200)
        .setHeader("Content-Type", "application/zip")
        .setBody(okio.Buffer().write(zip)),
    )

    val result =
      client().downloadExport(
        email = "person@example.com",
        password = "not-logged",
        startDate = LocalDate.parse("2026-08-09"),
        endDate = LocalDate.parse("2026-08-10"),
      )

    assertArrayEquals(zip, result)
    val loginPage = server.takeRequest(1, TimeUnit.SECONDS)!!
    val login = server.takeRequest(1, TimeUnit.SECONDS)!!
    val patients = server.takeRequest(1, TimeUnit.SECONDS)!!
    val export = server.takeRequest(1, TimeUnit.SECONDS)!!
    assertEquals("GET", loginPage.method)
    assertEquals("/users/sign_in", loginPage.path)
    assertEquals("POST", login.method)
    assertEquals("/users/sign_in", login.path)
    assertTrue(login.body.readUtf8().contains("authenticity_token=csrf-token-value"))
    assertEquals("/patients", patients.path)
    assertEquals("2026-08-08T23:00:00Z", export.requestUrl!!.queryParameter("startDate"))
    assertEquals("2026-08-10T22:59:59Z", export.requestUrl!!.queryParameter("endDate"))
    assertEquals(
      "eu-west-1-demo-user-1234",
      export.requestUrl!!.queryParameter("glookoCode"),
    )
    assertEquals("_logbook-web_session=session-value", export.getHeader("Cookie"))
  }

  @Test
  fun identifiedExportReturnsOnlyTheProtectedAccountIdentity() {
    val zip = validZip()
    val rawCode = "eu-west-1-private-user-2468"
    val protectedIdentity = "af1_${"c".repeat(64)}"
    enqueueSuccessfulLogin("""{"glooko_code":"$rawCode"}""")
    server.enqueue(
      MockResponse()
        .setResponseCode(200)
        .setBody(okio.Buffer().write(zip)),
    )
    var fingerprintedCode: String? = null

    val result =
      client().downloadIdentifiedExport(
        credentials =
          GlookoCredentials(
            email = "person@example.com",
            password = "not-logged",
            credentialGeneration = 7,
          ),
        startDate = LocalDate.parse("2026-08-10"),
        endDate = LocalDate.parse("2026-08-10"),
        fingerprintAccount = { accountCode ->
          fingerprintedCode = accountCode
          protectedIdentity
        },
      )

    assertArrayEquals(zip, result.archive)
    assertEquals(rawCode, fingerprintedCode)
    assertEquals(protectedIdentity, result.accountFingerprint)
    assertFalse(result.accountFingerprint.contains(rawCode))
  }

  @Test
  fun winterRequestCoversTheFullLondonCalendarDay() {
    assertExportRequestWindow(
      localDate = "2026-01-15",
      expectedStart = "2026-01-15T00:00:00Z",
      expectedEnd = "2026-01-15T23:59:59Z",
    )
  }

  @Test
  fun bstRequestCoversTheFullLondonCalendarDay() {
    assertExportRequestWindow(
      localDate = "2026-07-15",
      expectedStart = "2026-07-14T23:00:00Z",
      expectedEnd = "2026-07-15T22:59:59Z",
    )
  }

  @Test
  fun springClockChangeRequestCoversTheTwentyThreeHourLondonDay() {
    assertExportRequestWindow(
      localDate = "2026-03-29",
      expectedStart = "2026-03-29T00:00:00Z",
      expectedEnd = "2026-03-29T22:59:59Z",
    )
  }

  @Test
  fun autumnClockChangeRequestCoversTheTwentyFiveHourLondonDay() {
    assertExportRequestWindow(
      localDate = "2026-10-25",
      expectedStart = "2026-10-24T23:00:00Z",
      expectedEnd = "2026-10-25T23:59:59Z",
    )
  }

  @Test
  fun discoversEachAccountsCodeAgainInsteadOfCachingThePreviousUser() {
    val zip = validZip()
    val direct = client()
    enqueueSuccessfulLogin(
      """{"glooko_code":"eu-demo-account-one"}""",
      sessionValue = "session-one",
    )
    server.enqueue(MockResponse().setResponseCode(200).setBody(okio.Buffer().write(zip)))
    direct.downloadExport(
      "first@example.com",
      "first-password",
      LocalDate.parse("2026-08-10"),
      LocalDate.parse("2026-08-10"),
    )

    enqueueSuccessfulLogin(
      """{"glooko_code":"eu-demo-account-two"}""",
      sessionValue = "session-two",
    )
    server.enqueue(MockResponse().setResponseCode(200).setBody(okio.Buffer().write(zip)))
    direct.downloadExport(
      "second@example.com",
      "second-password",
      LocalDate.parse("2026-08-10"),
      LocalDate.parse("2026-08-10"),
    )

    val requests = (1..8).map { server.takeRequest(1, TimeUnit.SECONDS)!! }
    assertEquals(
      "eu-demo-account-one",
      requests[3].requestUrl!!.queryParameter("glookoCode"),
    )
    assertEquals("_logbook-web_session=session-one", requests[3].getHeader("Cookie"))
    assertTrue(requests[4].getHeader("Cookie").orEmpty().contains("session-one").not())
    assertEquals(
      "eu-demo-account-two",
      requests[7].requestUrl!!.queryParameter("glookoCode"),
    )
    assertEquals("_logbook-web_session=session-two", requests[7].getHeader("Cookie"))
  }

  @Test
  fun csrfParserHandlesAttributeOrderCaseAndSingleQuotes() {
    val html =
      """
      <html><head>
        <META content='token&amp;value' data-extra='1' NAME='csrf-token'>
      </head></html>
      """.trimIndent()

    assertEquals("token&value", GlookoDirectClient.extractCsrfToken(html))
  }

  @Test
  fun accountCodeParserHandlesJsonJavascriptAndEscapedJsonKeys() {
    val examples =
      listOf(
        """{"glooko_code":"eu-west-1-blue-user-1"}""",
        """{'glooko_code': 'eu-west-1-blue-user-2'}""",
        """{glooko_code: "eu-west-1-blue-user-3"}""",
        """{\"glooko_code\":\"eu-west-1-blue-user-4\"}""",
      )

    examples.forEachIndexed { index, html ->
      assertEquals(
        "eu-west-1-blue-user-${index + 1}",
        GlookoDirectClient.extractGlookoCode(html),
      )
    }
  }

  @Test
  fun followsSameHostDashboardLinkWhenPatientsPageHasNoAccountCode() {
    enqueueLoginResponses()
    server.enqueue(
      MockResponse()
        .setResponseCode(200)
        .setBody("""<a href="/patients/abc/dashboard">Dashboard</a>"""),
    )
    server.enqueue(
      MockResponse()
        .setResponseCode(200)
        .setBody("""<script>glooko_code: "us-demo-456"</script>"""),
    )
    server.enqueue(MockResponse().setResponseCode(200).setBody(okio.Buffer().write(validZip())))

    client().downloadExport(
      "person@example.com",
      "password",
      LocalDate.parse("2026-08-10"),
      LocalDate.parse("2026-08-10"),
    )

    repeat(3) { server.takeRequest(1, TimeUnit.SECONDS) }
    assertEquals("/patients/abc/dashboard", server.takeRequest(1, TimeUnit.SECONDS)!!.path)
  }

  @Test
  fun wrongCredentialsAreNotRetried() {
    server.enqueue(loginPageResponse())
    server.enqueue(
      MockResponse()
        .setResponseCode(200)
        .setBody("<html>Incorrect email or password</html>"),
    )

    val error = captureFailure { performOneDayExport() }

    assertEquals(GlookoDirectFailure.BAD_CREDENTIALS, error.failure)
    assertEquals(2, server.requestCount)
    assertTrue(sleeps.isEmpty())
  }

  @Test
  fun captchaPageHasASeparateMachineReason() {
    server.enqueue(loginPageResponse())
    server.enqueue(
      MockResponse()
        .setResponseCode(200)
        .setBody("<html><div class='g-recaptcha'>Complete CAPTCHA</div></html>"),
    )

    val error = captureFailure { performOneDayExport() }

    assertEquals(GlookoDirectFailure.AUTHENTICATION_CHALLENGE, error.failure)
    assertEquals(2, server.requestCount)
  }

  @Test
  fun redirectToAnotherKnownGlookoHostIsARegionMismatch() {
    server.enqueue(loginPageResponse())
    server.enqueue(
      MockResponse()
        .setResponseCode(302)
        .setHeader("Location", "https://my.glooko.com/patients"),
    )

    val error = captureFailure { performOneDayExport() }

    assertEquals(GlookoDirectFailure.REGION_MISMATCH, error.failure)
  }

  @Test
  fun missingAuthenticatedAccountCodeIsExplicit() {
    enqueueSuccessfulLogin("<html><body>Patients</body></html>")

    val error = captureFailure { performOneDayExport() }

    assertEquals(GlookoDirectFailure.ACCOUNT_CODE_NOT_FOUND, error.failure)
  }

  @Test
  fun multiplePatientDashboardsRequireExplicitSelection() {
    enqueueSuccessfulLogin(
      """
      <a href="/patients/one/dashboard">First patient</a>
      <a href="/patients/two/dashboard">Second patient</a>
      """.trimIndent(),
    )

    val error = captureFailure { performOneDayExport() }

    assertEquals(GlookoDirectFailure.ACCOUNT_SELECTION_REQUIRED, error.failure)
    assertEquals(3, server.requestCount)
  }

  @Test
  fun retriesServerAndRateLimitResponsesThenSucceeds() {
    val zip = validZip()
    enqueueSuccessfulLogin("""{"glooko_code":"eu-demo-789"}""")
    server.enqueue(MockResponse().setResponseCode(503))
    server.enqueue(MockResponse().setResponseCode(429).setHeader("Retry-After", "2"))
    server.enqueue(MockResponse().setResponseCode(200).setBody(okio.Buffer().write(zip)))

    val result = performOneDayExport()

    assertArrayEquals(zip, result)
    assertEquals(listOf(500L, 2_000L), sleeps)
    assertEquals(6, server.requestCount)
  }

  @Test
  fun retriesAnInterruptedDownloadBodyFromTheBeginning() {
    val zip = validZip()
    enqueueSuccessfulLogin("""{"glooko_code":"eu-demo-789"}""")
    server.enqueue(
      MockResponse()
        .setResponseCode(200)
        .setBody(okio.Buffer().write(zip))
        .setSocketPolicy(SocketPolicy.DISCONNECT_DURING_RESPONSE_BODY),
    )
    server.enqueue(MockResponse().setResponseCode(200).setBody(okio.Buffer().write(zip)))

    val result = performOneDayExport()

    assertArrayEquals(zip, result)
    assertEquals(listOf(500L), sleeps)
    assertEquals(5, server.requestCount)
  }

  @Test
  fun finalRateLimitResponseHasDedicatedFailure() {
    enqueueSuccessfulLogin("""{"glooko_code":"eu-demo-789"}""")
    repeat(3) {
      server.enqueue(MockResponse().setResponseCode(429).setHeader("Retry-After", "999"))
    }

    val error = captureFailure { performOneDayExport() }

    assertEquals(GlookoDirectFailure.RATE_LIMITED, error.failure)
    assertEquals(listOf(30_000L, 30_000L), sleeps)
  }

  @Test
  fun htmlWithHttp200CannotPassAsAZip() {
    enqueueSuccessfulLogin("""{"glooko_code":"eu-demo-789"}""")
    repeat(3) {
      server.enqueue(
        MockResponse()
          .setResponseCode(200)
          .setHeader("Content-Type", "text/html")
          .setBody("<html>Sign in again</html>"),
      )
    }

    val error = captureFailure { performOneDayExport() }

    assertEquals(GlookoDirectFailure.INVALID_ZIP, error.failure)
    assertEquals(listOf(500L, 1_000L), sleeps)
  }

  @Test
  fun truncatedZipCannotPassStructuralValidation() {
    enqueueSuccessfulLogin("""{"glooko_code":"eu-demo-789"}""")
    val valid = validZip()
    val truncated = valid.copyOf(valid.size - 10)
    repeat(3) {
      server.enqueue(MockResponse().setResponseCode(200).setBody(okio.Buffer().write(truncated)))
    }

    val error = captureFailure { performOneDayExport() }

    assertEquals(GlookoDirectFailure.INVALID_ZIP, error.failure)
    assertEquals(listOf(500L, 1_000L), sleeps)
  }

  @Test
  fun corruptArchiveIsDownloadedAgainBeforeSuccess() {
    val zip = validZip()
    enqueueSuccessfulLogin("""{"glooko_code":"eu-demo-789"}""")
    server.enqueue(MockResponse().setResponseCode(200).setBody("not a zip"))
    server.enqueue(MockResponse().setResponseCode(200).setBody(okio.Buffer().write(zip)))

    val result = performOneDayExport()

    assertArrayEquals(zip, result)
    assertEquals(listOf(500L), sleeps)
  }

  @Test
  fun exportAuthorizationFailureDoesNotBlameSavedCredentials() {
    enqueueSuccessfulLogin("""{"glooko_code":"eu-demo-789"}""")
    server.enqueue(MockResponse().setResponseCode(403))

    val error = captureFailure { performOneDayExport() }

    assertEquals(GlookoDirectFailure.EXPORT_NOT_AUTHORIZED, error.failure)
  }

  @Test
  fun declaredOversizeExportIsRejectedBeforeAllocation() {
    enqueueSuccessfulLogin("""{"glooko_code":"eu-demo-789"}""")
    server.enqueue(MockResponse().setResponseCode(200).setBody("more than ten bytes"))

    val error = captureFailure { performOneDayExport(client(maxDownloadBytes = 10L)) }

    assertEquals(GlookoDirectFailure.EXPORT_TOO_LARGE, error.failure)
  }

  @Test
  fun exhaustedSocketTimeoutsHaveDedicatedFailure() {
    repeat(3) {
      server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
    }
    val shortTimeoutClient =
      OkHttpClient.Builder()
        .readTimeout(50L, TimeUnit.MILLISECONDS)
        .build()

    val error =
      captureFailure {
        performOneDayExport(
          client(
            baseClient = shortTimeoutClient,
            authTimeoutMs = 50L,
          ),
        )
      }

    assertEquals(GlookoDirectFailure.TIMEOUT, error.failure)
    assertEquals(3, server.requestCount)
  }

  @Test
  fun publicRegionValuesMapToCorrectConsumerHosts() {
    assertEquals("eu.my.glooko.com", GlookoEndpoints.forRegion(GlookoRegion.EU).webBaseUrl.host)
    assertEquals("eu.api.glooko.com", GlookoEndpoints.forRegion(GlookoRegion.EU).apiBaseUrl.host)
    assertEquals("my.glooko.com", GlookoEndpoints.forRegion(GlookoRegion.US).webBaseUrl.host)
    assertEquals("api.glooko.com", GlookoEndpoints.forRegion(GlookoRegion.US).apiBaseUrl.host)
  }

  private fun enqueueSuccessfulLogin(
    authenticatedHtml: String,
    sessionValue: String = "session-value",
  ) {
    enqueueLoginResponses(sessionValue)
    server.enqueue(MockResponse().setResponseCode(200).setBody(authenticatedHtml))
  }

  private fun enqueueLoginResponses(sessionValue: String = "session-value") {
    server.enqueue(loginPageResponse())
    server.enqueue(
      MockResponse()
        .setResponseCode(302)
        .setHeader("Location", "/patients")
        .setHeader(
          "Set-Cookie",
          "_logbook-web_session=$sessionValue; Path=/; HttpOnly",
        ),
    )
  }

  private fun loginPageResponse() =
    MockResponse()
      .setResponseCode(200)
      .setHeader("Set-Cookie", "csrf-cookie=csrf-cookie-value; Path=/")
      .setBody(
        """
        <html><head>
          <meta name="csrf-token" content="csrf-token-value">
        </head></html>
        """.trimIndent(),
      )

  private fun client(
    baseClient: OkHttpClient = OkHttpClient(),
    maxDownloadBytes: Long = 50L * 1024L * 1024L,
    authTimeoutMs: Long = 30_000L,
  ) =
    GlookoDirectClient(
      region = GlookoRegion.EU,
      baseClient = baseClient,
      endpoints =
        GlookoEndpoints(
          webBaseUrl = server.url("/"),
          apiBaseUrl = server.url("/"),
        ),
      clock = Clock.fixed(Instant.parse("2026-08-10T12:00:00Z"), ZoneOffset.UTC),
      retrySleeper = sleeps::add,
      maxDownloadBytes = maxDownloadBytes,
      authTimeoutMs = authTimeoutMs,
    )

  private fun performOneDayExport(client: GlookoDirectClient = client()): ByteArray =
    client.downloadExport(
      "person@example.com",
      "password",
      LocalDate.parse("2026-08-10"),
      LocalDate.parse("2026-08-10"),
    )

  private fun assertExportRequestWindow(
    localDate: String,
    expectedStart: String,
    expectedEnd: String,
  ) {
    enqueueSuccessfulLogin("""{"glooko_code":"eu-test-account"}""")
    server.enqueue(
      MockResponse()
        .setResponseCode(200)
        .setBody(okio.Buffer().write(validZip())),
    )
    client().downloadExport(
      "person@example.com",
      "password",
      LocalDate.parse(localDate),
      LocalDate.parse(localDate),
    )
    repeat(3) { server.takeRequest(1, TimeUnit.SECONDS)!! }
    val export = server.takeRequest(1, TimeUnit.SECONDS)!!
    assertEquals(expectedStart, export.requestUrl!!.queryParameter("startDate"))
    assertEquals(expectedEnd, export.requestUrl!!.queryParameter("endDate"))
  }

  private fun captureFailure(block: () -> Unit): GlookoDirectException =
    try {
      block()
      throw AssertionError("Expected GlookoDirectException")
    } catch (error: GlookoDirectException) {
      error
    }

  private fun validZip(): ByteArray {
    val output = ByteArrayOutputStream()
    ZipOutputStream(output).use { zip ->
      zip.putNextEntry(ZipEntry("Insulin data/bolus_data_1.csv"))
      zip.write("metadata\nTimestamp,Insulin delivered (U)\n".toByteArray())
      zip.closeEntry()
    }
    return output.toByteArray()
  }
}
