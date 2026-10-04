package io.github.gregorgregor25.t1arc.chatgpt

import android.util.Log
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject

internal data class ChatGptCredentials(
  val clientId: String,
  val subject: String,
  val email: String?,
  val accessToken: String,
  val refreshToken: String,
  val idToken: String,
  val expiresAt: Long,
  val scopes: List<String>,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "clientId" to clientId,
    "subject" to subject,
    "email" to email,
    "accessToken" to accessToken,
    "refreshToken" to refreshToken,
    "idToken" to idToken,
    "expiresAt" to expiresAt.toDouble(),
    "scopes" to scopes,
  )

  companion object {
    fun fromMap(value: Map<String, Any?>): ChatGptCredentials {
      fun required(key: String) = (value[key] as? String)?.takeIf(String::isNotBlank)
        ?: throw IllegalArgumentException("ChatGPT session is incomplete.")
      val scopes = (value["scopes"] as? List<*>)?.filterIsInstance<String>()
        ?: throw IllegalArgumentException("ChatGPT session is incomplete.")
      return ChatGptCredentials(
        required("clientId"), required("subject"), value["email"] as? String,
        required("accessToken"), required("refreshToken"), required("idToken"),
        (value["expiresAt"] as? Number)?.toLong() ?: 0L, scopes,
      )
    }
  }
}

internal class ChatGptNetwork {
  private val http = OkHttpClient.Builder()
    .followRedirects(false)
    .followSslRedirects(false)
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(90, TimeUnit.SECONDS)
    .callTimeout(150, TimeUnit.SECONDS)
    .build()
  private val authHttp = http.newBuilder()
    .readTimeout(10, TimeUnit.SECONDS)
    .callTimeout(10, TimeUnit.SECONDS)
    .build()
  private val revocationHttp = authHttp.newBuilder()
    .readTimeout(6, TimeUnit.SECONDS)
    .callTimeout(6, TimeUnit.SECONDS)
    .build()
  private val activeRequests = ConcurrentHashMap<String, Call>()
  private val cancelledRequests = ConcurrentHashMap<String, Long>()

  private fun request(builder: Request.Builder, client: OkHttpClient = authHttp): Response = try {
    client.newCall(builder.build()).execute()
  } catch (_: IOException) {
    throw ChatGptFailure("ERR_CHATGPT_UNAVAILABLE", "Could not reach ChatGPT. Check your connection and try again.")
  }

  private fun boundedBody(response: Response, maxBytes: Int = 1_000_000): String {
    val stream = response.body?.byteStream() ?: throw IllegalStateException("ChatGPT returned an empty response.")
    val out = ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (true) {
      val count = stream.read(buffer)
      if (count < 0) break
      require(out.size() + count <= maxBytes) { "ChatGPT response exceeded its size limit." }
      out.write(buffer, 0, count)
    }
    return out.toString(Charsets.UTF_8.name())
  }

  private fun checkStatus(response: Response, action: String) {
    if (response.isSuccessful) return
    // Read only structured, bounded diagnostics. Never forward the provider's
    // free-form message/detail: it may reflect the user's question or records.
    val diagnosticBody = try { JSONObject(boundedBody(response, 8192)) }
      catch (_: Exception) { null }
    val error = diagnosticBody?.optJSONObject("error")
    val serviceCode = error?.optString("code")
    val parameter = error?.optString("param")
    val suffix = when (response.code) {
      401 -> " Please reconnect your ChatGPT account."
      403 -> " Your ChatGPT plan or workspace may not allow this access."
      429 -> " Check your ChatGPT usage limits."
      else -> " Try again later."
    }
    val code = ChatGptProtocol.classifyHttpError(response.code, serviceCode, action, parameter)
    if (action == "response") {
      val safeServiceCode = when (serviceCode) {
        "invalid_request_error", "invalid_json_schema", "subscription_sharing_unsupported_capability",
        "subscription_sharing_route_not_supported", "subscription_sharing_user_not_eligible",
        "subscription_sharing_usage_limit_exceeded", "subscription_sharing_usage_unavailable",
        "subscription_sharing_user_unavailable", "subscription_sharing_invalid_user",
        "chatpass_v2_scope_not_authorized", "chatpass_v2_invalid_authorization_context" -> serviceCode
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
        diagnosticBody?.has("detail") == true -> "detail"
        diagnosticBody != null -> "other_json"
        else -> "non_json_or_empty"
      }
      Log.w("T1ArcChatGPT", "response failure HTTP ${response.code} category=$code service=$safeServiceCode parameter=$safeParameter shape=$shape")
    }
    val requestId = response.header("x-request-id")?.takeIf { it.length in 1..128 &&
      it.all { char -> char.isLetterOrDigit() || char == '-' || char == '_' } }
    val requestTag = requestId?.let { " Request ID $it." } ?: ""
    throw ChatGptFailure(code, "ChatGPT $action failed (HTTP ${response.code}).$suffix$requestTag")
  }

  private fun getJson(url: String): JSONObject = request(Request.Builder().url(url).get()).use { response ->
    checkStatus(response, "setup")
    try { JSONObject(boundedBody(response)) } catch (_: Exception) {
      throw IllegalStateException("ChatGPT returned invalid setup information.")
    }
  }

  private data class Discovery(val jwksUri: String, val revocationUri: String)

  private fun discovery(): Discovery {
    val json = getJson("$ISSUER/.well-known/openid-configuration")
    require(json.optString("issuer") == ISSUER) { "Invalid ChatGPT identity issuer." }
    return Discovery(
      ChatGptProtocol.pinnedOpenAiUri(json.getString("jwks_uri")),
      ChatGptProtocol.pinnedOpenAiUri(json.getString("revocation_endpoint")),
    )
  }

  private fun token(form: Map<String, String>): JSONObject {
    val body = ChatGptProtocol.form(form).toRequestBody("application/x-www-form-urlencoded".toMediaType())
    return request(Request.Builder().url("$ISSUER/api/accounts/oauth/token").post(body)).use { response ->
      checkStatus(response, "session")
      try { JSONObject(boundedBody(response, 100_000)) } catch (_: Exception) {
        throw IllegalStateException("ChatGPT returned an invalid session.")
      }
    }
  }

  private fun credentials(
    reply: JSONObject,
    clientId: String,
    expectedSubject: String?,
    nonce: String?,
    old: ChatGptCredentials?,
  ): ChatGptCredentials {
    val accessToken = reply.optString("access_token").takeIf(String::isNotBlank)
      ?: throw IllegalStateException("ChatGPT did not provide access.")
    val refreshToken = reply.optString("refresh_token").takeIf(String::isNotBlank)
      ?: old?.refreshToken ?: throw IllegalStateException("ChatGPT did not provide a renewable session.")
    require(reply.optString("token_type").equals("Bearer", ignoreCase = true)) { "Invalid ChatGPT session type." }
    val idToken = reply.optString("id_token").takeIf(String::isNotBlank)
      ?: old?.idToken ?: throw IllegalStateException("ChatGPT did not provide account identity.")
    val scopes = ChatGptProtocol.grantedScopes(reply, old?.scopes)
    // A valid identity without the plan scope is still a saved, disabled connection.
    // The UI can offer consent again or a different provider without losing registration.
    val seconds = reply.optLong("expires_in", 0)
    require(seconds in 1..604800) { "Invalid ChatGPT session expiry." }
    val identity = if (reply.has("id_token")) {
      val keys = getJson(discovery().jwksUri)
      ChatGptProtocol.verifyIdToken(idToken, keys, clientId, nonce, expectedSubject)
    } else {
      require(old != null && nonce == null && old.clientId == clientId && old.subject == expectedSubject) {
        "ChatGPT identity could not be verified."
      }
      ChatGptProtocol.Identity(old.subject, old.email)
    }
    return ChatGptCredentials(
      clientId, identity.subject, identity.email ?: old?.email,
      accessToken, refreshToken, idToken,
      System.currentTimeMillis() + seconds * 1000, scopes.distinct(),
    )
  }

  fun exchangeCode(
    issuedClientId: String,
    code: String,
    verifier: String,
    redirectUri: String,
    nonce: String,
    expectedSubject: String?,
  ): ChatGptCredentials {
    val reply = token(mapOf(
      "grant_type" to "authorization_code",
      "client_id" to issuedClientId,
      "code" to code,
      "code_verifier" to verifier,
      "redirect_uri" to redirectUri,
      "resource" to RESOURCE,
    ))
    return credentials(reply, issuedClientId, expectedSubject, nonce, null)
  }

  fun refresh(old: ChatGptCredentials): ChatGptCredentials {
    require(old.clientId != "dynamic_agent_client") { "Invalid ChatGPT account registration." }
    val reply = token(mapOf(
      "grant_type" to "refresh_token",
      "client_id" to old.clientId,
      "refresh_token" to old.refreshToken,
      "resource" to RESOURCE,
    ))
    return credentials(reply, old.clientId, old.subject, null, old)
  }

  fun revoke(credentials: ChatGptCredentials): Boolean {
    val endpoint = try { discovery().revocationUri } catch (_: Exception) { return false }
    val body = ChatGptProtocol.form(mapOf(
      "token" to credentials.refreshToken,
      "token_type_hint" to "refresh_token",
      "client_id" to credentials.clientId,
    )).toRequestBody("application/x-www-form-urlencoded".toMediaType())
    for (attempt in 0..2) {
      try {
        request(Request.Builder().url(endpoint).post(body), revocationHttp).use { response ->
          if (response.code == 200) return true
          if (response.code in 400..499) return false
        }
      } catch (_: Exception) { /* Revocation can be retried while the caller retains the token. */ }
      if (attempt < 2) Thread.sleep(250L shl attempt)
    }
    return false
  }

  fun listModels(accessToken: String): String {
    requireBearer(accessToken)
    return request(Request.Builder().url("https://api.openai.com/v1/models")
      .header("Authorization", "Bearer $accessToken").get()).use { response ->
      checkStatus(response, "model list")
      val json = boundedBody(response, 2_000_000)
      require(JSONObject(json).optJSONArray("models") != null) { "ChatGPT returned an invalid model list." }
      json
    }
  }

  fun response(requestId: String, accessToken: String, body: String): String {
    require(requestId.length in 1..128 && requestId.all { it.isLetterOrDigit() || it in "-_" }) {
      "Invalid ChatGPT request identifier."
    }
    requireBearer(accessToken)
    require(body.toByteArray().size <= 1_000_000) { "ChatGPT request exceeded its size limit." }
    val json = try { JSONObject(body) } catch (_: Exception) { throw IllegalArgumentException("Invalid ChatGPT request.") }
    require(json.optBoolean("stream") && json.opt("store") == false) {
      "ChatGPT requires private streamed responses."
    }
    require(json.optJSONArray("input") != null && json.optString("model").isNotBlank()) {
      "ChatGPT request needs a model and input."
    }
    val call = http.newCall(Request.Builder().url("https://api.openai.com/v1/responses")
      .header("Authorization", "Bearer $accessToken")
      .header("Accept", "text/event-stream")
      .post(body.toRequestBody("application/json".toMediaType())).build())
    require(activeRequests.putIfAbsent(requestId, call) == null) { "A ChatGPT request with this identifier is already running." }
    try {
      if (cancelledRequests.remove(requestId) != null) call.cancel()
      call.execute().use { response ->
        checkStatus(response, "response")
        if (response.header("Content-Type")?.startsWith("text/event-stream") != true) {
          throw ChatGptFailure("ERR_CHATGPT_STREAM_FORMAT", "ChatGPT did not return a response stream.")
        }
        val source = response.body?.source()
          ?: throw ChatGptFailure("ERR_CHATGPT_STREAM_FORMAT", "ChatGPT returned an empty response stream.")
        val parser = CompletedResponseParser()
        while (!source.exhausted()) {
          val line = try { source.readUtf8LineStrict(4_000_000).trimEnd('\r') }
          catch (_: java.io.EOFException) { break }
          parser.line(line)?.let { return it }
        }
        throw ChatGptFailure("ERR_CHATGPT_INCOMPLETE", "ChatGPT connection ended before the answer was complete.")
      }
    } catch (_: SocketTimeoutException) {
      throw ChatGptFailure("ERR_CHATGPT_RETRY", "ChatGPT took too long to respond. Try again.")
    } catch (error: IOException) {
      throw ChatGptFailure(
        if (call.isCanceled()) "ERR_CHATGPT_CANCELLED" else "ERR_CHATGPT_UNAVAILABLE",
        if (call.isCanceled()) "ChatGPT request cancelled." else "ChatGPT connection was interrupted.",
      )
    } finally {
      activeRequests.remove(requestId, call)
      cancelledRequests.remove(requestId)
    }
  }

  fun cancelRequest(requestId: String) {
    if (requestId.length !in 1..128 || requestId.any { !it.isLetterOrDigit() && it !in "-_" }) return
    activeRequests[requestId]?.let { it.cancel(); return }
    val now = System.currentTimeMillis()
    if (cancelledRequests.size >= 128) {
      cancelledRequests.entries.removeIf { it.value < now - 30_000 }
      if (cancelledRequests.size >= 128) cancelledRequests.keys.firstOrNull()?.let(cancelledRequests::remove)
    }
    cancelledRequests[requestId] = now
  }
  fun cancelAll() { activeRequests.values.forEach(Call::cancel) }

  private fun requireBearer(value: String) {
    require(value.isNotBlank() && value.length <= 8192 && value.none { it.isWhitespace() }) {
      "ChatGPT session is invalid. Reconnect your account."
    }
  }
}
