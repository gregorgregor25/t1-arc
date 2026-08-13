package app.daymark.glooko

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
    private const val KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "t1arc_glooko_account_fingerprint_v1"
    private const val ALGORITHM = "HmacSHA256"

    internal fun encode(
      key: SecretKey,
      accountCode: String,
    ): String {
      require(accountCode.isNotBlank()) {
        "The Glooko account identity is unavailable."
      }
      val accountBytes = accountCode.toByteArray(Charsets.UTF_8)
      val digest =
        try {
          Mac.getInstance(ALGORITHM).run {
            init(key)
            doFinal(accountBytes)
          }
        } finally {
          accountBytes.fill(0)
        }
      return PREFIX + digest.joinToString(separator = "") { byte ->
        "%02x".format(byte.toInt() and 0xff)
      }
    }
  }

  fun forAccountCode(accountCode: String): String =
    encode(getOrCreateKey(), accountCode)

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
