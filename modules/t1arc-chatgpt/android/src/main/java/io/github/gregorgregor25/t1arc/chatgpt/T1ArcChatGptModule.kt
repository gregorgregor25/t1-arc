package io.github.gregorgregor25.t1arc.chatgpt

import android.content.Intent
import android.net.Uri
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedInputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.SocketTimeoutException
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class T1ArcChatGptModule : Module() {
  private val network = ChatGptNetwork()
  private val attemptLock = Any()
  private var attempt: AuthAttempt? = null
  private var pendingTransaction: AuthTransaction? = null
  private var inFlightTransaction: AuthTransaction? = null
  private val expiryTimer = Executors.newSingleThreadScheduledExecutor { runnable ->
    Thread(runnable, "t1arc-chatgpt-auth-expiry").apply { isDaemon = true }
  }

  override fun definition() = ModuleDefinition {
    Name("T1ArcChatGpt")

    OnDestroy {
      cancelActiveAttempt()
      network.cancelAll()
      expiryTimer.shutdownNow()
    }

    Function("isAvailable") { true }

    AsyncFunction("signIn") Coroutine { options: Map<String, Any?> ->
      safe { withContext(Dispatchers.IO) { signIn(options) } }
    }

    AsyncFunction("completeSignIn") Coroutine { transactionId: String ->
      safe { withContext(Dispatchers.IO) { completeSignIn(transactionId) } }
    }

    AsyncFunction("cancelSignIn") Coroutine { ->
      cancelActiveAttempt()
    }

    AsyncFunction("refreshSession") Coroutine { input: Map<String, Any?> ->
      safe { withContext(Dispatchers.IO) { network.refresh(ChatGptCredentials.fromMap(input)).toMap() } }
    }

    AsyncFunction("revokeSession") Coroutine { input: Map<String, Any?> ->
      safe { withContext(Dispatchers.IO) { network.revoke(ChatGptCredentials.fromMap(input)) } }
    }

    AsyncFunction("listModels") Coroutine { accessToken: String ->
      safe { withContext(Dispatchers.IO) { network.listModels(accessToken) } }
    }

    AsyncFunction("request") Coroutine { input: Map<String, Any?> ->
      safe {
        withContext(Dispatchers.IO) {
          val requestId = required(input, "requestId")
          val token = required(input, "accessToken")
          val body = required(input, "body")
          network.response(requestId, token, body)
        }
      }
    }

    AsyncFunction("cancelRequest") Coroutine { requestId: String ->
      network.cancelRequest(requestId)
    }
  }

  private fun required(values: Map<String, Any?>, key: String): String =
    (values[key] as? String)?.takeIf(String::isNotBlank)
      ?: throw IllegalArgumentException("ChatGPT input is incomplete.")

  private suspend fun <T> safe(block: suspend () -> T): T = try {
    block()
  } catch (error: CodedException) {
    throw error
  } catch (error: ChatGptFailure) {
    throw CodedException(error.code, error.message ?: "ChatGPT request failed.", null)
  } catch (error: Exception) {
    val protocolFailure = error is IllegalArgumentException || error is IllegalStateException ||
      error is org.json.JSONException
    throw CodedException(
      if (protocolFailure) "ERR_CHATGPT_RESPONSE" else "ERR_CHATGPT_UNAVAILABLE",
      if (protocolFailure) "ChatGPT returned invalid account or response information." else "ChatGPT connection failed. Please try again.",
      null,
    )
  }

  private class AuthAttempt(val listener: ServerSocket) {
    val cancelled = AtomicBoolean(false)
    fun cancel() {
      cancelled.set(true)
      closeListener()
    }
    fun closeListener() { try { listener.close() } catch (_: Exception) {} }
  }

  private class AuthTransaction(
    val id: String,
    val clientId: String,
    val code: String,
    val verifier: String,
    val redirectUri: String,
    val nonce: String,
    val expectedSubject: String?,
  ) {
    val cancelled = AtomicBoolean(false)
    val expiresAtNano = System.nanoTime() + 5L * 60L * 1_000_000_000L
  }

  private fun cancelActiveAttempt() = synchronized(attemptLock) {
    attempt?.cancel()
    pendingTransaction?.cancelled?.set(true)
    pendingTransaction = null
    inFlightTransaction?.cancelled?.set(true)
  }

  private suspend fun signIn(options: Map<String, Any?>): Map<String, Any?> {
    val hostId = required(options, "hostId")
    require(hostId.length <= 512 && hostId.none { it.isISOControl() }) { "Invalid ChatGPT host identity." }
    val selectedClient = (options["clientId"] as? String)?.takeIf(String::isNotBlank) ?: "dynamic_agent_client"
    require(selectedClient.length <= 512 && selectedClient.none { it.isWhitespace() }) {
      "Invalid ChatGPT registration."
    }
    val expectedSubject = options["expectedSubject"] as? String
    require((selectedClient == "dynamic_agent_client" && expectedSubject == null) ||
      selectedClient != "dynamic_agent_client") {
      "Invalid ChatGPT account selection."
    }
    require(expectedSubject == null || expectedSubject.isNotBlank()) { "Invalid ChatGPT account selection." }
    val hint = (options["idTokenHint"] as? String)?.takeIf(String::isNotBlank)
    require(hint == null || (selectedClient != "dynamic_agent_client" && expectedSubject != null && hint.length <= 16_384)) {
      "Invalid ChatGPT account hint."
    }
    val requestConsent = options["requestConsent"] == true
    require(!requestConsent || (selectedClient != "dynamic_agent_client" && expectedSubject != null)) {
      "Invalid ChatGPT consent request."
    }
    val state = ChatGptProtocol.randomUrlSafe()
    val nonce = ChatGptProtocol.randomUrlSafe()
    val verifier = ChatGptProtocol.randomUrlSafe(48)

    // Bind before browser launch. Only this device's loopback can reach the callback.
    val listener = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
    listener.soTimeout = 1000
    val active = AuthAttempt(listener)
    synchronized(attemptLock) {
      cancelActiveAttempt()
      attempt = active
    }
    val redirect = "http://127.0.0.1:${listener.localPort}/auth/callback"
    try {
      val query = linkedMapOf(
        "client_id" to selectedClient,
        "ext_agent_host_id" to hostId,
        "response_type" to "code",
        "redirect_uri" to redirect,
        "scope" to "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
        "resource" to RESOURCE,
        "state" to state,
        "nonce" to nonce,
        "code_challenge_method" to "S256",
        "code_challenge" to ChatGptProtocol.pkceChallenge(verifier),
      )
      if (selectedClient == "dynamic_agent_client") query["agent_name_hint"] = "T1 Arc"
      if (hint != null) query["id_token_hint"] = hint
      if (requestConsent) query["prompt"] = "consent"
      val authorizeUrl = "$ISSUER/api/accounts/authorize?${ChatGptProtocol.form(query)}"
      withContext(Dispatchers.Main) {
        val context = requireNotNull(appContext.reactContext) { "ChatGPT sign-in is unavailable." }
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(authorizeUrl)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      val callback = waitForCallback(active, state, selectedClient)
      if (active.cancelled.get()) throw ChatGptFailure("ERR_CHATGPT_CANCELLED", "ChatGPT sign-in cancelled.")
      if (callback.error != null) {
        throw ChatGptFailure("ERR_CHATGPT_AUTH", "ChatGPT access was not granted. You can enable app access in ChatGPT settings.")
      }
      val issuedClient = callback.clientId ?: selectedClient
      val transaction = AuthTransaction(
        ChatGptProtocol.randomUrlSafe(24), issuedClient, requireNotNull(callback.code),
        verifier, redirect, nonce, expectedSubject,
      )
      synchronized(attemptLock) {
        if (active.cancelled.get() || attempt !== active) {
          throw ChatGptFailure("ERR_CHATGPT_CANCELLED", "ChatGPT sign-in cancelled.")
        }
        pendingTransaction = transaction
        expiryTimer.schedule({ synchronized(attemptLock) {
          if (pendingTransaction === transaction) {
            transaction.cancelled.set(true)
            pendingTransaction = null
          }
        } }, 5, TimeUnit.MINUTES)
      }
      return mapOf("transactionId" to transaction.id, "clientId" to transaction.clientId)
    } finally {
      active.closeListener()
      synchronized(attemptLock) { if (attempt === active) attempt = null }
    }
  }

  private fun completeSignIn(transactionId: String): Map<String, Any?> {
    val transaction = synchronized(attemptLock) {
      val pending = pendingTransaction
      require(pending != null && pending.id == transactionId &&
        !pending.cancelled.get() && System.nanoTime() < pending.expiresAtNano) {
        "ChatGPT authorization expired. Please start sign-in again."
      }
      pendingTransaction = null
      inFlightTransaction = pending
      pending
    }
    try {
      val credentials = network.exchangeCode(
        transaction.clientId, transaction.code, transaction.verifier,
        transaction.redirectUri, transaction.nonce, transaction.expectedSubject,
      )
      if (transaction.cancelled.get()) {
        // A code exchange can complete after sign-out. Revoke that newly issued grant.
        network.revoke(credentials)
        throw ChatGptFailure("ERR_CHATGPT_CANCELLED", "ChatGPT sign-in cancelled.")
      }
      return credentials.toMap()
    } finally {
      synchronized(attemptLock) { if (inFlightTransaction === transaction) inFlightTransaction = null }
    }
  }

  private fun waitForCallback(active: AuthAttempt, state: String, selectedClient: String): ChatGptProtocol.Callback {
    val deadline = System.nanoTime() + 180L * 1_000_000_000L
    while (System.nanoTime() < deadline && !active.cancelled.get()) {
      val socket = try { active.listener.accept() }
      catch (_: SocketTimeoutException) { continue }
      catch (_: SocketException) { break }
      try {
        socket.soTimeout = 5000
        if (!socket.inetAddress.isLoopbackAddress) { sendPage(socket, 400, "Invalid callback."); continue }
        val request = try { readCallbackRequest(socket, active.listener.localPort) }
        catch (_: Exception) { sendPage(socket, 400, "Invalid callback."); continue }
        val callback = try { ChatGptProtocol.callback(request, state, selectedClient) }
        catch (_: Exception) { sendPage(socket, 400, "Invalid callback."); continue }
        sendPage(socket, 200, if (callback.error == null) "Authorization received. Return to T1 Arc to finish connecting." else "ChatGPT authorization was cancelled. Return to T1 Arc.")
        return callback
      } finally {
        socket.close()
      }
    }
    if (active.cancelled.get()) throw ChatGptFailure("ERR_CHATGPT_CANCELLED", "ChatGPT sign-in cancelled.")
    throw ChatGptFailure("ERR_CHATGPT_UNAVAILABLE", "ChatGPT sign-in timed out. Please try again.")
  }

  private fun readCallbackRequest(socket: Socket, port: Int): String {
    val input = BufferedInputStream(socket.getInputStream())
    val first = readLine(input, 8192)
    val parts = first.split(' ')
    require(parts.size == 3 && parts[0] == "GET" && parts[2].startsWith("HTTP/1.")) { "Invalid callback." }
    var host: String? = null
    var headerBytes = 0
    while (true) {
      val line = readLine(input, 8192)
      headerBytes += line.length
      require(headerBytes <= 16_384) { "Invalid callback." }
      if (line.isEmpty()) break
      if (line.startsWith("Host:", ignoreCase = true)) {
        require(host == null) { "Invalid callback." }
        host = line.substringAfter(':').trim()
      }
    }
    require(host == "127.0.0.1:$port") { "Invalid callback." }
    return parts[1]
  }

  private fun readLine(input: BufferedInputStream, max: Int): String {
    val bytes = java.io.ByteArrayOutputStream()
    while (bytes.size() < max) {
      val next = input.read()
      require(next >= 0) { "Invalid callback." }
      if (next == 10) return String(bytes.toByteArray(), StandardCharsets.US_ASCII).trimEnd('\r')
      bytes.write(next)
    }
    throw IllegalArgumentException("Invalid callback.")
  }

  private fun sendPage(socket: Socket, status: Int, message: String) {
    try {
      val body = "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><title>T1 Arc</title><p>$message</p>"
      val bytes = body.toByteArray(StandardCharsets.UTF_8)
      val statusText = if (status == 200) "OK" else "Bad Request"
      val headers = "HTTP/1.1 $status $statusText\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
      socket.getOutputStream().write(headers.toByteArray(StandardCharsets.US_ASCII))
      socket.getOutputStream().write(bytes)
      socket.getOutputStream().flush()
    } catch (_: Exception) {}
  }
}
