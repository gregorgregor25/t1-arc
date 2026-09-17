package io.github.gregorgregor25.t1arc.glooko

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey

/**
 * Produces an opaque, installation-specific account identity for the bridge.
 * The Glooko account code itself never leaves the native connector. Because
 * the HMAC key is random and non-exportable, the persisted value cannot be
 * compared across installations or reversed with an offline code dictionary.
 */
internal class GlookoAccountFingerprint {
  companion object {
    internal const val PREFIX = "af1_"
    internal const val REPORT_SUBJECT_PREFIX = "rs1_"
    private const val KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "t1arc_glooko_account_fingerprint_v1"
    private const val ALGORITHM = "HmacSHA256"

    private fun digest(
      key: SecretKey,
      value: String,
    ): String {
      require(value.isNotBlank()) {
        "The Glooko account identity is unavailable."
      }
      val accountBytes = value.toByteArray(Charsets.UTF_8)
      val digest =
        try {
          Mac.getInstance(ALGORITHM).run {
            init(key)
            doFinal(accountBytes)
          }
        } finally {
          accountBytes.fill(0)
        }
      return digest.joinToString(separator = "") { byte ->
        "%02x".format(byte.toInt() and 0xff)
      }
    }

    internal fun encode(
      key: SecretKey,
      accountCode: String,
    ): String = PREFIX + digest(key, accountCode)

    internal fun encodeReportSubject(
      key: SecretKey,
      subject: String,
    ): String = REPORT_SUBJECT_PREFIX + digest(key, "report-subject-v1|$subject")
  }

  fun forAccountCode(accountCode: String): String =
    encode(getOrCreateKey(), accountCode)

  fun forReportSubject(subject: String): String =
    encodeReportSubject(getOrCreateKey(), subject)

  private fun keyStore() =
    KeyStore.getInstance(KEYSTORE).apply { load(null) }

  private fun existingKey(): SecretKey? =
    keyStore().getKey(KEY_ALIAS, null) as? SecretKey

  private fun getOrCreateKey(): SecretKey =
    existingKey()
      ?: KeyGenerator.getInstance(
        KeyProperties.KEY_ALGORITHM_HMAC_SHA256,
        KEYSTORE,
      ).apply {
        init(
          KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_SIGN,
          )
            .setDigests(KeyProperties.DIGEST_SHA256)
            .build(),
        )
      }.generateKey()
}
