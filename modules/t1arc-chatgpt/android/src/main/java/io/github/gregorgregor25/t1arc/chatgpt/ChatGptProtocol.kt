package io.github.gregorgregor25.t1arc.chatgpt

import java.math.BigInteger
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
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

  fun classifyHttpError(status: Int, serviceCode: String?, action: String): String = when {
    serviceCode == "subscription_sharing_usage_limit_exceeded" || status == 429 -> "ERR_CHATGPT_QUOTA"
    serviceCode == "subscription_sharing_usage_unavailable" ||
      serviceCode == "subscription_sharing_user_unavailable" || status == 503 -> "ERR_CHATGPT_RETRY"
    serviceCode == "subscription_sharing_unsupported_capability" -> "ERR_CHATGPT_UNSUPPORTED"
    serviceCode == "subscription_sharing_route_not_supported" -> "ERR_CHATGPT_ROUTE"
    serviceCode == "subscription_sharing_user_not_eligible" || status == 403 -> "ERR_CHATGPT_RESTRICTED"
    action == "session" && serviceCode == "invalid_grant" -> "ERR_CHATGPT_INVALID_GRANT"
    status == 401 || (action == "session" && status == 400) -> "ERR_CHATGPT_AUTH"
    else -> "ERR_CHATGPT_RESPONSE"
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
internal class CompletedResponseParser {
  private var event = ""
  private val data = StringBuilder()
  private var totalDataBytes = 0

  fun line(line: String): String? {
    require(line.length <= 4_000_000) { "ChatGPT response exceeded its size limit." }
    if (line.isEmpty()) {
      if (data.isEmpty()) { event = ""; return null }
      val parsed = try { JSONObject(data.toString()) } catch (_: Exception) {
        throw IllegalStateException("ChatGPT returned an invalid response.")
      }
      val type = parsed.optString("type").ifBlank { event }
      event = ""
      data.clear()
      when (type) {
        "response.completed" -> {
          val response = parsed.optJSONObject("response")
            ?: throw IllegalStateException("ChatGPT did not complete its response.")
          require(response.optString("status") == "completed") { "ChatGPT did not complete its response." }
          return response.toString()
        }
        "response.failed", "response.incomplete", "error" -> {
          val serviceCode = parsed.optJSONObject("response")?.optJSONObject("error")?.optString("code")
            ?: parsed.optJSONObject("error")?.optString("code")
            ?: parsed.optString("code")
          throw ChatGptFailure(ChatGptProtocol.classifyStreamError(serviceCode), "ChatGPT could not complete this answer.")
        }
      }
      return null
    }
    if (line.startsWith("event:")) event = line.substringAfter(':').trimStart()
    if (line.startsWith("data:")) {
      val part = line.substringAfter(':').trimStart()
      totalDataBytes += part.length
      require(totalDataBytes <= 8_000_000) { "ChatGPT response exceeded its size limit." }
      if (data.isNotEmpty()) data.append('\n')
      data.append(part)
    }
    return null
  }
}
