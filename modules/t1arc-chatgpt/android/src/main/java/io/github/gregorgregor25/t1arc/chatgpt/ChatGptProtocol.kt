package io.github.gregorgregor25.t1arc.chatgpt

import java.math.BigInteger
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.Locale
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.Signature
import java.security.spec.RSAPublicKeySpec
import java.util.Base64
import org.json.JSONObject

internal const val RESOURCE = "https://api.openai.com/v1"
internal const val PLAN_SCOPE = "chatgpt.tokens.use.direct"
internal const val ISSUER = "https://auth.openai.com"

internal class ChatGptFailure(val code: String, message: String) : IllegalStateException(message)

internal object ChatGptProtocol {
  private val random = SecureRandom()

  fun randomUrlSafe(bytes: Int = 32): String = ByteArray(bytes).also(random::nextBytes).let(::base64Url)

  fun base64Url(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

  fun pkceChallenge(verifier: String): String =
    base64Url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(StandardCharsets.US_ASCII)))

  fun form(values: Map<String, String>): String = values.entries.joinToString("&") {
    "${encode(it.key)}=${encode(it.value)}"
  }

  private fun encode(value: String) = java.net.URLEncoder.encode(value, "UTF-8")

  data class Callback(val code: String?, val error: String?, val clientId: String?)

  fun callback(target: String, state: String, requestedClientId: String): Callback {
    val uri = try { URI(target) } catch (_: Exception) { throw IllegalArgumentException("Invalid callback.") }
    require(uri.rawPath == "/auth/callback" && uri.rawFragment == null && uri.rawQuery != null) { "Invalid callback." }
    val query = mutableMapOf<String, String>()
    for (part in uri.rawQuery.split('&')) {
      val pair = part.split('=', limit = 2)
      require(pair.size == 2) { "Invalid callback." }
      val key = URLDecoder.decode(pair[0], "UTF-8")
      require(!query.containsKey(key)) { "Invalid callback." }
      query[key] = URLDecoder.decode(pair[1], "UTF-8")
    }
    require(query["state"] == state) { "Invalid callback state." }
    val error = query["error"]?.takeIf(String::isNotBlank)
    val issuedClient = query["client_id"]?.takeIf(String::isNotBlank)
    if (error == null && requestedClientId == "dynamic_agent_client") {
      require(issuedClient != null && issuedClient != "dynamic_agent_client") { "ChatGPT registration was incomplete." }
    } else if (issuedClient != null) {
      require(requestedClientId == "dynamic_agent_client" || issuedClient == requestedClientId) {
        "ChatGPT account registration changed."
      }
    }
    if (error != null) return Callback(null, error, issuedClient)
    val code = query["code"]?.takeIf(String::isNotBlank)
      ?: throw IllegalArgumentException("ChatGPT sign-in did not return a code.")
    return Callback(code, null, issuedClient)
  }

  fun pinnedOpenAiUri(url: String): String {
    val uri = try { URI(url) } catch (_: Exception) { throw IllegalArgumentException("Invalid ChatGPT endpoint.") }
    require(uri.scheme == "https" && uri.host == "auth.openai.com" && uri.port == -1 &&
      uri.userInfo == null && uri.rawQuery == null && uri.rawFragment == null && uri.rawPath.startsWith("/")) {
      "Invalid ChatGPT endpoint."
    }
    return uri.toString()
  }

  fun streamMimeClass(header: String?): String = when (header?.substringBefore(';')?.trim()?.lowercase(Locale.ROOT)) {
    null, "" -> "missing"
    "text/event-stream" -> "event_stream"
    "application/json" -> "json"
    "text/html" -> "html"
    "text/plain" -> "plain_text"
    else -> "other"
  }

  data class ResponseDiagnostic(val shape: String, val service: String, val parameter: String)

  fun responseDiagnostic(body: JSONObject?): ResponseDiagnostic {
    val error = body?.optJSONObject("error")
    val serviceCode = error?.optString("code")
    val parameter = error?.optString("param")
    val safeService = when (serviceCode) {
      "invalid_request_error", "invalid_json_schema", "subscription_sharing_unsupported_capability",
      "subscription_sharing_route_not_supported", "subscription_sharing_user_not_eligible",
      "subscription_sharing_usage_limit_exceeded", "subscription_sharing_usage_unavailable",
      "subscription_sharing_user_unavailable", "subscription_sharing_invalid_user",
      "chatpass_v2_scope_not_authorized", "chatpass_v2_invalid_authorization_context" -> serviceCode ?: "other_or_missing"
      else -> "other_or_missing"
    }
    val safeParameter = when {
      parameter == "model" || parameter?.startsWith("model.") == true -> "model"
      parameter == "input" || parameter?.startsWith("input.") == true ||
        parameter?.startsWith("input[") == true -> "input"
      parameter == "instructions" || parameter?.startsWith("instructions.") == true -> "instructions"
      parameter == "reasoning" || parameter?.startsWith("reasoning.") == true -> "reasoning"
      parameter == "text" || parameter?.startsWith("text.") == true -> "text"
      else -> "other_or_missing"
    }
    val shape = when {
      error != null -> "error_object"
      body?.has("detail") == true -> "detail"
      body?.optString("status") == "completed" && body?.optJSONArray("output") != null -> "completed_response"
      body != null -> "other_json"
      else -> "non_json_or_empty"
    }
    return ResponseDiagnostic(shape, safeService, safeParameter)
  }

  fun classifyHttpError(status: Int, serviceCode: String?, action: String, parameter: String? = null): String = when {
    serviceCode == "subscription_sharing_usage_limit_exceeded" || status == 429 -> "ERR_CHATGPT_QUOTA"
    serviceCode == "subscription_sharing_usage_unavailable" ||
      serviceCode == "subscription_sharing_user_unavailable" || status >= 500 -> "ERR_CHATGPT_RETRY"
    serviceCode == "subscription_sharing_unsupported_capability" -> "ERR_CHATGPT_UNSUPPORTED"
    serviceCode == "subscription_sharing_route_not_supported" -> "ERR_CHATGPT_ROUTE"
    serviceCode == "subscription_sharing_user_not_eligible" || status == 403 -> "ERR_CHATGPT_RESTRICTED"
    action == "session" && serviceCode == "invalid_grant" -> "ERR_CHATGPT_INVALID_GRANT"
    status == 401 || (action == "session" && status == 400) -> "ERR_CHATGPT_AUTH"
    action == "response" && status == 400 -> classifyRequestParameter(parameter, serviceCode)
    action == "response" && status in 400..499 -> "ERR_CHATGPT_REQUEST_HTTP_OTHER"
    else -> "ERR_CHATGPT_RESPONSE"
  }

  // Do not pass provider error text or arbitrary parameter values through the
  // native bridge. These fixed buckets are sufficient to diagnose a rejected
  // request without risking a reflected prompt or account detail in the UI.
  private fun classifyRequestParameter(parameter: String?, serviceCode: String?): String = when {
    serviceCode == "invalid_json_schema" || parameter == "text" || parameter?.startsWith("text.") == true ->
      "ERR_CHATGPT_REQUEST_FORMAT"
    parameter == "model" || parameter?.startsWith("model.") == true -> "ERR_CHATGPT_REQUEST_MODEL"
    parameter == "input" || parameter?.startsWith("input.") == true || parameter?.startsWith("input[") == true ||
      parameter == "instructions" || parameter?.startsWith("instructions.") == true -> "ERR_CHATGPT_REQUEST_INPUT"
    parameter == "reasoning" || parameter?.startsWith("reasoning.") == true -> "ERR_CHATGPT_REQUEST_REASONING"
    else -> "ERR_CHATGPT_REQUEST_OTHER"
  }

  fun classifyStreamError(serviceCode: String?): String = when (serviceCode) {
    "subscription_sharing_usage_limit_exceeded" -> "ERR_CHATGPT_QUOTA"
    "subscription_sharing_usage_unavailable", "subscription_sharing_user_unavailable" -> "ERR_CHATGPT_RETRY"
    "subscription_sharing_user_not_eligible" -> "ERR_CHATGPT_RESTRICTED"
    "subscription_sharing_unsupported_capability" -> "ERR_CHATGPT_UNSUPPORTED"
    "subscription_sharing_route_not_supported" -> "ERR_CHATGPT_ROUTE"
    "subscription_sharing_invalid_user" -> "ERR_CHATGPT_AUTH"
    else -> "ERR_CHATGPT_INCOMPLETE"
  }

  fun grantedScopes(reply: JSONObject, previous: List<String>?): List<String> {
    if (!reply.has("scope")) return previous ?: emptyList()
    val raw = reply.opt("scope")
    require(raw is String) { "Invalid ChatGPT session permissions." }
    return raw.split(' ').filter(String::isNotBlank).distinct()
  }

  data class Identity(val subject: String, val email: String?)

  fun verifyIdToken(
    token: String,
    jwks: JSONObject,
    clientId: String,
    nonce: String?,
    expectedSubject: String?,
    nowSeconds: Long = System.currentTimeMillis() / 1000,
  ): Identity {
    val parts = token.split('.')
    require(parts.size == 3 && parts.all(String::isNotEmpty)) { "Invalid ChatGPT identity token." }
    val header = decodeJson(parts[0])
    require(header.optString("alg") == "RS256") { "Unsupported ChatGPT identity signature." }
    val kid = header.optString("kid")
    require(kid.isNotBlank()) { "Missing ChatGPT signing key." }
    val keys = jwks.optJSONArray("keys") ?: throw IllegalArgumentException("Missing ChatGPT signing keys.")
    val matches = (0 until keys.length()).mapNotNull { keys.optJSONObject(it) }
      .filter { it.optString("kid") == kid && it.optString("kty") == "RSA" &&
        (it.optString("use").isBlank() || it.optString("use") == "sig") &&
        (it.optString("alg").isBlank() || it.optString("alg") == "RS256") }
    require(matches.size == 1) { "ChatGPT signing key was unavailable." }
    val key = matches.single()
    val modulus = BigInteger(1, decodeUrl(key.getString("n")))
    val exponent = BigInteger(1, decodeUrl(key.getString("e")))
    require(modulus.bitLength() >= 2048 && exponent > BigInteger.ONE) { "Invalid ChatGPT signing key." }
    val publicKey = KeyFactory.getInstance("RSA").generatePublic(RSAPublicKeySpec(modulus, exponent))
    val verifier = Signature.getInstance("SHA256withRSA")
    verifier.initVerify(publicKey)
    verifier.update("${parts[0]}.${parts[1]}".toByteArray(StandardCharsets.US_ASCII))
    require(verifier.verify(decodeUrl(parts[2]))) { "Invalid ChatGPT identity signature." }

    val claims = decodeJson(parts[1])
    require(claims.optString("iss") == ISSUER) { "Invalid ChatGPT identity issuer." }
    val audience = claims.opt("aud")
    val validAudience = when (audience) {
      is String -> audience == clientId
      is org.json.JSONArray -> (0 until audience.length()).any { audience.optString(it) == clientId }
      else -> false
    }
    require(validAudience && (audience !is org.json.JSONArray || audience.length() <= 1 ||
      claims.optString("azp") == clientId)) { "Invalid ChatGPT identity audience." }
    val expiration = claims.optLong("exp", 0)
    require(expiration > nowSeconds - 60) { "ChatGPT identity token expired." }
    val issued = claims.optLong("iat", 0)
    require(issued > 0 && issued <= nowSeconds + 60) { "Invalid ChatGPT identity issue time." }
    if (nonce != null) require(claims.optString("nonce") == nonce) { "Invalid ChatGPT identity nonce." }
    val subject = claims.optString("sub")
    require(subject.isNotBlank()) { "Invalid ChatGPT account identity." }
    if (expectedSubject != null) require(subject == expectedSubject) { "ChatGPT account changed during sign-in." }
    return Identity(subject, claims.optString("email").takeIf(String::isNotBlank))
  }

  private fun decodeUrl(value: String): ByteArray = try {
    Base64.getUrlDecoder().decode(value)
  } catch (_: Exception) { throw IllegalArgumentException("Invalid ChatGPT identity encoding.") }

  private fun decodeJson(value: String): JSONObject = try {
    JSONObject(String(decodeUrl(value), StandardCharsets.UTF_8))
  } catch (_: Exception) { throw IllegalArgumentException("Invalid ChatGPT identity encoding.") }
}

/** An SSE event is trusted only after its complete blank-line terminator. */
internal class CompletedResponseParser(private val headerless: Boolean = false) {
  private var event = ""
  private val data = StringBuilder()
  private var totalDataBytes = 0
  private var sawDataLine = false
  private var sawNonEmptyLine = false

  fun finish(): Nothing = when {
    !sawNonEmptyLine -> throw ChatGptFailure("ERR_CHATGPT_STREAM_EMPTY", "ChatGPT returned an empty response stream.")
    headerless && !sawDataLine -> throw ChatGptFailure("ERR_CHATGPT_STREAM_FRAMING", "ChatGPT did not return an event stream.")
    else -> throw ChatGptFailure("ERR_CHATGPT_INCOMPLETE", "ChatGPT connection ended before the answer was complete.")
  }

  fun line(line: String): String? {
    require(line.length <= 4_000_000) { "ChatGPT response exceeded its size limit." }
    if (line.isNotEmpty()) {
      sawNonEmptyLine = true
      if (headerless && !line.startsWith(":") && !line.startsWith("event:") &&
        !line.startsWith("data:") && !line.startsWith("id:") && !line.startsWith("retry:")) {
        throw ChatGptFailure("ERR_CHATGPT_STREAM_FRAMING", "ChatGPT did not return an event stream.")
      }
    }
    if (line.isEmpty()) {
      if (data.isEmpty()) { event = ""; return null }
      if (data.toString() == "[DONE]") {
        throw ChatGptFailure("ERR_CHATGPT_INCOMPLETE", "ChatGPT stream ended before the answer was complete.")
      }
      val parsed = try { JSONObject(data.toString()) } catch (_: Exception) {
        throw ChatGptFailure("ERR_CHATGPT_STREAM_EVENT_JSON", "ChatGPT returned an invalid stream event.")
      }
      val type = parsed.optString("type").ifBlank { event }
      event = ""
      data.clear()
      when (type) {
        "response.completed" -> {
          val response = parsed.optJSONObject("response")
            ?: throw ChatGptFailure("ERR_CHATGPT_STREAM_COMPLETION_SHAPE", "ChatGPT completion had no response.")
          if (response.optString("status") != "completed") {
            throw ChatGptFailure("ERR_CHATGPT_INCOMPLETE", "ChatGPT did not complete its response.")
          }
          return response.toString()
        }
        "response.failed", "response.incomplete", "error" -> {
          val serviceCode = parsed.optJSONObject("response")?.optJSONObject("error")?.optString("code")
            ?: parsed.optJSONObject("error")?.optString("code")
            ?: parsed.optString("code")
          val classified = ChatGptProtocol.classifyStreamError(serviceCode)
          // An explicit failed/error terminal event differs from an incomplete
          // generation even when its provider-specific code is unknown.
          val code = if (classified == "ERR_CHATGPT_INCOMPLETE" && type != "response.incomplete")
            "ERR_CHATGPT_STREAM_REJECTED" else classified
          throw ChatGptFailure(code, "ChatGPT could not complete this answer.")
        }
      }
      return null
    }
    if (line.startsWith("event:")) event = line.substringAfter(':').trimStart()
    if (line.startsWith("data:")) {
      sawDataLine = true
      val part = line.substringAfter(':').trimStart()
      totalDataBytes += part.length
      require(totalDataBytes <= 8_000_000) { "ChatGPT response exceeded its size limit." }
      if (data.isNotEmpty()) data.append('\n')
      data.append(part)
    }
    return null
  }
}
