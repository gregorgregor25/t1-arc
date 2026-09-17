package io.github.gregorgregor25.t1arc.tarvisdirect

import android.content.Context
import android.util.Base64
import java.io.Reader
import java.security.KeyStore
import java.security.SecureRandom
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

internal class TarvisDirectClient(
  context: Context,
  private val clock: () -> Long = System::currentTimeMillis,
  private val enrollmentClient: OkHttpClient = defaultClient(),
) {
  private val identity = TarvisKeyStoreIdentity(context.applicationContext)
  @Volatile private var accessToken: String? = null
  @Volatile private var tokenExpiresAtMs: Long? = null

  fun status(enabled: Boolean): Map<String, Any?> =
    mapOf(
      "enabled" to enabled,
      "enrolled" to identity.isEnrolled(clock()),
      "certificateExpiresAtMs" to identity.certificateExpiresAtMs()?.toDouble(),
      "tokenExpiresAtMs" to tokenExpiresAtMs?.toDouble(),
    )

  fun enroll(baseUrl: String, bearer: String): Map<String, Any> {
    val installationId = identity.installationId()
    val challengeResponse = execute(
      enrollmentClient,
      TarvisDirectProtocol.challengeRequest(baseUrl, bearer, installationId),
      TarvisDirectProtocol.MAX_ENROLLMENT_BYTES,
    )
    val challengeJson = JSONObject(challengeResponse)
    val challengeId = challengeJson.getString("challengeId")
    val challenge = decodeCanonicalBase64(challengeJson.getString("challengeBase64"), 128)
    val attestation = identity.createAttestedKey(challenge)
    val certificateResponse = execute(
      enrollmentClient,
      TarvisDirectProtocol.certificateRequest(
        baseUrl,
        bearer,
        installationId,
        challengeId,
        attestation,
      ),
      TarvisDirectProtocol.MAX_ENROLLMENT_BYTES,
    )
    val result = JSONObject(certificateResponse)
    val chainJson = result.getJSONArray("certificateChainPem")
    val chain = (0 until chainJson.length()).map(chainJson::getString)
    val expiresAtMs = result.getLong("expiresAtMs")
    val securityLevel = result.getString("attestationSecurityLevel")
    require(securityLevel == "strongbox" || securityLevel == "trusted-environment") {
      "The enrolment response has an invalid attestation security level."
    }
    identity.saveIssuedCertificateChain(chain, expiresAtMs)
    clearToken()
    return mapOf(
      "enrolled" to true,
      "certificateExpiresAtMs" to expiresAtMs.toDouble(),
      "attestationSecurityLevel" to securityLevel,
    )
  }

  fun exchangeToken(identityProviderId: String, serviceAccountId: String): Map<String, Any> {
    require(identity.isEnrolled(clock())) {
      "A current hardware-bound client certificate is required."
    }
    val result = JSONObject(
      execute(
        mutualTlsClient(),
        TarvisDirectProtocol.tokenRequest(identityProviderId, serviceAccountId),
        TarvisDirectProtocol.MAX_ENROLLMENT_BYTES,
      ),
    )
    val token = result.getString("access_token")
    require(token.length in 20..16_384 && !token.contains('\n') && !token.contains('\r')) {
      "OpenAI returned an invalid access token."
    }
    val expiresInSeconds = result.getLong("expires_in")
    require(expiresInSeconds in 1..3_600) { "OpenAI returned an invalid token lifetime." }
    val expiresAt = Math.addExact(clock(), Math.multiplyExact(expiresInSeconds, 1_000L))
    accessToken = token
    tokenExpiresAtMs = expiresAt
    return mapOf("tokenExpiresAtMs" to expiresAt.toDouble())
  }

  fun createResponse(
    model: String,
    inputJson: String,
    toolsJson: String,
    textFormatJson: String,
    maxOutputTokens: Int,
    reasoningEffort: String,
    toolChoice: String,
  ): String {
    val token = accessToken
      ?.takeIf { (tokenExpiresAtMs ?: 0L) > clock() + 15_000L }
      ?: throw IllegalStateException("The short-lived OpenAI access token is missing or expired.")
    return execute(
      mutualTlsClient(),
      TarvisDirectProtocol.responseRequest(
        token,
        model,
        inputJson,
        toolsJson,
        textFormatJson,
        maxOutputTokens,
        reasoningEffort,
        toolChoice,
      ),
      TarvisDirectProtocol.MAX_RESPONSE_BYTES,
    )
  }

  fun clear() {
    clearToken()
    identity.clear()
  }

  private fun mutualTlsClient(): OkHttpClient {
    val trustManagerFactory =
      TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply {
        init(null as KeyStore?)
      }
    val trustManager = trustManagerFactory.trustManagers
      .filterIsInstance<X509TrustManager>()
      .singleOrNull()
      ?: throw IllegalStateException("The Android TLS trust manager is unavailable.")
    val sslContext = SSLContext.getInstance("TLS")
    sslContext.init(arrayOf(identity.keyManager()), arrayOf(trustManager), SecureRandom())
    return defaultClient().newBuilder()
      .sslSocketFactory(sslContext.socketFactory, trustManager)
      .build()
  }

  private fun clearToken() {
    accessToken = null
    tokenExpiresAtMs = null
  }

  private fun decodeCanonicalBase64(value: String, maximumBytes: Int): ByteArray {
    require(value.matches(Regex("^[A-Za-z0-9+/]+={0,2}$"))) {
      "The enrolment challenge is invalid."
    }
    val decoded = Base64.decode(value, Base64.DEFAULT)
    require(decoded.isNotEmpty() && decoded.size <= maximumBytes) {
      "The enrolment challenge is invalid."
    }
    require(Base64.encodeToString(decoded, Base64.NO_WRAP) == value) {
      "The enrolment challenge is invalid."
    }
    return decoded
  }

  companion object {
    internal fun defaultClient(): OkHttpClient =
      OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .callTimeout(150, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)
        .build()

    internal fun execute(client: OkHttpClient, request: Request, limitBytes: Long): String {
      client.newCall(request).execute().use { response ->
        val body = response.body
          ?: throw IllegalStateException("The remote service returned an empty response.")
        val text = body.charStream().use { readBounded(it, limitBytes) }
        if (!response.isSuccessful) {
          throw IllegalStateException(TarvisDirectProtocol.errorMessage(response.code, text))
        }
        return text
      }
    }

    private fun readBounded(reader: Reader, limitBytes: Long): String {
      require(limitBytes in 1..Int.MAX_VALUE.toLong())
      val result = StringBuilder()
      val buffer = CharArray(8 * 1024)
      var approximateBytes = 0L
      while (true) {
        val read = reader.read(buffer)
        if (read < 0) break
        approximateBytes += read.toLong() * 4L
        if (approximateBytes > limitBytes) {
          throw IllegalStateException("The remote response exceeded the safety limit.")
        }
        result.append(buffer, 0, read)
      }
      return result.toString()
    }
  }
}
