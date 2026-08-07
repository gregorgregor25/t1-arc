package app.daymark.glooko

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

internal data class GlookoCredentials(
  val email: String,
  val password: String,
)

/**
 * Stores the opt-in Glooko automatic-login secret entirely inside Android.
 * The AES key is non-exportable, the encrypted payload never crosses the
 * native module boundary, Android backup is disabled, and clearing the
 * credential deletes both ciphertext and key.
 */
internal class GlookoCredentialVault(context: Context) {
  companion object {
    private const val KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "t1arc_glooko_credentials_v1"
    private const val PREFERENCES = "t1arc_glooko_credentials_v1"
    private const val PAYLOAD = "encrypted_credentials"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val GCM_TAG_BITS = 128
  }

  private val preferences =
    context.applicationContext.getSharedPreferences(
      PREFERENCES,
      Context.MODE_PRIVATE,
    )

  fun save(email: String, password: String) {
    val normalisedEmail = email.trim()
    require(normalisedEmail.length in 3..320 && normalisedEmail.contains('@')) {
      "Enter a valid Glooko email address."
    }
    require(password.isNotBlank() && password.length <= 512) {
      "Enter your Glooko password."
    }
    val plaintext =
      JSONObject()
        .put("email", normalisedEmail)
        .put("password", password)
        .toString()
        .toByteArray(Charsets.UTF_8)
    try {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
      val encrypted = cipher.doFinal(plaintext)
      val encoded =
        Base64.encodeToString(cipher.iv, Base64.NO_WRAP) +
          "." +
          Base64.encodeToString(encrypted, Base64.NO_WRAP)
      check(preferences.edit().putString(PAYLOAD, encoded).commit()) {
        "Android could not retain the encrypted Glooko sign-in."
      }
    } finally {
      plaintext.fill(0)
    }
  }

  fun read(): GlookoCredentials? {
    val encoded = preferences.getString(PAYLOAD, null) ?: return null
    val separator = encoded.indexOf('.')
    if (separator <= 0 || separator >= encoded.lastIndex) return null
    return runCatching {
      val key = existingKey() ?: return null
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(
        Cipher.DECRYPT_MODE,
        key,
        GCMParameterSpec(
          GCM_TAG_BITS,
          Base64.decode(encoded.substring(0, separator), Base64.NO_WRAP),
        ),
      )
      val plaintext =
        cipher.doFinal(
          Base64.decode(
            encoded.substring(separator + 1),
            Base64.NO_WRAP,
          ),
        )
      try {
        val payload = JSONObject(plaintext.toString(Charsets.UTF_8))
        val email = payload.optString("email").trim()
        val password = payload.optString("password")
        if (
          email.length !in 3..320 ||
          !email.contains('@') ||
          password.isBlank() ||
          password.length > 512
        ) {
          null
        } else {
          GlookoCredentials(email, password)
        }
      } finally {
        plaintext.fill(0)
      }
    }.getOrElse {
      clear()
      null
    }
  }

  fun isConfigured() =
    preferences.contains(PAYLOAD) &&
      runCatching { existingKey() != null }.getOrDefault(false)

  fun maskedEmail(): String? =
    read()?.email?.let { email ->
      val at = email.indexOf('@')
      if (at <= 0) return@let "Saved account"
      val local = email.substring(0, at)
      val domain = email.substring(at + 1)
      val visible =
        when (local.length) {
          1 -> local
          2 -> "${local.first()}*"
          else -> "${local.first()}${"*".repeat((local.length - 2).coerceAtMost(6))}${local.last()}"
        }
      "$visible@$domain"
    }

  fun clear() {
    preferences.edit().clear().commit()
    runCatching {
      keyStore().apply {
        if (containsAlias(KEY_ALIAS)) deleteEntry(KEY_ALIAS)
      }
    }
  }

  private fun keyStore() =
    KeyStore.getInstance(KEYSTORE).apply { load(null) }

  private fun existingKey(): SecretKey? =
    keyStore().getKey(KEY_ALIAS, null) as? SecretKey

  private fun getOrCreateKey(): SecretKey =
    existingKey()
      ?: KeyGenerator.getInstance(
        KeyProperties.KEY_ALGORITHM_AES,
        KEYSTORE,
      ).apply {
        init(
          KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or
              KeyProperties.PURPOSE_DECRYPT,
          )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(
              KeyProperties.ENCRYPTION_PADDING_NONE,
            )
            .setRandomizedEncryptionRequired(true)
            .build(),
        )
      }.generateKey()
}
