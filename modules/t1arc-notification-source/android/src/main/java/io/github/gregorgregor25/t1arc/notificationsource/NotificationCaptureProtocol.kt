package io.github.gregorgregor25.t1arc.notificationsource

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.security.MessageDigest
import java.util.Base64
import org.json.JSONArray
import org.json.JSONObject

internal const val NOTIFICATION_QUEUE_FILE_VERSION: Byte = 1
internal const val MAX_PENDING_CAPTURES = 512
internal const val MAX_CAPTURE_TEXT_LINES = 20
internal const val MAX_CAPTURE_RECEIPTS = 200

private const val CAPTURE_TOKEN_PREFIX = "notification-capture:v1:"
private const val CAPTURE_TOKEN_DOMAIN = "t1arc.notification.capture-token.v1"
private const val MAX_CAPTURE_RECEIPTS_JSON_LENGTH = 128 * 1024
private const val MAX_SAFE_JAVASCRIPT_INTEGER = 9_007_199_254_740_991L
private val CAPTURE_TOKEN_PATTERN =
  Regex("^notification-capture:v1:[A-Za-z0-9_-]{43}$")
private val LEGACY_NOTIFICATION_ID_PATTERN = Regex("^[A-Za-z0-9_-]{43}$")
private val CAPTURE_RECEIPT_KEYS = setOf("captureToken", "id", "receivedAt")

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
  val captureToken: String
    get() = captureTokenFor(this)

  fun receipt() =
    NotificationCaptureReceipt(
      captureToken = captureToken,
      id = id,
      receivedAt = receivedAt,
    )

  fun toJson() =
    JSONObject()
      .put("id", id)
      .put("captureToken", captureToken)
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

  /** Native always emits captureToken; nullable values remain absent as the TS type promises. */
  fun toMap(): Map<String, Any> =
    buildMap {
      put("id", id)
      put("captureToken", captureToken)
      put("packageName", packageName)
      put("postedAt", postedAt.toDouble())
      notificationWhen?.let { put("notificationWhen", it.toDouble()) }
      put("receivedAt", receivedAt.toDouble())
      put("isOngoing", isOngoing)
      title?.let { put("title", it) }
      text?.let { put("text", it) }
      bigText?.let { put("bigText", it) }
      subText?.let { put("subText", it) }
      infoText?.let { put("infoText", it) }
      put("textLines", textLines)
      category?.let { put("category", it) }
      channelId?.let { put("channelId", it) }
    }

  companion object {
    /** Reads both original v1 queue JSON (without captureToken) and new v1 entries. */
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
          json.optJSONArray("textLines").toStringList(MAX_CAPTURE_TEXT_LINES),
        category = json.optStringOrNull("category"),
        channelId = json.optStringOrNull("channelId"),
      )
  }
}

internal data class NotificationCaptureReceipt(
  val captureToken: String,
  val id: String,
  val receivedAt: Long,
)

internal data class NotificationQueueAcknowledgement(
  val retained: List<NotificationCaptureEnvelope>,
  val removed: Int,
)

internal fun legacyNotificationId(
  packageName: String,
  notificationKey: String,
  postedAt: Long,
  title: String?,
  text: String?,
  bigText: String?,
): String =
  sha256Base64Url(
    listOf(
      packageName,
      notificationKey,
      postedAt.toString(),
      title.orEmpty(),
      text.orEmpty(),
      bigText.orEmpty(),
    ).joinToString("\u001f").toByteArray(Charsets.UTF_8),
  )

internal fun captureTokenFor(envelope: NotificationCaptureEnvelope): String {
  val canonical = ByteArrayOutputStream()
  DataOutputStream(canonical).use { output ->
    output.writeUTF(CAPTURE_TOKEN_DOMAIN)
    output.writeUTF(envelope.id)
    output.writeUTF(envelope.packageName)
    output.writeLong(envelope.postedAt)
    output.writeNullableLong(envelope.notificationWhen)
    output.writeLong(envelope.receivedAt)
    output.writeBoolean(envelope.isOngoing)
    output.writeNullableString(envelope.title)
    output.writeNullableString(envelope.text)
    output.writeNullableString(envelope.bigText)
    output.writeNullableString(envelope.subText)
    output.writeNullableString(envelope.infoText)
    output.writeInt(envelope.textLines.size)
    envelope.textLines.forEach(output::writeUTF)
    output.writeNullableString(envelope.category)
    output.writeNullableString(envelope.channelId)
  }
  return CAPTURE_TOKEN_PREFIX + sha256Base64Url(canonical.toByteArray())
}

internal fun retainCapturedEnvelope(
  queue: List<NotificationCaptureEnvelope>,
  envelope: NotificationCaptureEnvelope,
  maximumPending: Int = MAX_PENDING_CAPTURES,
): List<NotificationCaptureEnvelope> {
  require(maximumPending in 1..MAX_PENDING_CAPTURES) {
    "Notification capture queue bound is invalid."
  }
  val retained = queue.toMutableList()
  val duplicate = retained.indexOfFirst { it.captureToken == envelope.captureToken }
  if (duplicate >= 0) retained[duplicate] = envelope else retained += envelope
  return if (retained.size <= maximumPending) {
    retained
  } else {
    retained.takeLast(maximumPending)
  }
}

internal fun acknowledgeCapturedEnvelopes(
  queue: List<NotificationCaptureEnvelope>,
  receipts: List<NotificationCaptureReceipt>,
): NotificationQueueAcknowledgement {
  if (receipts.isEmpty()) return NotificationQueueAcknowledgement(queue, 0)
  val wanted = receipts.toSet()
  val retained = queue.filterNot { it.receipt() in wanted }
  return NotificationQueueAcknowledgement(
    retained = retained,
    removed = queue.size - retained.size,
  )
}

internal fun acknowledgeLegacyEnvelopes(
  queue: List<NotificationCaptureEnvelope>,
  ids: List<String>,
): NotificationQueueAcknowledgement {
  if (ids.isEmpty()) return NotificationQueueAcknowledgement(queue, 0)
  val wanted = ids.toSet()
  val retained = queue.filterNot { it.id in wanted }
  return NotificationQueueAcknowledgement(
    retained = retained,
    removed = queue.size - retained.size,
  )
}

internal fun parseCaptureReceipts(raw: String): List<NotificationCaptureReceipt> {
  require(raw.length <= MAX_CAPTURE_RECEIPTS_JSON_LENGTH) {
    "Notification capture receipt payload is too large."
  }
  val array =
    try {
      JSONArray(raw)
    } catch (_: Throwable) {
      throw IllegalArgumentException("Notification capture receipts must be a JSON array.")
    }
  require(array.length() <= MAX_CAPTURE_RECEIPTS) {
    "Too many notification capture receipts."
  }
  return buildList {
    for (index in 0 until array.length()) {
      val json = array.optJSONObject(index)
        ?: throw IllegalArgumentException("Notification capture receipt is not an object.")
      val keys = buildSet { json.keys().forEachRemaining(::add) }
      require(keys == CAPTURE_RECEIPT_KEYS) {
        "Notification capture receipt has invalid fields."
      }
      val captureToken = json.opt("captureToken") as? String
      val id = json.opt("id") as? String
      val receivedAt = strictReceiptTimestamp(json.opt("receivedAt"))
      require(captureToken != null && CAPTURE_TOKEN_PATTERN.matches(captureToken)) {
        "Notification capture token is invalid."
      }
      require(id != null && LEGACY_NOTIFICATION_ID_PATTERN.matches(id)) {
        "Notification capture ID is invalid."
      }
      require(receivedAt != null && receivedAt > 0) {
        "Notification capture time is invalid."
      }
      add(NotificationCaptureReceipt(captureToken, id, receivedAt))
    }
  }
}

private fun strictReceiptTimestamp(value: Any?): Long? {
  if (value !is Number) return null
  val asDouble = value.toDouble()
  if (!asDouble.isFinite() || asDouble % 1.0 != 0.0) return null
  if (asDouble < 0.0 || asDouble > MAX_SAFE_JAVASCRIPT_INTEGER.toDouble()) return null
  return asDouble.toLong()
}

private fun DataOutputStream.writeNullableLong(value: Long?) {
  writeBoolean(value != null)
  if (value != null) writeLong(value)
}

private fun DataOutputStream.writeNullableString(value: String?) {
  writeBoolean(value != null)
  if (value != null) writeUTF(value)
}

private fun sha256Base64Url(value: ByteArray): String =
  Base64.getUrlEncoder()
    .withoutPadding()
    .encodeToString(MessageDigest.getInstance("SHA-256").digest(value))

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
