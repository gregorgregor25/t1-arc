package io.github.gregorgregor25.t1arc.tarvisdirect

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

internal object TarvisDirectProtocol {
  val JSON = "application/json; charset=utf-8".toMediaType()
  const val TOKEN_URL = "https://mtls.auth.openai.com/oauth/token"
  const val RESPONSES_URL = "https://mtls.api.openai.com/v1/responses"
  // readBounded uses the UTF-8 worst case of four bytes per Java character.
  // Eight MiB therefore preserves the JavaScript-side two-million-character
  // response ceiling while leaving room for encrypted reasoning content on
  // multi-tool turns. This remains a hard, bounded transport limit.
  const val MAX_RESPONSE_BYTES = 8L * 1024L * 1024L
  const val MAX_ENROLLMENT_BYTES = 256L * 1024L

  fun enrollmentUrl(baseUrl: String, path: String): HttpUrl {
    val parsed = baseUrl.toHttpUrl()
    require(parsed.encodedUsername.isEmpty() && parsed.encodedPassword.isEmpty()) {
      "The enrolment address must not contain credentials."
    }
    require(parsed.querySize == 0 && parsed.fragment == null) {
      "The enrolment address must not contain a query or fragment."
    }
    require(parsed.isHttps || isPrivateDevelopmentHost(parsed.host)) {
      "The enrolment address must use HTTPS outside a private development network."
    }
    return parsed.newBuilder()
      .encodedPath(path)
      .query(null)
      .fragment(null)
      .build()
  }

  fun challengeRequest(baseUrl: String, bearer: String, installationId: String): Request {
    requireSecret(bearer, "enrolment authorization")
    val body = JSONObject().put("installationId", installationId)
    return Request.Builder()
      .url(enrollmentUrl(baseUrl, "/poc/v1/enrollment/challenges"))
      .header("Authorization", "Bearer $bearer")
      .header("Cache-Control", "no-store")
      .post(body.toString().toRequestBody(JSON))
      .build()
  }

  fun certificateRequest(
    baseUrl: String,
    bearer: String,
    installationId: String,
    challengeId: String,
    attestationChainDerBase64: List<String>,
  ): Request {
    requireSecret(bearer, "enrolment authorization")
    require(challengeId.length in 1..80) { "The enrolment challenge is invalid." }
    require(attestationChainDerBase64.size in 2..8) {
      "The Android key attestation chain is invalid."
    }
    val body = JSONObject()
      .put("installationId", installationId)
      .put("challengeId", challengeId)
      .put("attestationChainDerBase64", JSONArray(attestationChainDerBase64))
    return Request.Builder()
      .url(enrollmentUrl(baseUrl, "/poc/v1/enrollment/certificates"))
      .header("Authorization", "Bearer $bearer")
      .header("Cache-Control", "no-store")
      .post(body.toString().toRequestBody(JSON))
      .build()
  }

  fun tokenRequest(identityProviderId: String, serviceAccountId: String): Request {
    requireOpaqueId(identityProviderId, "identity provider")
    requireOpaqueId(serviceAccountId, "service account")
    val body = JSONObject()
      .put("grant_type", "urn:ietf:params:oauth:grant-type:token-exchange")
      .put("subject_token_type", "urn:openai:params:oauth:token-type:x509")
      .put("identity_provider_id", identityProviderId)
      .put("service_account_id", serviceAccountId)
    return Request.Builder()
      .url(TOKEN_URL)
      .header("Cache-Control", "no-store")
      .post(body.toString().toRequestBody(JSON))
      .build()
  }

  fun responseRequest(
    accessToken: String,
    model: String,
    inputJson: String,
    toolsJson: String,
    textFormatJson: String,
    maxOutputTokens: Int,
    reasoningEffort: String,
    toolChoice: String,
  ): Request {
    requireSecret(accessToken, "OpenAI access token")
    require(model.matches(Regex("^[A-Za-z0-9._:-]{1,80}$"))) {
      "The model name is invalid."
    }
    require(maxOutputTokens in 64..16_384) {
      "maxOutputTokens must be between 64 and 16384."
    }
    require(reasoningEffort in setOf("none", "low", "medium", "high", "xhigh", "max")) {
      "The reasoning effort is invalid."
    }
    require(toolChoice in setOf("auto", "required", "none")) {
      "The tool choice is invalid."
    }
    require(
      inputJson.length <= 1_000_000 &&
        toolsJson.length <= 256_000 &&
        textFormatJson.length <= 64_000
    ) {
      "The direct model request is too large."
    }
    val input = JSONArray(inputJson)
    val tools = JSONArray(toolsJson)
    val textFormat = JSONObject(textFormatJson)
    require(input.length() in 1..256) { "The model input is empty or too large." }
    require(tools.length() in 1..32) { "The local tool list is empty or too large." }
    for (index in 0 until tools.length()) {
      val tool = tools.getJSONObject(index)
      require(tool.optString("type") == "function") {
        "Only local function tools are permitted in direct mode."
      }
      require(tool.has("name") && tool.has("parameters")) {
        "Each local function tool must have a name and parameters."
      }
    }
    require(textFormat.optString("type") == "json_schema") {
      "The direct answer format must be a JSON schema."
    }
    require(textFormat.optBoolean("strict") && textFormat.has("name") && textFormat.has("schema")) {
      "The direct answer schema must be strict, named and complete."
    }
    val body = JSONObject()
      .put("model", model)
      .put("input", input)
      .put("tools", tools)
      .put("max_output_tokens", maxOutputTokens)
      .put("parallel_tool_calls", false)
      .put("tool_choice", toolChoice)
      .put("store", false)
      .put("background", false)
      .put("include", JSONArray().put("reasoning.encrypted_content"))
      .put("reasoning", JSONObject().put("effort", reasoningEffort))
      .put(
        "text",
        JSONObject()
          .put("verbosity", "low")
          .put("format", textFormat),
      )
    return Request.Builder()
      .url(RESPONSES_URL)
      .header("Authorization", "Bearer $accessToken")
      .header("Cache-Control", "no-store")
      .post(body.toString().toRequestBody(JSON))
      .build()
  }

  fun errorMessage(statusCode: Int, body: String): String {
    val remote = runCatching {
      val error = JSONObject(body).optJSONObject("error")
      error?.optString("message")?.takeIf { it.isNotBlank() }
    }.getOrNull()
    return remote ?: "The remote service returned HTTP $statusCode."
  }

  private fun requireOpaqueId(value: String, label: String) {
    require(value.matches(Regex("^[A-Za-z0-9._:-]{3,200}$"))) {
      "The $label identifier is invalid."
    }
  }

  private fun requireSecret(value: String, label: String) {
    require(value.isNotBlank() && value.length <= 4096 && !value.contains('\n') && !value.contains('\r')) {
      "The $label is invalid."
    }
  }

  private fun isPrivateDevelopmentHost(host: String): Boolean {
    if (host == "localhost" || host == "127.0.0.1" || host == "::1") return true
    if (host.startsWith("10.")) return true
    if (host.startsWith("192.168.")) return true
    val octets = host.split('.')
    if (octets.size == 4 && octets[0] == "172") {
      val second = octets[1].toIntOrNull()
      if (second != null && second in 16..31) return true
    }
    return false
  }
}
