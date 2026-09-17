package io.github.gregorgregor25.t1arc.tarvisdirect

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import java.io.ByteArrayInputStream
import java.net.Socket
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Principal
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.spec.ECGenParameterSpec
import javax.net.ssl.SSLEngine
import javax.net.ssl.X509ExtendedKeyManager

internal class TarvisKeyStoreIdentity(private val context: Context) {
  private val preferences =
    context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  fun installationId(): String {
    preferences.getString(INSTALLATION_ID, null)?.let { return it }
    val bytes = ByteArray(24).also(SecureRandom()::nextBytes)
    val created = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    check(preferences.edit().putString(INSTALLATION_ID, created).commit()) {
      "The private installation identifier could not be saved."
    }
    return created
  }

  fun createAttestedKey(challenge: ByteArray): List<String> {
    require(challenge.size in 16..128) { "The enrolment challenge is invalid." }
    keyStore().deleteEntry(KEY_ALIAS)
    val strongBoxCreated =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        try {
          generateKey(challenge, strongBox = true)
          true
        } catch (_: StrongBoxUnavailableException) {
          false
        } catch (_: java.security.ProviderException) {
          false
        }
      } else {
        false
      }
    if (!strongBoxCreated) {
      keyStore().deleteEntry(KEY_ALIAS)
      generateKey(challenge, strongBox = false)
    }
    val chain = keyStore().getCertificateChain(KEY_ALIAS)
      ?: throw IllegalStateException("Android did not return a key-attestation chain.")
    require(chain.size in 2..8) { "Android returned an invalid key-attestation chain." }
    return chain.map { certificate ->
      Base64.encodeToString(certificate.encoded, Base64.NO_WRAP)
    }
  }

  fun saveIssuedCertificateChain(chainPem: List<String>, expiresAtMs: Long) {
    require(chainPem.size in 1..4) { "The issued certificate chain is invalid." }
    val issuedChain = parseCertificates(chainPem)
    val attestedCertificate = keyStore().getCertificate(KEY_ALIAS) as? X509Certificate
      ?: throw IllegalStateException("The hardware-backed key is unavailable.")
    require(issuedChain.first().publicKey.encoded.contentEquals(attestedCertificate.publicKey.encoded)) {
      "The issued certificate does not belong to this phone's hardware-backed key."
    }
    issuedChain.first().checkValidity()
    val leafExpiry = issuedChain.first().notAfter.time
    require(kotlin.math.abs(leafExpiry - expiresAtMs) <= 60_000L) {
      "The issued certificate expiry is inconsistent."
    }
    check(
      preferences.edit()
        .putString(CERTIFICATE_CHAIN, chainPem.joinToString(CHAIN_SEPARATOR))
        .putLong(CERTIFICATE_EXPIRY, minOf(leafExpiry, expiresAtMs))
        .commit(),
    ) { "The issued client certificate could not be saved." }
  }

  fun certificateExpiresAtMs(): Long? {
    val value = preferences.getLong(CERTIFICATE_EXPIRY, 0L)
    return value.takeIf { it > 0L }
  }

  fun isEnrolled(nowMs: Long = System.currentTimeMillis()): Boolean =
    keyStore().containsAlias(KEY_ALIAS) &&
      issuedCertificateChainOrNull() != null &&
      (certificateExpiresAtMs() ?: 0L) > nowMs + 10_000L

  fun keyManager(): X509ExtendedKeyManager {
    val privateKey = keyStore().getKey(KEY_ALIAS, null) as? PrivateKey
      ?: throw IllegalStateException("The hardware-backed private key is unavailable.")
    val chain = issuedCertificateChainOrNull()
      ?: throw IllegalStateException("The issued client certificate is unavailable.")
    chain.first().checkValidity()
    return FixedIdentityKeyManager(KEY_ALIAS, privateKey, chain.toTypedArray())
  }

  fun clear() {
    keyStore().deleteEntry(KEY_ALIAS)
    preferences.edit()
      .remove(CERTIFICATE_CHAIN)
      .remove(CERTIFICATE_EXPIRY)
      .apply()
  }

  private fun generateKey(challenge: ByteArray, strongBox: Boolean) {
    val builder =
      KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN)
        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
        .setDigests(
          KeyProperties.DIGEST_NONE,
          KeyProperties.DIGEST_SHA256,
          KeyProperties.DIGEST_SHA384,
          KeyProperties.DIGEST_SHA512,
        )
        .setAttestationChallenge(challenge)
        .setUserAuthenticationRequired(false)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      builder.setIsStrongBoxBacked(strongBox)
    }
    KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEY_STORE).apply {
      initialize(builder.build())
      generateKeyPair()
    }
  }

  private fun issuedCertificateChainOrNull(): List<X509Certificate>? {
    val encoded = preferences.getString(CERTIFICATE_CHAIN, null) ?: return null
    return runCatching { parseCertificates(encoded.split(CHAIN_SEPARATOR)) }.getOrNull()
  }

  private fun parseCertificates(pemValues: List<String>): List<X509Certificate> {
    val factory = CertificateFactory.getInstance("X.509")
    return pemValues.map { pem ->
      require(pem.length in 100..32_768 && pem.contains("BEGIN CERTIFICATE")) {
        "The issued certificate is invalid."
      }
      factory.generateCertificate(ByteArrayInputStream(pem.toByteArray(Charsets.US_ASCII)))
        as X509Certificate
    }
  }

  private fun keyStore(): KeyStore =
    KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }

  companion object {
    private const val ANDROID_KEY_STORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "t1arc_tarvis_direct_mtls_poc_v1"
    private const val PREFERENCES = "t1arc_tarvis_direct_identity_v1"
    private const val INSTALLATION_ID = "installation_id"
    private const val CERTIFICATE_CHAIN = "certificate_chain"
    private const val CERTIFICATE_EXPIRY = "certificate_expiry"
    private const val CHAIN_SEPARATOR = "\n--T1ARC-CERTIFICATE--\n"
  }
}

private class FixedIdentityKeyManager(
  private val alias: String,
  private val privateKey: PrivateKey,
  private val chain: Array<X509Certificate>,
) : X509ExtendedKeyManager() {
  override fun getClientAliases(keyType: String?, issuers: Array<out Principal>?): Array<String> =
    if (keyType == null || keyType.startsWith("EC", ignoreCase = true)) arrayOf(alias) else emptyArray()

  override fun chooseClientAlias(
    keyType: Array<out String>?,
    issuers: Array<out Principal>?,
    socket: Socket?,
  ): String? = if (keyType == null || keyType.any { it.startsWith("EC", ignoreCase = true) }) alias else null

  override fun chooseEngineClientAlias(
    keyType: Array<out String>?,
    issuers: Array<out Principal>?,
    engine: SSLEngine?,
  ): String? = chooseClientAlias(keyType, issuers, null)

  override fun getServerAliases(keyType: String?, issuers: Array<out Principal>?): Array<String>? = null

  override fun chooseServerAlias(keyType: String?, issuers: Array<out Principal>?, socket: Socket?): String? = null

  override fun chooseEngineServerAlias(
    keyType: String?,
    issuers: Array<out Principal>?,
    engine: SSLEngine?,
  ): String? = null

  override fun getCertificateChain(requestedAlias: String?): Array<X509Certificate>? =
    chain.takeIf { requestedAlias == alias }

  override fun getPrivateKey(requestedAlias: String?): PrivateKey? =
    privateKey.takeIf { requestedAlias == alias }
}
