package app.daymark.notificationsource

import android.app.Notification
import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.service.notification.StatusBarNotification
import android.util.AtomicFile
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal const val OMNIPOD_5_PACKAGE = "com.insulet.myblue.pdm"
private const val PREFERENCES_NAME = "daymark-notification-source-v1"
private const val CONFIGURATION_KEY = "configuration"
private const val LAST_CAPTURED_AT_KEY = "last-captured-at"
private const val LAST_PACKAGE_KEY = "last-package"
private const val LAST_ERROR_KEY = "last-error"
private const val KEY_ALIAS = "daymark.notification.capture.v1"
private const val QUEUE_FILE = "daymark-notification-capture-v1.bin"
private const val MAX_RULES = 8
private const val MAX_PENDING = 512
private const val MAX_FIELD_LENGTH = 2_000
private const val MAX_TEXT_LINES = 20
private const val FILE_VERSION: Byte = 1

internal data class NotificationCaptureRule(
  val packageName: String,
  val displayName: String,
  val captureGlucose: Boolean,
  val captureInsulin: Boolean,
  val glucoseUnit: String,
) {
  fun toJson() =
    JSONObject()
      .put("packageName", packageName)
      .put("displayName", displayName)
      .put("captureGlucose", captureGlucose)
      .put("captureInsulin", captureInsulin)
      .put("glucoseUnit", glucoseUnit)

  fun toMap() =
    mapOf(
      "packageName" to packageName,
      "displayName" to displayName,
      "captureGlucose" to captureGlucose,
      "captureInsulin" to captureInsulin,
      "glucoseUnit" to glucoseUnit,
    )
}

internal data class NotificationCaptureConfiguration(
  val enabled: Boolean,
  val rules: List<NotificationCaptureRule>,
) {
  fun toJson() =
    JSONObject()
      .put("enabled", enabled)
      .put("rules", JSONArray().apply { rules.forEach { put(it.toJson()) } })
}

internal data class NotificationCaptureEnvelope(
  val id: String,
  val packageName: String,
  val postedAt: Long,
  val notificationWhen: Long?,
  val receivedAt: Long,
  val isOngoing: Boolean,
  val title: String?,
  val text: String?,
  val bigText: String?,
  val subText: String?,
  val infoText: String?,
  val textLines: List<String>,
  val category: String?,
  val channelId: String?,
) {
  fun toJson() =
    JSONObject()
      .put("id", id)
      .put("packageName", packageName)
      .put("postedAt", postedAt)
      .put("notificationWhen", notificationWhen ?: JSONObject.NULL)
      .put("receivedAt", receivedAt)
      .put("isOngoing", isOngoing)
      .put("title", title ?: JSONObject.NULL)
      .put("text", text ?: JSONObject.NULL)
      .put("bigText", bigText ?: JSONObject.NULL)
      .put("subText", subText ?: JSONObject.NULL)
      .put("infoText", infoText ?: JSONObject.NULL)
      .put("textLines", JSONArray(textLines))
      .put("category", category ?: JSONObject.NULL)
      .put("channelId", channelId ?: JSONObject.NULL)

  fun toMap(): Map<String, Any?> =
    mapOf(
      "id" to id,
      "packageName" to packageName,
      "postedAt" to postedAt.toDouble(),
      "notificationWhen" to notificationWhen?.toDouble(),
      "receivedAt" to receivedAt.toDouble(),
      "isOngoing" to isOngoing,
      "title" to title,
      "text" to text,
      "bigText" to bigText,
      "subText" to subText,
      "infoText" to infoText,
      "textLines" to textLines,
      "category" to category,
      "channelId" to channelId,
    )

  companion object {
    fun fromJson(json: JSONObject) =
      NotificationCaptureEnvelope(
        id = json.getString("id"),
        packageName = json.getString("packageName"),
        postedAt = json.getLong("postedAt"),
        notificationWhen = json.optLongOrNull("notificationWhen"),
        receivedAt = json.getLong("receivedAt"),
        isOngoing = json.optBoolean("isOngoing"),
        title = json.optStringOrNull("title"),
        text = json.optStringOrNull("text"),
        bigText = json.optStringOrNull("bigText"),
        subText = json.optStringOrNull("subText"),
        infoText = json.optStringOrNull("infoText"),
        textLines =
          json.optJSONArray("textLines").toStringList(MAX_TEXT_LINES),
        category = json.optStringOrNull("category"),
        channelId = json.optStringOrNull("channelId"),
      )
  }
}

internal object NotificationCaptureStore {
  private val lock = Any()
  private val packagePattern = Regex("^[A-Za-z0-9_.]{3,200}$")

  private fun preferences(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  fun readConfiguration(context: Context): NotificationCaptureConfiguration {
    val raw = preferences(context).getString(CONFIGURATION_KEY, null)
      ?: return NotificationCaptureConfiguration(false, emptyList())
    return runCatching {
      val json = JSONObject(raw)
      NotificationCaptureConfiguration(
        enabled = json.optBoolean("enabled"),
        rules = parseRules(json.optJSONArray("rules") ?: JSONArray()),
      )
    }.getOrElse {
      recordError(context, "Saved notification-source settings were unreadable.")
      NotificationCaptureConfiguration(false, emptyList())
    }
  }

  fun saveConfiguration(
    context: Context,
    enabled: Boolean,
    rulesJson: String,
  ): NotificationCaptureConfiguration {
    val parsed = parseRules(JSONArray(rulesJson))
    val configuration =
      NotificationCaptureConfiguration(enabled && parsed.isNotEmpty(), parsed)
    preferences(context)
      .edit()
      .putString(CONFIGURATION_KEY, configuration.toJson().toString())
      .remove(LAST_ERROR_KEY)
      .apply()
    return configuration
  }

  private fun parseRules(array: JSONArray): List<NotificationCaptureRule> {
    val rules = mutableListOf<NotificationCaptureRule>()
    val seen = mutableSetOf<String>()
    for (index in 0 until minOf(array.length(), MAX_RULES)) {
      val json = array.optJSONObject(index) ?: continue
      val packageName = json.optString("packageName").trim()
      if (!packagePattern.matches(packageName) || !seen.add(packageName)) {
        continue
      }
      val unit =
        when (json.optString("glucoseUnit")) {
          "mmolL", "mgDl" -> json.optString("glucoseUnit")
          else -> "auto"
        }
      val captureGlucose = json.optBoolean("captureGlucose", true)
      val captureInsulin = json.optBoolean("captureInsulin", false)
      if (!captureGlucose && !captureInsulin) continue
      rules +=
        NotificationCaptureRule(
          packageName = packageName,
          displayName =
            json.optString("displayName")
              .trim()
              .take(MAX_FIELD_LENGTH)
              .ifEmpty { packageName },
          captureGlucose = captureGlucose,
          captureInsulin = captureInsulin,
          glucoseUnit = unit,
        )
    }
    return rules
  }

  fun matchingRule(
    context: Context,
    packageName: String,
  ): NotificationCaptureRule? {
    val configuration = readConfiguration(context)
    if (!configuration.enabled) return null
    return configuration.rules.firstOrNull { it.packageName == packageName }
  }

  fun append(
    context: Context,
    statusBarNotification: StatusBarNotification,
  ) {
    val rule = matchingRule(context, statusBarNotification.packageName) ?: return
    val notification = statusBarNotification.notification ?: return
    val extras = notification.extras
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)
    val text = extras.getCharSequence(Notification.EXTRA_TEXT)
    val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
    val subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)
    val infoText = extras.getCharSequence(Notification.EXTRA_INFO_TEXT)
    val textLines =
      extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
        ?.mapNotNull { cleanText(it) }
        ?.distinct()
        ?.take(MAX_TEXT_LINES)
        ?: emptyList()
    if (
      listOf(title, text, bigText, subText, infoText).all { cleanText(it) == null } &&
      textLines.isEmpty()
    ) {
      return
    }

    val receivedAt = System.currentTimeMillis()
    val identity =
      listOf(
        statusBarNotification.packageName,
        statusBarNotification.key,
        statusBarNotification.postTime.toString(),
        cleanText(title).orEmpty(),
        cleanText(text).orEmpty(),
        cleanText(bigText).orEmpty(),
      ).joinToString("\u001f")
    val envelope =
      NotificationCaptureEnvelope(
        id = sha256(identity),
        packageName = statusBarNotification.packageName,
        postedAt = statusBarNotification.postTime,
        notificationWhen = notification.`when`.takeIf { it > 0L },
        receivedAt = receivedAt,
        isOngoing = statusBarNotification.isOngoing,
        title = cleanText(title),
        text = cleanText(text),
        bigText = cleanText(bigText),
        subText = cleanText(subText),
        infoText = cleanText(infoText),
        textLines = textLines,
        category = cleanText(notification.category),
        channelId = cleanText(notification.channelId),
      )

    synchronized(lock) {
      runCatching {
        val queue = readQueue(context).toMutableList()
        val existing = queue.indexOfFirst { it.id == envelope.id }
        if (existing >= 0) queue[existing] = envelope else queue += envelope
        val retained =
          if (queue.size <= MAX_PENDING) queue else queue.takeLast(MAX_PENDING)
        writeQueue(context, retained)
        preferences(context)
          .edit()
          .putLong(LAST_CAPTURED_AT_KEY, receivedAt)
          .putString(LAST_PACKAGE_KEY, rule.packageName)
          .remove(LAST_ERROR_KEY)
          .apply()
      }.onFailure {
        recordError(context, "A selected notification could not be retained.")
      }
    }
  }

  fun peek(
    context: Context,
    requestedLimit: Int,
  ): List<NotificationCaptureEnvelope> =
    synchronized(lock) {
      runCatching {
        readQueue(context).take(requestedLimit.coerceIn(1, 200))
      }.getOrElse {
        recordError(context, "The encrypted notification queue could not be opened.")
        emptyList()
      }
    }

  fun acknowledge(
    context: Context,
    ids: List<String>,
  ): Int =
    synchronized(lock) {
      if (ids.isEmpty()) return@synchronized 0
      val wanted = ids.toSet()
      val queue = readQueue(context)
      val retained = queue.filterNot { it.id in wanted }
      val removed = queue.size - retained.size
      if (removed > 0) writeQueue(context, retained)
      removed
    }

  fun clear(context: Context): Int =
    synchronized(lock) {
      val count = readQueue(context).size
      atomicFile(context).delete()
      count
    }

  fun pendingCount(context: Context): Int =
    synchronized(lock) {
      runCatching { readQueue(context).size }.getOrDefault(0)
    }

  fun statusMetadata(context: Context): Map<String, Any?> {
    val stored = preferences(context)
    return mapOf(
      "lastCapturedAt" to
        stored.getLong(LAST_CAPTURED_AT_KEY, 0L)
          .takeIf { it > 0L }
          ?.toDouble(),
      "lastPackageName" to stored.getString(LAST_PACKAGE_KEY, null),
      "lastError" to stored.getString(LAST_ERROR_KEY, null),
    )
  }

  private fun readQueue(context: Context): List<NotificationCaptureEnvelope> {
    val file = atomicFile(context)
    val base = file.baseFile
    if (!base.exists() || base.length() == 0L) return emptyList()
    val encrypted = file.openRead().use { it.readBytes() }
    if (encrypted.size < 15 || encrypted.first() != FILE_VERSION) {
      error("Unsupported queue format.")
    }
    val ivLength = encrypted[1].toInt() and 0xff
    if (ivLength !in 12..16 || encrypted.size <= 2 + ivLength) {
      error("Invalid queue header.")
    }
    val iv = encrypted.copyOfRange(2, 2 + ivLength)
    val ciphertext = encrypted.copyOfRange(2 + ivLength, encrypted.size)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
    val plaintext = cipher.doFinal(ciphertext).toString(Charsets.UTF_8)
    val array = JSONArray(plaintext)
    return buildList {
      for (index in 0 until minOf(array.length(), MAX_PENDING)) {
        val json = array.optJSONObject(index) ?: continue
        runCatching { add(NotificationCaptureEnvelope.fromJson(json)) }
      }
    }
  }

  private fun writeQueue(
    context: Context,
    queue: List<NotificationCaptureEnvelope>,
  ) {
    val array = JSONArray().apply { queue.forEach { put(it.toJson()) } }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
    val ciphertext = cipher.doFinal(array.toString().toByteArray(Charsets.UTF_8))
    val payload =
      byteArrayOf(FILE_VERSION, cipher.iv.size.toByte()) + cipher.iv + ciphertext
    val file = atomicFile(context)
    val output = file.startWrite()
    try {
      output.write(payload)
      output.flush()
      file.finishWrite(output)
    } catch (error: Throwable) {
      file.failWrite(output)
      throw error
    }
  }

  private fun atomicFile(context: Context) =
    AtomicFile(File(context.filesDir, QUEUE_FILE))

  private fun getOrCreateKey(): SecretKey {
    val keyStore =
      KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val existing = keyStore.getKey(KEY_ALIAS, null) as? SecretKey
    if (existing != null) return existing
    val generator =
      KeyGenerator.getInstance(
        KeyProperties.KEY_ALGORITHM_AES,
        "AndroidKeyStore",
      )
    generator.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return generator.generateKey()
  }

  private fun recordError(
    context: Context,
    message: String,
  ) {
    preferences(context)
      .edit()
      .putString(LAST_ERROR_KEY, message.take(240))
      .apply()
  }

  private fun cleanText(value: CharSequence?): String? =
    value
      ?.toString()
      ?.replace(Regex("\\s+"), " ")
      ?.trim()
      ?.take(MAX_FIELD_LENGTH)
      ?.takeIf { it.isNotEmpty() }

  private fun sha256(value: String): String =
    Base64.encodeToString(
      MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)),
      Base64.NO_WRAP or Base64.URL_SAFE,
    ).trimEnd('=')
}

private fun JSONObject.optStringOrNull(key: String): String? {
  if (isNull(key)) return null
  return optString(key).takeIf { it.isNotBlank() }
}

private fun JSONObject.optLongOrNull(key: String): Long? {
  if (isNull(key) || !has(key)) return null
  return optLong(key).takeIf { it > 0L }
}

private fun JSONArray?.toStringList(limit: Int): List<String> {
  if (this == null) return emptyList()
  return buildList {
    for (index in 0 until minOf(length(), limit)) {
      optString(index).takeIf { it.isNotBlank() }?.let(::add)
    }
  }
}
