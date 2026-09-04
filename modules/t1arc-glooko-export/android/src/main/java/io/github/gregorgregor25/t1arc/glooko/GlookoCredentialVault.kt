package io.github.gregorgregor25.t1arc.glooko

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.time.ZoneId
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

internal data class GlookoCredentials(
  val email: String,
  val password: String,
  val region: GlookoRegion = GlookoRegion.EU,
  val timeZone: ZoneId,
  val credentialGeneration: Long,
)

private data class StoredGlookoCredentials(
  val email: String,
  val password: String,
  val region: GlookoRegion,
  val timeZone: ZoneId,
)

internal fun validatedGlookoCredentialTimeZone(value: String?): ZoneId? =
  value
    ?.takeIf(String::isNotBlank)
    ?.let { candidate -> runCatching { ZoneId.of(candidate) }.getOrNull() }

internal fun glookoCredentialContractConfigured(
  hasStoredCredentials: Boolean,
  regionalFormatConfirmed: Boolean,
  timeZone: String?,
): Boolean =
  hasStoredCredentials &&
    regionalFormatConfirmed &&
    validatedGlookoCredentialTimeZone(timeZone) != null

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
    private const val MASKED_EMAIL = "masked_email"
    private const val REGION = "region"
    private const val TIME_ZONE = "time_zone"
    private const val REGIONAL_FORMAT_CONFIRMED = "regional_format_confirmed"
    private const val CREDENTIAL_GENERATION = "credential_generation"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val GCM_TAG_BITS = 128
    private const val MAX_SAFE_JS_GENERATION = 9_007_199_254_740_991L
  }

  private val preferences =
    context.applicationContext.getSharedPreferences(
      PREFERENCES,
      Context.MODE_PRIVATE,
    )

  fun save(
    email: String,
    password: String,
    region: GlookoRegion = GlookoRegion.EU,
    timeZone: String,
    regionalFormatConfirmed: Boolean,
  ) = GlookoCredentialCommitGate.mutateCredentials {
    require(regionalFormatConfirmed) {
      "Confirm that this Glooko account uses the selected regional date and time format."
    }
    val validatedTimeZone = ZoneId.of(timeZone)
    val normalisedEmail = email.trim()
    require(normalisedEmail.length in 3..320 && normalisedEmail.contains('@')) {
      "Enter a valid Glooko email address."
    }
    require(password.isNotBlank() && password.length <= 512) {
      "Enter your Glooko password."
    }
    val nextGeneration = nextGeneration()
    persistEncryptedCredentials(
      email = normalisedEmail,
      password = password,
      region = region,
      timeZone = validatedTimeZone,
      credentialGeneration = nextGeneration,
    )
  }

  private fun persistEncryptedCredentials(
    email: String,
    password: String,
    region: GlookoRegion,
    timeZone: ZoneId,
    credentialGeneration: Long,
  ) {
    val plaintext =
      JSONObject()
        .put("email", email)
        .put("password", password)
        .put("region", region.name.lowercase())
        .put("timeZone", timeZone.id)
        .put("credentialGeneration", credentialGeneration)
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
      check(
        preferences.edit()
          .putString(PAYLOAD, encoded)
          .putString(MASKED_EMAIL, maskEmail(email))
          .putString(REGION, region.name.lowercase())
          .putString(TIME_ZONE, timeZone.id)
          .putBoolean(REGIONAL_FORMAT_CONFIRMED, true)
          .putLong(CREDENTIAL_GENERATION, credentialGeneration)
          .commit(),
      ) {
        "Android could not retain the encrypted Glooko sign-in."
      }
    } finally {
      plaintext.fill(0)
    }
  }

  fun read(): GlookoCredentials? =
    GlookoCredentialCommitGate.readCredentials { readUnlocked() }

  private fun readUnlocked(): GlookoCredentials? {
    if (!isConfigured()) return null
    val observedGeneration = credentialGeneration()
    val expectedRegion = region() ?: return null
    val expectedTimeZone = timeZone() ?: return null
    val stored = decryptStoredCredentials() ?: return null
    if (
      stored.region != expectedRegion ||
      stored.timeZone != expectedTimeZone
    ) {
      return null
    }
    return GlookoCredentials(
      email = stored.email,
      password = stored.password,
      region = stored.region,
      timeZone = stored.timeZone,
      credentialGeneration = observedGeneration,
    )
  }

  private fun decryptStoredCredentials(): StoredGlookoCredentials? {
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
        val region =
          runCatching {
            GlookoRegion.valueOf(
              payload.optString("region", "eu").uppercase(),
            )
          }.getOrDefault(GlookoRegion.EU)
        val timeZone =
          validatedGlookoCredentialTimeZone(
            payload.optString("timeZone").takeIf(String::isNotBlank),
          ) ?: return@runCatching null
        if (
          email.length !in 3..320 ||
          !email.contains('@') ||
          password.isBlank() ||
          password.length > 512
        ) {
          null
        } else {
          StoredGlookoCredentials(email, password, region, timeZone)
        }
      } finally {
        plaintext.fill(0)
      }
    }.getOrNull()
  }

  fun hasStoredCredentials() =
    preferences.contains(PAYLOAD) &&
      runCatching { existingKey() != null }.getOrDefault(false)

  fun isConfigured() =
    glookoCredentialContractConfigured(
      hasStoredCredentials = hasStoredCredentials(),
      regionalFormatConfirmed =
        preferences.getBoolean(REGIONAL_FORMAT_CONFIRMED, false),
      timeZone = preferences.getString(TIME_ZONE, null),
    )

  /**
   * Non-secret, monotonic account epoch. It deliberately survives clear so
   * an archive produced with deleted credentials can never match a later
   * account after reconfiguration.
   */
  fun credentialGeneration(): Long {
    val stored = preferences.getLong(CREDENTIAL_GENERATION, 0L)
    return if (stored > 0L) {
      stored
    } else if (preferences.contains(PAYLOAD)) {
      1L
    } else {
      0L
    }
  }

  fun maskedEmail(): String? =
    preferences.getString(MASKED_EMAIL, null)?.takeIf(String::isNotBlank)

  fun storedRegion(): GlookoRegion? {
    if (!hasStoredCredentials()) return null
    return runCatching {
      GlookoRegion.valueOf(
        preferences.getString(REGION, "eu").orEmpty().uppercase(),
      )
    }.getOrDefault(GlookoRegion.EU)
  }

  fun region(): GlookoRegion? = storedRegion()?.takeIf { isConfigured() }

  fun timeZone(): ZoneId? =
    validatedGlookoCredentialTimeZone(
      preferences.getString(TIME_ZONE, null),
    )?.takeIf { isConfigured() }

  fun clear() = GlookoCredentialCommitGate.mutateCredentials {
    val nextGeneration = nextGeneration()
    check(
      preferences.edit()
        .remove(PAYLOAD)
        .remove(MASKED_EMAIL)
        .remove(REGION)
        .remove(TIME_ZONE)
        .remove(REGIONAL_FORMAT_CONFIRMED)
        .putLong(CREDENTIAL_GENERATION, nextGeneration)
        .commit(),
    ) {
      "Android could not clear the encrypted Glooko sign-in."
    }
    runCatching {
      keyStore().apply {
        if (containsAlias(KEY_ALIAS)) deleteEntry(KEY_ALIAS)
      }
    }
  }

  fun finishDataReset(token: String): Boolean =
    GlookoCredentialCommitGate.finishDataReset(token) {
      val nextGeneration = nextGeneration()
      check(
        preferences.edit()
          .putLong(CREDENTIAL_GENERATION, nextGeneration)
          .commit(),
      ) {
        "Android could not revoke the previous Glooko data generation."
      }
    }

  private fun nextGeneration(): Long {
    val current = credentialGeneration()
    check(current < MAX_SAFE_JS_GENERATION) {
      "The Glooko credential generation counter is exhausted."
    }
    return current + 1L
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

  private fun maskEmail(email: String): String {
    val at = email.indexOf('@')
    if (at <= 0) return "Saved account"
    val local = email.substring(0, at)
    val domain = email.substring(at + 1)
    val visible =
      when (local.length) {
        1 -> local
        2 -> "${local.first()}*"
        else -> "${local.first()}${"*".repeat((local.length - 2).coerceAtMost(6))}${local.last()}"
      }
    return "$visible@$domain"
  }
}
