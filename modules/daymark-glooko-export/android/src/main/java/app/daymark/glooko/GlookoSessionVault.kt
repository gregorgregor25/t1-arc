package app.daymark.glooko

import android.content.Context
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.webkit.CookieManager
import java.security.KeyStore
import java.util.Locale
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

/**
 * Persists Glooko's session-only WebView cookies without exposing them outside
 * the native connector. The payload is protected by a non-exportable Android
 * Keystore key, excluded from portable backups and erased by Forget sign-in.
 */
internal class GlookoSessionVault(context: Context) {
  companion object {
    private const val KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "t1arc_glooko_session_v1"
    private const val PREFERENCES = "t1arc_glooko_session_v1"
    private const val PAYLOAD = "encrypted_cookie_origins"
    private const val REJECTED = "session_rejected"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val GCM_TAG_BITS = 128
  }

  private val preferences =
    context.applicationContext.getSharedPreferences(
      PREFERENCES,
      Context.MODE_PRIVATE,
    )

  fun capture(
    cookieManager: CookieManager,
    urls: Collection<String>,
  ): Set<String> {
    val cookieHeaders =
      (
        urls.mapNotNull(::glookoUrl) +
          listOf(
            "https://my.glooko.com/",
            "https://glooko.com/",
          )
      )
        .distinct()
        .mapNotNull { url ->
          val sessionPairs =
            cookieManager.getCookie(url)
              ?.let(::sessionCookiePairs)
              .orEmpty()
          if (sessionPairs.isEmpty()) null
          else url to sessionPairs.joinToString("; ")
        }
        .toMap()
    if (cookieHeaders.isEmpty()) return emptySet()

    val payload =
      JSONObject().apply {
        cookieHeaders.forEach { (url, header) -> put(url, header) }
      }.toString()
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
    val encrypted = cipher.doFinal(payload.toByteArray(Charsets.UTF_8))
    val encoded =
      Base64.encodeToString(cipher.iv, Base64.NO_WRAP) +
        "." +
        Base64.encodeToString(encrypted, Base64.NO_WRAP)
    preferences.edit()
      .putString(PAYLOAD, encoded)
      .remove(REJECTED)
      .commit()
    return cookieHeaders.values
      .flatMap(::cookieNames)
      .toSortedSet()
  }

  fun restore(cookieManager: CookieManager): Set<String> {
    val encoded = preferences.getString(PAYLOAD, null) ?: return emptySet()
    val separator = encoded.indexOf('.')
    if (separator <= 0 || separator >= encoded.lastIndex) return emptySet()
    return runCatching {
      val key = existingKey() ?: return emptySet()
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(
        Cipher.DECRYPT_MODE,
        key,
        GCMParameterSpec(
          GCM_TAG_BITS,
          Base64.decode(encoded.substring(0, separator), Base64.NO_WRAP),
        ),
      )
      val payload =
        JSONObject(
          cipher.doFinal(
            Base64.decode(
              encoded.substring(separator + 1),
              Base64.NO_WRAP,
            ),
          ).toString(Charsets.UTF_8),
        )
      val restoredNames = sortedSetOf<String>()
      payload.keys().forEach { storedUrl ->
        val url = glookoUrl(storedUrl) ?: return@forEach
        sessionCookiePairs(payload.optString(storedUrl))
          .forEach { pair ->
            val name = cookieName(pair) ?: return@forEach
            val attributes =
              if (name == "_logbook-web_session") {
                // This is the domain and policy used by Glooko's Rails
                // response. Replacing that exact cookie avoids a stale
                // host-only duplicate taking precedence.
                "Domain=glooko.com; Path=/; Secure; HttpOnly; SameSite=Lax"
              } else {
                "Path=/; Secure; HttpOnly; SameSite=Lax"
              }
            cookieManager.setCookie(
              url,
              "$pair; $attributes",
            )
            restoredNames += name
          }
      }
      if (restoredNames.isNotEmpty()) cookieManager.flush()
      restoredNames
    }.getOrElse {
      // A restored app installation cannot decrypt a previous device's
      // payload. Discard it and wait for the next foreground sign-in.
      preferences.edit().remove(PAYLOAD).commit()
      emptySet()
    }
  }

  fun currentSessionCookieNames(
    cookieManager: CookieManager,
  ): Set<String> =
    listOf(
      "https://my.glooko.com/",
      "https://glooko.com/",
    )
      .flatMap { url ->
        cookieManager.getCookie(url)
          ?.let(::cookieNames)
          .orEmpty()
      }
      .toSortedSet()

  fun markRejected() {
    preferences.edit().putBoolean(REJECTED, true).commit()
  }

  fun prepareInteractiveSession(
    cookieManager: CookieManager,
    forceFresh: Boolean,
    onReady: () -> Unit,
  ) {
    val resetRejectedSession =
      forceFresh ||
        preferences.getBoolean(REJECTED, false) ||
        !preferences.contains(PAYLOAD)
    if (resetRejectedSession) {
      clear()
      // Glooko is the app's only WebView-backed connector. A fully clean
      // CookieManager is the reliable recovery path for Rails/CSRF failures;
      // reconstructing individual expired variants caused duplicate session
      // cookies on some WebView versions.
      cookieManager.removeAllCookies {
        cookieManager.flush()
        onReady()
      }
      return
    }
    onReady()
  }

  fun clear() {
    preferences.edit().clear().commit()
    runCatching {
      keyStore().apply {
        if (containsAlias(KEY_ALIAS)) deleteEntry(KEY_ALIAS)
      }
    }
  }

  private fun glookoUrl(value: String): String? {
    val uri = runCatching { Uri.parse(value) }.getOrNull() ?: return null
    if (!uri.scheme.equals("https", ignoreCase = true)) return null
    val host = uri.host?.lowercase(Locale.ROOT) ?: return null
    if (host != "glooko.com" && !host.endsWith(".glooko.com")) return null
    val port =
      if (uri.port > 0 && uri.port != 443) ":${uri.port}" else ""
    val path =
      uri.encodedPath
        ?.takeIf { it.startsWith('/') }
        ?.takeIf { !it.contains('\n') && !it.contains('\r') }
        ?: "/"
    return "https://$host$port$path"
  }

  private fun sessionCookiePairs(header: String): List<String> =
    header
      .split(Regex(";\\s*"))
      .map(String::trim)
      .filter { pair ->
        val name = cookieName(pair)
        name != null && isSessionCookieName(name)
      }

  private fun cookieNames(header: String): List<String> =
    sessionCookiePairs(header).mapNotNull(::cookieName)

  private fun cookieName(pair: String): String? {
    if (
      pair.isBlank() ||
      pair.contains('\n') ||
      pair.contains('\r')
    ) {
      return null
    }
    val separator = pair.indexOf('=')
    if (separator <= 0) return null
    return pair.substring(0, separator).trim()
      .takeIf { it.matches(Regex("[A-Za-z0-9_.-]+")) }
  }

  private fun isSessionCookieName(name: String): Boolean {
    val lower = name.lowercase(Locale.ROOT)
    return lower == "_logbook-web_session" ||
      (
        lower.contains("glooko") &&
          (
            lower.contains("session") ||
              lower.contains("remember") ||
              lower.contains("auth") ||
              lower.contains("token")
          )
      )
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
