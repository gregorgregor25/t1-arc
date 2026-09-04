package io.github.gregorgregor25.t1arc.notificationsource

import android.app.Notification
import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.service.notification.StatusBarNotification
import android.util.AtomicFile
import android.view.View
import android.view.ViewGroup
import android.widget.RemoteViews
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.BadPaddingException
import javax.crypto.Cipher
import javax.crypto.IllegalBlockSizeException
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal const val OMNIPOD_5_PACKAGE = "com.insulet.myblue.pdm"
private const val PREFERENCES_NAME = "t1arc_notification_source_v1"
private const val CONFIGURATION_KEY = "configuration"
private const val LAST_CAPTURED_AT_KEY = "last-captured-at"
private const val LAST_PACKAGE_KEY = "last-package"
private const val LAST_ERROR_KEY = "last-error"
private const val KEY_ALIAS = "t1arc.notification.capture.v1"
internal const val QUEUE_FILE = "t1arc-notification-capture-v1.bin"
private const val MAX_RULES = 8
private const val MAX_FIELD_LENGTH = 2_000
private const val GCM_TAG_LENGTH_BYTES = 16

internal enum class NotificationQueueReadPath {
  EMPTY,
  OPEN_LEGACY_BACKUP,
  OPEN_ATOMIC_FILE,
}

internal fun notificationQueueReadPath(
  baseExists: Boolean,
  baseLength: Long,
  legacyBackupExists: Boolean,
  pendingNewExists: Boolean,
): NotificationQueueReadPath =
  when {
    // Read the last committed queue without consuming its recovery marker. A
    // later successful AtomicFile write will promote/replace it safely.
    legacyBackupExists -> NotificationQueueReadPath.OPEN_LEGACY_BACKUP
    baseExists && baseLength > 0L -> NotificationQueueReadPath.OPEN_ATOMIC_FILE
    // A .new file without a base or backup is an unfinished first write, not a
    // committed queue. Keep it available for AtomicFile's next write attempt.
    pendingNewExists -> NotificationQueueReadPath.EMPTY
    else -> NotificationQueueReadPath.EMPTY
  }

internal enum class NotificationQueueFailure {
  STRUCTURALLY_INCOMPLETE,
  CIPHERTEXT_AUTHENTICATION_FAILED,
  AUTHENTICATED_PAYLOAD_INVALID,
  TRANSIENT_IO_OR_PROVIDER,
}

internal enum class NotificationQueueFailureAction {
  PRESERVE,
  DISCARD_EXACT_ARTIFACTS,
}

internal fun notificationQueueFailureAction(
  failure: NotificationQueueFailure,
): NotificationQueueFailureAction =
  when (failure) {
    NotificationQueueFailure.STRUCTURALLY_INCOMPLETE ->
      NotificationQueueFailureAction.DISCARD_EXACT_ARTIFACTS
    NotificationQueueFailure.CIPHERTEXT_AUTHENTICATION_FAILED ->
      NotificationQueueFailureAction.DISCARD_EXACT_ARTIFACTS
    NotificationQueueFailure.AUTHENTICATED_PAYLOAD_INVALID,
    NotificationQueueFailure.TRANSIENT_IO_OR_PROVIDER,
    -> NotificationQueueFailureAction.PRESERVE
  }

internal fun deleteExactNotificationQueueArtifacts(artifacts: List<File>): Boolean {
  artifacts.forEach { artifact ->
    runCatching {
      if (artifact.exists()) artifact.delete()
    }
  }
  return artifacts.none(File::exists)
}

private class IncompleteNotificationQueueException(message: String) :
  IllegalStateException(message)

private class UnauthenticatedNotificationQueueException(cause: Throwable) :
  IllegalStateException("The encrypted notification queue could not be authenticated.", cause)

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

internal object NotificationCaptureStore {
  private val coordinator = NotificationCaptureCoordinator()
  private val packagePattern = Regex("^[A-Za-z0-9_.]{3,200}$")

  private fun preferences(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  fun readConfiguration(context: Context): NotificationCaptureConfiguration =
    coordinator.serially { readConfigurationUnlocked(context) }

  fun readConfigurationSnapshot(
    context: Context,
  ): NotificationCaptureConfigurationSnapshot =
    coordinator.configurationSnapshot { readConfigurationUnlocked(context) }

  private fun readConfigurationUnlocked(context: Context): NotificationCaptureConfiguration {
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

  private fun beginCapture(
    context: Context,
    packageName: String,
  ): NotificationCaptureAdmission? =
    coordinator.beginCapture(packageName) { readConfigurationUnlocked(context) }

  fun append(
    context: Context,
    statusBarNotification: StatusBarNotification,
  ) {
    val admission = beginCapture(context, statusBarNotification.packageName) ?: return
    val notification = statusBarNotification.notification ?: return
    val extras = notification.extras
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)
    val text = extras.getCharSequence(Notification.EXTRA_TEXT)
    val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
    val subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)
    val infoText = extras.getCharSequence(Notification.EXTRA_INFO_TEXT)
    val textLines =
      (
        extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
          ?.mapNotNull { cleanText(it) }
          .orEmpty() +
          remoteViewText(context, notification.contentView) +
          remoteViewText(context, notification.bigContentView) +
          remoteViewText(context, notification.headsUpContentView)
      )
        .distinct()
        .take(MAX_CAPTURE_TEXT_LINES)
    if (
      listOf(title, text, bigText, subText, infoText).all { cleanText(it) == null } &&
      textLines.isEmpty()
    ) {
      return
    }

    val receivedAt = System.currentTimeMillis()
    val cleanedTitle = cleanText(title)
    val cleanedText = cleanText(text)
    val cleanedBigText = cleanText(bigText)
    val envelope =
      NotificationCaptureEnvelope(
        id =
          legacyNotificationId(
            packageName = statusBarNotification.packageName,
            notificationKey = statusBarNotification.key,
            postedAt = statusBarNotification.postTime,
            title = cleanedTitle,
            text = cleanedText,
            bigText = cleanedBigText,
          ),
        packageName = statusBarNotification.packageName,
        postedAt = statusBarNotification.postTime,
        notificationWhen = notification.`when`.takeIf { it > 0L },
        receivedAt = receivedAt,
        isOngoing = statusBarNotification.isOngoing,
        title = cleanedTitle,
        text = cleanedText,
        bigText = cleanedBigText,
        subText = cleanText(subText),
        infoText = cleanText(infoText),
        textLines = textLines,
        category = cleanText(notification.category),
        channelId = cleanText(notification.channelId),
      )

    coordinator.appendIfCurrent(
      admission = admission,
      readConfiguration = { readConfigurationUnlocked(context) },
    ) { currentRule ->
      runCatching {
        val retained = retainCapturedEnvelope(readQueue(context), envelope)
        writeQueue(context, retained)
        check(
          preferences(context)
            .edit()
            .putLong(LAST_CAPTURED_AT_KEY, receivedAt)
            .putString(LAST_PACKAGE_KEY, currentRule.packageName)
            .remove(LAST_ERROR_KEY)
            .commit(),
        ) {
          "Notification capture metadata could not be persisted."
        }
      }.onFailure {
        recordError(context, "A selected notification could not be retained.")
      }
    }
  }

  fun replaceConfigurationAndClear(
    context: Context,
    enabled: Boolean,
    rulesJson: String,
  ): NotificationCaptureConfiguration {
    // Validate the complete desired value before the destructive transition.
    val parsed = parseRules(JSONArray(rulesJson))
    val desired =
      NotificationCaptureConfiguration(enabled && parsed.isNotEmpty(), parsed)
    return coordinator.replaceConfigurationAndClear(
      configuration = desired,
      persistStagingDisabled = { staging ->
        preferences(context)
          .edit()
          .putString(CONFIGURATION_KEY, staging.toJson().toString())
          .remove(LAST_CAPTURED_AT_KEY)
          .remove(LAST_PACKAGE_KEY)
          .remove(LAST_ERROR_KEY)
          .commit()
      },
      eraseQueueAndVerify = {
        cryptographicallyEraseCapturedQueue(
          destroyKey = ::destroyQueueKey,
          keyExists = ::queueKeyExists,
          deleteArtifactsBestEffort = { deleteQueueArtifactsBestEffort(context) },
        )
      },
      persistDesired = { configuration ->
        preferences(context)
          .edit()
          .putString(CONFIGURATION_KEY, configuration.toJson().toString())
          .remove(LAST_ERROR_KEY)
          .commit()
      },
    )
  }

  private fun remoteViewText(context: Context, remoteViews: RemoteViews?): List<String> {
    if (remoteViews == null) return emptyList()
    return runCatching {
      buildList {
        collectText(remoteViews.apply(context, null), this)
      }
    }.getOrElse { emptyList() }
  }

  private fun collectText(view: View, values: MutableList<String>) {
    if (values.size >= MAX_CAPTURE_TEXT_LINES) return
    if (view is TextView) {
      cleanText(view.text)?.let { text ->
        val resourceLabel =
          runCatching {
            view.resources.getResourceEntryName(view.id)
              .replace('_', ' ')
              .replace('-', ' ')
              .trim()
          }.getOrNull()
        values +=
          if (resourceLabel.isNullOrEmpty()) text else "$resourceLabel: $text"
      }
      if (values.size >= MAX_CAPTURE_TEXT_LINES) return
    }
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) {
        collectText(view.getChildAt(index), values)
        if (values.size >= MAX_CAPTURE_TEXT_LINES) return
      }
    }
  }

  fun peek(
    context: Context,
    requestedLimit: Int,
  ): List<NotificationCaptureEnvelope> =
    coordinator.serially {
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
    coordinator.serially {
      if (ids.isEmpty()) return@serially 0
      val queue = readQueue(context)
      val result = acknowledgeLegacyEnvelopes(queue, ids)
      if (result.removed > 0) writeQueue(context, result.retained)
      result.removed
    }

  fun acknowledgeCaptured(
    context: Context,
    receiptsJson: String,
  ): Int {
    val receipts = parseCaptureReceipts(receiptsJson)
    return coordinator.serially {
      if (receipts.isEmpty()) return@serially 0
      val queue = readQueue(context)
      val result = acknowledgeCapturedEnvelopes(queue, receipts)
      if (result.removed > 0) writeQueue(context, result.retained)
      result.removed
    }
  }

  fun clear(context: Context): Int =
    coordinator.serially {
      val count = readQueue(context).size
      atomicFile(context).delete()
      count
    }

  fun disableAndClear(context: Context): Int =
    coordinator.disableAndClear(
      pendingCount = { readQueue(context).size },
      persistDisabledAndClearMetadata = { disabled ->
        preferences(context)
          .edit()
          .putString(CONFIGURATION_KEY, disabled.toJson().toString())
          .remove(LAST_CAPTURED_AT_KEY)
          .remove(LAST_PACKAGE_KEY)
          .remove(LAST_ERROR_KEY)
          .commit()
      },
      eraseQueueAndVerify = {
        cryptographicallyEraseCapturedQueue(
          destroyKey = ::destroyQueueKey,
          keyExists = ::queueKeyExists,
          deleteArtifactsBestEffort = { deleteQueueArtifactsBestEffort(context) },
        )
      },
    )

  fun pendingCount(context: Context): Int =
    coordinator.serially {
      runCatching { readQueue(context).size }.getOrElse {
        recordError(context, "The encrypted notification queue could not be opened.")
        0
      }
    }

  fun statusMetadata(context: Context): Map<String, Any?> =
    coordinator.serially {
      val stored = preferences(context)
      mapOf(
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
    val artifacts = queueArtifactFiles(context)
    if (artifacts.none(File::exists)) return emptyList()
    val base = file.baseFile
    val legacyBackup = File(base.path + ".bak")
    val hadLegacyBackup = legacyBackup.exists()
    val key = existingQueueKey()
    if (key == null) {
      deleteQueueArtifactsAndVerify(context)
      return emptyList()
    }
    val readPath =
      notificationQueueReadPath(
        baseExists = base.exists(),
        baseLength = base.length(),
        legacyBackupExists = hadLegacyBackup,
        pendingNewExists = File(base.path + ".new").exists(),
      )
    val encrypted =
      when (readPath) {
        NotificationQueueReadPath.EMPTY -> return emptyList()
        NotificationQueueReadPath.OPEN_LEGACY_BACKUP ->
          legacyBackup.inputStream().use { it.readBytes() }
        NotificationQueueReadPath.OPEN_ATOMIC_FILE ->
          file.openRead().use { it.readBytes() }
      }
    return try {
      decodeQueue(encrypted, key)
    } catch (failure: IncompleteNotificationQueueException) {
      recoverUnusableQueue(
        context = context,
        failure = NotificationQueueFailure.STRUCTURALLY_INCOMPLETE,
        cause = failure,
      )
    } catch (failure: UnauthenticatedNotificationQueueException) {
      recoverUnusableQueue(
        context = context,
        failure = NotificationQueueFailure.CIPHERTEXT_AUTHENTICATION_FAILED,
        cause = failure,
      )
    }
  }

  private fun decodeQueue(
    encrypted: ByteArray,
    key: SecretKey,
  ): List<NotificationCaptureEnvelope> {
    if (encrypted.size < 2) {
      throw IncompleteNotificationQueueException("The queue header is incomplete.")
    }
    if (encrypted.first() != NOTIFICATION_QUEUE_FILE_VERSION) {
      error("Unsupported queue format.")
    }
    val ivLength = encrypted[1].toInt() and 0xff
    if (
      ivLength !in 12..16 ||
      encrypted.size < 2 + ivLength + GCM_TAG_LENGTH_BYTES
    ) {
      throw IncompleteNotificationQueueException("The queue payload is incomplete.")
    }
    val iv = encrypted.copyOfRange(2, 2 + ivLength)
    val ciphertext = encrypted.copyOfRange(2 + ivLength, encrypted.size)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
    val plaintext =
      try {
        cipher.doFinal(ciphertext).toString(Charsets.UTF_8)
      } catch (failure: BadPaddingException) {
        throw UnauthenticatedNotificationQueueException(failure)
      } catch (failure: IllegalBlockSizeException) {
        throw UnauthenticatedNotificationQueueException(failure)
      }
    val array = JSONArray(plaintext)
    return buildList {
      for (index in 0 until minOf(array.length(), MAX_PENDING_CAPTURES)) {
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
      byteArrayOf(NOTIFICATION_QUEUE_FILE_VERSION, cipher.iv.size.toByte()) +
        cipher.iv + ciphertext
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

  private fun queueArtifactFiles(context: Context): List<File> {
    val base = atomicFile(context).baseFile
    return listOf(
      base,
      File(base.path + ".bak"),
      File(base.path + ".new"),
    )
  }

  private fun deleteQueueArtifactsBestEffort(context: Context) {
    deleteExactNotificationQueueArtifacts(queueArtifactFiles(context))
  }

  private fun deleteQueueArtifactsAndVerify(context: Context) {
    check(deleteExactNotificationQueueArtifacts(queueArtifactFiles(context))) {
      "Unreadable notification queue artifacts could not be removed."
    }
  }

  private fun recoverUnusableQueue(
    context: Context,
    failure: NotificationQueueFailure,
    cause: Throwable,
  ): List<NotificationCaptureEnvelope> {
    if (
      notificationQueueFailureAction(failure) !=
      NotificationQueueFailureAction.DISCARD_EXACT_ARTIFACTS
    ) {
      throw cause
    }
    deleteQueueArtifactsAndVerify(context)
    recordError(
      context,
      "An unrecoverable encrypted notification queue was discarded safely.",
    )
    return emptyList()
  }

  private fun queueKeyStore(): KeyStore =
    KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun existingQueueKey(): SecretKey? {
    val keyStore = queueKeyStore()
    if (!keyStore.containsAlias(KEY_ALIAS)) return null
    return checkNotNull(keyStore.getKey(KEY_ALIAS, null) as? SecretKey) {
      "The encrypted notification queue key could not be opened."
    }
  }

  private fun queueKeyExists(): Boolean = queueKeyStore().containsAlias(KEY_ALIAS)

  private fun destroyQueueKey() {
    val keyStore = queueKeyStore()
    if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS)
  }

  private fun getOrCreateKey(): SecretKey {
    val keyStore = queueKeyStore()
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
      .commit()
  }

  private fun cleanText(value: CharSequence?): String? =
    value
      ?.toString()
      ?.replace(Regex("\\s+"), " ")
      ?.trim()
      ?.take(MAX_FIELD_LENGTH)
      ?.takeIf { it.isNotEmpty() }

}
