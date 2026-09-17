package io.github.gregorgregor25.t1arc.glooko

import java.io.ByteArrayOutputStream
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
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
  @Test
  fun selectedRegionControlsReportLanguageNegotiation() {
    assertEquals("en-GB,en;q=0.9", GlookoRegion.EU.acceptLanguageHeader())
    assertEquals("en-US,en;q=0.9", GlookoRegion.US.acceptLanguageHeader())
  }

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
            timeZone = ZoneId.of("Europe/London"),
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
  fun identifiedReportUsesAuthenticatedSinglePatientDailyOverviewEndpoint() {
    val pdf = validPdf()
    val rawCode = "eu-west-1-private-user-9753"
    val reportPatientId = "current-session-patient-42"
    val protectedIdentity = "af1_${"d".repeat(64)}"
    enqueueSuccessfulLogin(
      """
      <a href="/patients/public-dashboard-handle/dashboard">Dashboard</a>
      <script>{"glooko_code":"$rawCode"}</script>
      """.trimIndent(),
    )
    server.enqueue(
      MockResponse()
        .setResponseCode(200)
        .setBody(
          """
          <script>
            window.print_report.patient_id = "internal-report-patient-42";
            window.analyticsUser = {"glooko_code":"$rawCode"};
          </script>
          """.trimIndent(),
        ),
    )
    server.enqueue(sessionUsersResponse(reportPatientId, rawCode))
    server.enqueue(endDatesResponse())
    server.enqueue(pdfLoaderResponse(reportPatientId))
    server.enqueue(
      MockResponse()
        .setResponseCode(200)
        .setHeader("Content-Type", "application/pdf")
        .setBody(okio.Buffer().write(pdf)),
    )

    val result =
      client().downloadIdentifiedReport(
        credentials =
          GlookoCredentials(
            email = "person@example.com",
            password = "not-logged",
            timeZone = ZoneId.of("Europe/London"),
            credentialGeneration = 7,
          ),
        startDate = LocalDate.parse("2026-08-10"),
        endDate = LocalDate.parse("2026-08-16"),
        fingerprintAccount = { protectedIdentity },
      )

    assertArrayEquals(pdf, result.report)
    assertEquals(protectedIdentity, result.accountFingerprint)
    assertEquals(LocalDate.parse("2026-08-11"), result.startDate)
    assertEquals(LocalDate.parse("2026-08-17"), result.endDate)
    repeat(4) { server.takeRequest(1, TimeUnit.SECONDS)!! }
    val sessionUsers = server.takeRequest(1, TimeUnit.SECONDS)!!
    val endDates = server.takeRequest(1, TimeUnit.SECONDS)!!
    val loader = server.takeRequest(1, TimeUnit.SECONDS)!!
    val report = server.takeRequest(1, TimeUnit.SECONDS)!!
    assertEquals("/api/v3/session/users", sessionUsers.requestUrl!!.encodedPath)
    assertEquals(rawCode, sessionUsers.requestUrl!!.queryParameter("patient"))
    assertEquals("/api/v3/end_dates", endDates.requestUrl!!.encodedPath)
    assertEquals(rawCode, endDates.requestUrl!!.queryParameter("patient"))
    assertEquals("/pdf_loading", loader.requestUrl!!.encodedPath)
    assertEquals("false", loader.requestUrl!!.queryParameter("bgSummary"))
    assertEquals("false", loader.requestUrl!!.queryParameter("cgmSummary"))
    assertEquals("false", loader.requestUrl!!.queryParameter("overview"))
    assertEquals("true", loader.requestUrl!!.queryParameter("dailyOverview"))
    assertEquals("false", loader.requestUrl!!.queryParameter("weekView"))
    assertEquals("false", loader.requestUrl!!.queryParameter("devices"))
    assertEquals("weekViewPdfMedium", loader.requestUrl!!.queryParameter("weekViewGraphSize"))
    assertEquals("true", loader.requestUrl!!.queryParameter("showEvents"))
    assertEquals("Europe/London", loader.requestUrl!!.queryParameter("clientTimezone"))
    assertEquals("/api/v3/pdf/download", report.requestUrl!!.encodedPath)
    assertEquals(
      reportPatientId,
      report.requestUrl!!.queryParameter("patient"),
    )
    assertEquals("2026-08-11T00:00:00.000Z", report.requestUrl!!.queryParameter("startDate"))
    assertEquals("2026-08-17T23:59:59.999Z", report.requestUrl!!.queryParameter("endDate"))
    assertEquals("true", report.requestUrl!!.queryParameter("dailyOverview"))
    assertTrue(report.getHeader("Accept").orEmpty().contains("text/html"))
    assertEquals("en-GB,en;q=0.9", report.getHeader("Accept-Language"))
    assertTrue(
      report.getHeader("Cookie").orEmpty()
        .contains("_logbook-web_session=session-value"),
    )
    assertTrue(
      report.getHeader("Referer").orEmpty()
        .endsWith("/pdf_loading"),
    )
  }

  @Test
  fun identifiedUsReportSendsTheUsLanguageHeaderOnTheActualRequest() {
    val pdf = validPdf()
    val rawCode = "us-private-user-9753"
    val reportPatientId = "current-session-patient-us-42"
    enqueueSuccessfulLogin(
      """
      <a href="/patients/public-dashboard-handle/dashboard">Dashboard</a>
      <script>{"glooko_code":"$rawCode"}</script>
      """.trimIndent(),
    )
    server.enqueue(
      MockResponse()
        .setResponseCode(200)
        .setBody("""<script>{"glooko_code":"$rawCode"}</script>"""),
    )
    server.enqueue(sessionUsersResponse(reportPatientId, rawCode))
    server.enqueue(endDatesResponse())
    server.enqueue(pdfLoaderResponse(reportPatientId))
    server.enqueue(
      MockResponse()
        .setResponseCode(200)
        .setHeader("Content-Type", "application/pdf")
        .setBody(okio.Buffer().write(pdf)),
    )

    val result =
      client(region = GlookoRegion.US).downloadIdentifiedReport(
        credentials =
          GlookoCredentials(
            email = "person@example.com",
            password = "not-logged",
            timeZone = ZoneId.of("Europe/London"),
            credentialGeneration = 7,
            region = GlookoRegion.US,
          ),
        startDate = LocalDate.parse("2026-08-10"),
        endDate = LocalDate.parse("2026-08-16"),
        fingerprintAccount = { "af1_${"f".repeat(64)}" },
      )

    assertArrayEquals(pdf, result.report)
    val requests =
      (1..server.requestCount).map { server.takeRequest(1, TimeUnit.SECONDS)!! }
    val report = requests.single { it.requestUrl!!.encodedPath == "/api/v3/pdf/download" }
    assertEquals("en-US,en;q=0.9", report.getHeader("Accept-Language"))
  }

  @Test
  fun identifiedReportDoesNotProbeLegacyIdsAfterAuthoritativeId404() {
    val rawCode = "eu-west-1-private-user-9753"
    val sessionPatientId = "current-session-patient-77"
    enqueueSuccessfulLogin(
      """
      <a href="/patients/public-dashboard-handle/dashboard">Dashboard</a>
      <script>{"glooko_code":"$rawCode"}</script>
      """.trimIndent(),
    )
    server.enqueue(
      MockResponse()
        .setResponseCode(200)
        .setBody(
          """
          <script>
            window.print_report.patient_id = "internal-report-patient-42";
            window.analyticsUser = {"glooko_code":"$rawCode"};
          </script>
          """.trimIndent(),
        ),
    )
    server.enqueue(sessionUsersResponse(sessionPatientId, rawCode))
    server.enqueue(endDatesResponse())
    server.enqueue(pdfLoaderResponse(sessionPatientId))
    server.enqueue(MockResponse().setResponseCode(404))

    val error =
      captureFailure {
        client().downloadIdentifiedReport(
          credentials =
            GlookoCredentials(
              email = "person@example.com",
              password = "not-logged",
              timeZone = ZoneId.of("Europe/London"),
              credentialGeneration = 7,
            ),
          startDate = LocalDate.parse("2026-08-11"),
          endDate = LocalDate.parse("2026-08-17"),
          fingerprintAccount = { "af1_${"d".repeat(64)}" },
        )
      }

    assertEquals(GlookoDirectFailure.REPORT_NOT_AVAILABLE, error.failure)
    assertEquals("http-404", error.diagnosticCode)
    repeat(6) { server.takeRequest(1, TimeUnit.SECONDS)!! }
    val loaderRequest = server.takeRequest(1, TimeUnit.SECONDS)!!
    val reportRequest = server.takeRequest(1, TimeUnit.SECONDS)!!
    assertEquals("/pdf_loading", loaderRequest.requestUrl!!.encodedPath)
    assertEquals(
      sessionPatientId,
      reportRequest.requestUrl!!.queryParameter("patient"),
    )
    assertEquals(null, server.takeRequest(100, TimeUnit.MILLISECONDS))
  }

  @Test
  fun identifiedReportUsesCurrentSessionUserIdWhenLegacyPageDiffers() {
    val pdf = validPdf()
    val rawCode = "eu-demo-account"
    val sessionPatientId = "current-session-patient-99"
    enqueueSuccessfulLogin(
      """
      <script>
        window.patient = "internal-report-patient-42";
        window.analyticsUser = {"glooko_code":"$rawCode"};
      </script>
      """.trimIndent(),
    )
    server.enqueue(sessionUsersResponse(sessionPatientId, rawCode))
    server.enqueue(endDatesResponse())
    server.enqueue(pdfLoaderResponse(sessionPatientId))
    server.enqueue(
      MockResponse()
        .setResponseCode(200)
        .setHeader("Content-Type", "application/pdf")
        .setBody(okio.Buffer().write(pdf)),
    )

    val result =
      client().downloadIdentifiedReport(
        credentials =
          GlookoCredentials(
            email = "person@example.com",
            password = "not-logged",
            timeZone = ZoneId.of("Europe/London"),
            credentialGeneration = 7,
          ),
        startDate = LocalDate.parse("2026-08-11"),
        endDate = LocalDate.parse("2026-08-17"),
        fingerprintAccount = { "af1_${"d".repeat(64)}" },
      )

    assertArrayEquals(pdf, result.report)
    repeat(3) { server.takeRequest(1, TimeUnit.SECONDS)!! }
    val sessionUsersRequest = server.takeRequest(1, TimeUnit.SECONDS)!!
    val endDatesRequest = server.takeRequest(1, TimeUnit.SECONDS)!!
    val loaderRequest = server.takeRequest(1, TimeUnit.SECONDS)!!
    val reportRequest = server.takeRequest(1, TimeUnit.SECONDS)!!
    assertEquals("/api/v3/session/users", sessionUsersRequest.requestUrl!!.encodedPath)
    assertEquals("/api/v3/end_dates", endDatesRequest.requestUrl!!.encodedPath)
    assertEquals("/pdf_loading", loaderRequest.requestUrl!!.encodedPath)
    assertEquals(
      sessionPatientId,
      reportRequest.requestUrl!!.queryParameter("patient"),
    )
  }

  @Test
  fun identifiedReportUsesServerRenderedWindowPatientWithoutDashboardLink() {
    val pdf = validPdf()
    val rawCode = "eu-demo-account"
    val sessionPatientId = "current-session-patient-51"
    enqueueSuccessfulLogin(
      """
      <script>
        window.patient = "patient-from-report-dialog";
        window.analyticsUser = {"glooko_code":"$rawCode"};
      </script>
      """.trimIndent(),
    )
    server.enqueue(sessionUsersResponse(sessionPatientId, rawCode))
    server.enqueue(endDatesResponse())
    server.enqueue(pdfLoaderResponse(sessionPatientId))
    server.enqueue(
      MockResponse()
        .setResponseCode(200)
        .setHeader("Content-Type", "application/pdf")
        .setBody(okio.Buffer().write(pdf)),
    )

    val result =
      client().downloadIdentifiedReport(
        credentials =
          GlookoCredentials(
            email = "person@example.com",
            password = "not-logged",
            timeZone = ZoneId.of("Europe/London"),
            credentialGeneration = 7,
          ),
        startDate = LocalDate.parse("2026-08-11"),
        endDate = LocalDate.parse("2026-08-17"),
        fingerprintAccount = { "af1_${"e".repeat(64)}" },
      )

    assertArrayEquals(pdf, result.report)
    repeat(3) { server.takeRequest(1, TimeUnit.SECONDS)!! }
    server.takeRequest(1, TimeUnit.SECONDS)!!
    server.takeRequest(1, TimeUnit.SECONDS)!!
    server.takeRequest(1, TimeUnit.SECONDS)!!
    val report = server.takeRequest(1, TimeUnit.SECONDS)!!
    assertEquals(
      sessionPatientId,
      report.requestUrl!!.queryParameter("patient"),
    )
  }

  @Test
  fun identifiedReportFollowsTheGeneratedDocumentRedirect() {
    val pdf = validPdf()
    val rawCode = "eu-demo-account"
    val sessionPatientId = "current-session-patient-42"
    enqueueSuccessfulLogin(
      """
      <script>
        window.patient = "patient-42";
        window.analyticsUser = {"glooko_code":"$rawCode"};
      </script>
      """.trimIndent(),
    )
    server.enqueue(sessionUsersResponse(sessionPatientId, rawCode))
    server.enqueue(endDatesResponse())
    server.enqueue(pdfLoaderResponse(sessionPatientId))
    server.enqueue(
      MockResponse()
        .setResponseCode(302)
        .setHeader("Location", "/generated/daily-overview.pdf"),
    )
    server.enqueue(
      MockResponse()
        .setResponseCode(200)
        .setHeader("Content-Type", "application/pdf")
        .setBody(okio.Buffer().write(pdf)),
    )

    val result =
      client().downloadIdentifiedReport(
        credentials =
          GlookoCredentials(
            email = "person@example.com",
            password = "not-logged",
            timeZone = ZoneId.of("Europe/London"),
            credentialGeneration = 7,
          ),
        startDate = LocalDate.parse("2026-08-11"),
        endDate = LocalDate.parse("2026-08-17"),
        fingerprintAccount = { "af1_${"f".repeat(64)}" },
      )

    assertArrayEquals(pdf, result.report)
    repeat(7) { server.takeRequest(1, TimeUnit.SECONDS)!! }
    val generatedPdf = server.takeRequest(1, TimeUnit.SECONDS)!!
    assertEquals("/generated/daily-overview.pdf", generatedPdf.path)
    assertTrue(
      generatedPdf.getHeader("Cookie").orEmpty()
        .contains("_logbook-web_session=session-value"),
    )
  }

  @Test
  fun reportWithoutASessionDisplayUserIdentifierFailsClosed() {
    enqueueSuccessfulLogin("""{"glooko_code":"eu-demo-account"}""")
    server.enqueue(
      MockResponse()
        .setResponseCode(200)
        .setHeader("Content-Type", "application/json")
        .setBody(
          """
          {"currentUser":{"glookoCode":"eu-demo-account"},"currentPatient":null}
          """.trimIndent(),
        ),
    )

    val error =
      captureFailure {
        client().downloadIdentifiedReport(
          credentials =
            GlookoCredentials(
              email = "person@example.com",
              password = "not-logged",
              timeZone = ZoneId.of("Europe/London"),
              credentialGeneration = 7,
            ),
          startDate = LocalDate.parse("2026-08-11"),
          endDate = LocalDate.parse("2026-08-17"),
          fingerprintAccount = { "af1_${"e".repeat(64)}" },
        )
      }

    assertEquals(GlookoDirectFailure.AUTHENTICATION_PROTOCOL_CHANGED, error.failure)
    assertEquals(4, server.requestCount)
  }

  @Test
  fun htmlCannotPassAsAReportPdf() {
    val rawCode = "eu-demo-account"
    val sessionPatientId = "current-session-patient-42"
    enqueueSuccessfulLogin(
      """
      <a href="/patients/patient-42/dashboard">Dashboard</a>
      <script>{"glooko_code":"$rawCode"}</script>
      """.trimIndent(),
    )
    server.enqueue(
      MockResponse()
        .setResponseCode(200)
        .setBody(
          """
          <script>
            window.print_report.patient_id = "patient-42";
            window.analyticsUser = {"glooko_code":"eu-demo-account"};
          </script>
          """.trimIndent(),
        ),
    )
    server.enqueue(sessionUsersResponse(sessionPatientId, rawCode))
    server.enqueue(endDatesResponse())
    server.enqueue(pdfLoaderResponse(sessionPatientId))
    repeat(3) {
      server.enqueue(
        MockResponse()
          .setResponseCode(200)
          .setHeader("Content-Type", "text/html")
          .setBody("<html>not a report</html>"),
      )
    }

    val error =
      captureFailure {
        client().downloadIdentifiedReport(
          credentials =
            GlookoCredentials(
              email = "person@example.com",
              password = "not-logged",
              timeZone = ZoneId.of("Europe/London"),
              credentialGeneration = 7,
            ),
          startDate = LocalDate.parse("2026-08-11"),
          endDate = LocalDate.parse("2026-08-17"),
          fingerprintAccount = { "af1_${"f".repeat(64)}" },
        )
      }

    assertEquals(GlookoDirectFailure.INVALID_PDF, error.failure)
    assertEquals(listOf(500L, 1_000L), sleeps)
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
  fun sessionUserParserUsesTheCurrentDisplayUserId() {
    val json =
      """
      {
        "currentUser": {
          "id": "current-session-patient-42",
          "glookoCode": "eu-demo-account"
        },
        "currentPatient": null
      }
      """.trimIndent()

    assertEquals(
      "current-session-patient-42",
      GlookoDirectClient.extractSessionDisplayUserId(json, "eu-demo-account"),
    )
  }

  @Test
  fun savedNewYorkAccountClockOwnsTheExportWindow() {
    assertExportRequestWindow(
      localDate = "2026-07-15",
      expectedStart = "2026-07-15T04:00:00Z",
      expectedEnd = "2026-07-16T03:59:59Z",
      timeZone = ZoneId.of("America/New_York"),
    )
  }

  @Test
  fun sessionUserParserRequiresAnExactlyBoundSafeScalarId() {
    val invalidResponses =
      listOf(
        """{"currentUser":{"id":"patient-42","glookoCode":""}}""",
        """{"currentUser":{"id":"patient-42","glookoCode":"other-account"}}""",
        """{"currentUser":{"id":{"value":"patient-42"},"glookoCode":"eu-demo-account"}}""",
        """{"currentUser":{"id":["patient-42"],"glookoCode":"eu-demo-account"}}""",
        """{"currentUser":{"id":"${"x".repeat(257)}","glookoCode":"eu-demo-account"}}""",
        """{"currentUser":{"id":"patient/42","glookoCode":"eu-demo-account"}}""",
      )

    invalidResponses.forEach { json ->
      assertEquals(
        null,
        GlookoDirectClient.extractSessionDisplayUserId(json, "eu-demo-account"),
      )
    }
    assertEquals(
      "42",
      GlookoDirectClient.extractSessionDisplayUserId(
        """{"currentUser":{"id":42,"glookoCode":"eu-demo-account"}}""",
        "eu-demo-account",
      ),
    )
  }

  @Test
  fun reportEndDateParserAcceptsTheCurrentApiTimestamp() {
    assertEquals(
      LocalDate.parse("2026-08-17"),
      GlookoDirectClient.extractReportEndDate(
        """{"endDateDashboard":"2026-08-18","endDateReport":"2026-08-17T23:59:59.999Z"}""",
      ),
    )
    assertEquals(
      LocalDate.parse("2026-08-17"),
      GlookoDirectClient.extractReportEndDate(
        """{"endDateReport":"2026-08-17"}""",
      ),
    )
    assertEquals(
      null,
      GlookoDirectClient.extractReportEndDate(
        """{"endDateReport":"2026-08-17garbage"}""",
      ),
    )
  }

  @Test
  fun canonicalReportQueryRejectsChangedDuplicateAndUnknownParameters() {
    val expected = dailyOverviewParams("patient-42")
    fun url(params: List<Pair<String, String>>) =
      server.url("/api/v3/pdf/download").newBuilder().apply {
        params.forEach { (name, value) -> addQueryParameter(name, value) }
      }.build()

    assertTrue(GlookoDirectClient.hasExactQueryParameters(url(expected), expected))
    assertFalse(
      GlookoDirectClient.hasExactQueryParameters(
        url(expected.map { (name, value) ->
          name to if (name == "dailyOverview") "false" else value
        }),
        expected,
      ),
    )
    assertFalse(
      GlookoDirectClient.hasExactQueryParameters(
        url(expected + ("dailyOverview" to "true")),
        expected,
      ),
    )
    assertFalse(
      GlookoDirectClient.hasExactQueryParameters(
        url(expected + ("unexpected" to "value")),
        expected,
      ),
    )
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

  private fun sessionUsersResponse(
    patientId: String,
    glookoCode: String,
  ) =
    MockResponse()
      .setResponseCode(200)
      .setHeader("Content-Type", "application/json")
      .setBody(
        """
        {
          "currentUser": {
            "id": "$patientId",
            "glookoCode": "$glookoCode"
          },
          "currentPatient": null
        }
        """.trimIndent(),
      )

  private fun endDatesResponse(
    endDate: String = "2026-08-17T23:59:59.999Z",
  ) =
    MockResponse()
      .setResponseCode(200)
      .setHeader("Content-Type", "application/json")
      .setBody(
        """
        {
          "endDateDashboard": "2026-08-18T23:59:59.999Z",
          "endDateReport": "$endDate"
        }
        """.trimIndent(),
      )

  private fun pdfLoaderResponse(
    patientId: String,
    startDate: String = "2026-08-11T00:00:00.000Z",
    endDate: String = "2026-08-17T23:59:59.999Z",
  ): MockResponse {
    val paramsBuilder = server.url("/api/v3/pdf/download").newBuilder()
    dailyOverviewParams(patientId, startDate, endDate).forEach { (name, value) ->
      paramsBuilder.addQueryParameter(name, value)
    }
    val params =
      paramsBuilder.build().encodedQuery!!
        .replace("&", "&amp;")
        .replace("\"", "&quot;")
    return MockResponse()
      .setResponseCode(200)
      .setHeader("Content-Type", "text/html")
      .setBody(
        """
        <html><body>
          <div id="pdf-loader-container" data-pdfreportparams="$params"></div>
        </body></html>
        """.trimIndent(),
      )
  }

  private fun dailyOverviewParams(
    patientId: String,
    startDate: String = "2026-08-11T00:00:00.000Z",
    endDate: String = "2026-08-17T23:59:59.999Z",
  ) =
    listOf(
      "patient" to patientId,
      "endDate" to endDate,
      "startDate" to startDate,
      "bgSummary" to "false",
      "cgmSummary" to "false",
      "logbook" to "false",
      "overview" to "false",
      "dailyOverview" to "true",
      "weekView" to "false",
      "bgOverlay" to "false",
      "cgmOverlay" to "false",
      "calendar" to "false",
      "insights" to "false",
      "devices" to "false",
      "weekViewGraphSize" to "weekViewPdfMedium",
      "color" to "true",
      "quickNote" to "",
      "showEvents" to "true",
      "clientTimezone" to "Europe/London",
    )

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
    region: GlookoRegion = GlookoRegion.EU,
    baseClient: OkHttpClient = OkHttpClient(),
    maxDownloadBytes: Long = 50L * 1024L * 1024L,
    authTimeoutMs: Long = 30_000L,
    timeZone: ZoneId = ZoneId.of("Europe/London"),
  ) =
    GlookoDirectClient(
      region = region,
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
      timeZone = timeZone,
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
    timeZone: ZoneId = ZoneId.of("Europe/London"),
  ) {
    enqueueSuccessfulLogin("""{"glooko_code":"eu-test-account"}""")
    server.enqueue(
      MockResponse()
        .setResponseCode(200)
        .setBody(okio.Buffer().write(validZip())),
    )
    client(timeZone = timeZone).downloadExport(
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

  private fun validPdf(): ByteArray =
    "%PDF-1.7\n1 0 obj\n<<>>\nendobj\nstartxref\n0\n%%EOF\n".toByteArray()
}
