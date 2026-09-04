package io.github.gregorgregor25.t1arc.tarvisdirect

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class TarvisDirectProtocolTest {
  private val answerFormat =
    """{"type":"json_schema","name":"tarvis_answer_v1","strict":true,"schema":{"type":"object"}}"""

  @Test
  fun `enrolment requests are closed to health content`() {
    val challenge = TarvisDirectProtocol.challengeRequest(
      "http://127.0.0.1:7314",
      "poc-secret",
      "installation_1234567890",
    )
    val challengeJson = JSONObject(body(challenge))
    assertEquals(setOf("installationId"), keys(challengeJson))
    assertFalse(body(challenge).contains("glucose", ignoreCase = true))

    val certificate = TarvisDirectProtocol.certificateRequest(
      "https://enrol.example.test/base",
      "poc-secret",
      "installation_1234567890",
      "challenge-id",
      listOf("leaf", "root"),
    )
    val certificateJson = JSONObject(body(certificate))
    assertEquals(
      setOf("installationId", "challengeId", "attestationChainDerBase64"),
      keys(certificateJson),
    )
    assertFalse(body(certificate).contains("glucose", ignoreCase = true))
  }

  @Test
  fun `token exchange uses the fixed OpenAI mTLS endpoint`() {
    val request = TarvisDirectProtocol.tokenRequest("provider_123", "service_123")
    assertEquals(TarvisDirectProtocol.TOKEN_URL, request.url.toString())
    val json = JSONObject(body(request))
    assertEquals(
      "urn:ietf:params:oauth:grant-type:token-exchange",
      json.getString("grant_type"),
    )
    assertEquals(
      "urn:openai:params:oauth:token-type:x509",
      json.getString("subject_token_type"),
    )
  }

  @Test
  fun `responses are non-stored and restricted to local functions`() {
    val request = TarvisDirectProtocol.responseRequest(
      "short-lived-access-token-value",
      "gpt-5.6-luna",
      """[{"role":"user","content":"What was my highest glucose yesterday?"}]""",
      """[{"type":"function","name":"query_health_records","parameters":{"type":"object"}}]""",
      answerFormat,
      2048,
      "low",
      "required",
    )
    assertEquals(TarvisDirectProtocol.RESPONSES_URL, request.url.toString())
    val json = JSONObject(body(request))
    assertFalse(json.getBoolean("store"))
    assertFalse(json.getBoolean("background"))
    assertFalse(json.getBoolean("parallel_tool_calls"))
    assertEquals("required", json.getString("tool_choice"))
    assertEquals("reasoning.encrypted_content", json.getJSONArray("include").getString(0))
    assertEquals("low", json.getJSONObject("reasoning").getString("effort"))
    assertEquals("low", json.getJSONObject("text").getString("verbosity"))
    assertEquals(
      "tarvis_answer_v1",
      json.getJSONObject("text").getJSONObject("format").getString("name"),
    )

    assertThrows(IllegalArgumentException::class.java) {
      TarvisDirectProtocol.responseRequest(
        "short-lived-access-token-value",
        "gpt-5.6-luna",
        """[{"role":"user","content":"question"}]""",
        """[{"type":"file_search","vector_store_ids":["vs_123"]}]""",
        answerFormat,
        2048,
        "low",
        "required",
      )
    }

    assertThrows(IllegalArgumentException::class.java) {
      TarvisDirectProtocol.responseRequest(
        "short-lived-access-token-value",
        "gpt-5.6-luna",
        """[{"role":"user","content":"question"}]""",
        """[{"type":"function","name":"query_health_records","parameters":{"type":"object"}}]""",
        answerFormat,
        2048,
        "minimal",
        "required",
      )
    }

    val maximumReasoning = TarvisDirectProtocol.responseRequest(
      "short-lived-access-token-value",
      "gpt-5.6-luna",
      """[{"role":"user","content":"question"}]""",
      """[{"type":"function","name":"query_health_records","parameters":{"type":"object"}}]""",
      answerFormat,
      2048,
      "max",
      "none",
    )
    assertEquals(
      "max",
      JSONObject(body(maximumReasoning)).getJSONObject("reasoning").getString("effort"),
    )
  }

  @Test
  fun `public internet enrolment requires HTTPS`() {
    assertThrows(IllegalArgumentException::class.java) {
      TarvisDirectProtocol.challengeRequest(
        "http://enrol.example.test",
        "poc-secret",
        "installation_1234567890",
      )
    }
    assertTrue(
      TarvisDirectProtocol.challengeRequest(
        "https://enrol.example.test",
        "poc-secret",
        "installation_1234567890",
      ).url.isHttps,
    )
  }

  private fun body(request: okhttp3.Request): String {
    val buffer = okio.Buffer()
    requireNotNull(request.body).writeTo(buffer)
    return buffer.readUtf8()
  }

  private fun keys(value: JSONObject): Set<String> =
    value.keys().asSequence().toSet()
}
