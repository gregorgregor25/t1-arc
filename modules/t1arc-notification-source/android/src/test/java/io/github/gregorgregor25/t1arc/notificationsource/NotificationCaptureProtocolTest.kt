package io.github.gregorgregor25.t1arc.notificationsource

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationCaptureProtocolTest {
  private fun envelope(
    id: String = "mvD1C6ubhZ3C9KhtIYKJdIfeH3r8ss6Lxs6LYV9NHtA",
    receivedAt: Long = 1_723_648_500_500L,
    text: String? = "IOB 1.25 U",
  ) =
    NotificationCaptureEnvelope(
      id = id,
      packageName = "com.insulet.myblue.pdm",
      postedAt = 1_723_648_500_000L,
      notificationWhen = 1_723_648_499_000L,
      receivedAt = receivedAt,
      isOngoing = true,
      title = "7.2 mmol/L",
      text = text,
      bigText = "Automated Mode",
      subText = "Sensor current",
      infoText = "Updated now",
      textLines = listOf("7.2 mmol/L", "IOB 1.25 U"),
      category = "status",
      channelId = "pump-status",
    )

  @Test
  fun legacyNotificationIdKeepsItsExistingContract() {
    assertEquals(
      "mvD1C6ubhZ3C9KhtIYKJdIfeH3r8ss6Lxs6LYV9NHtA",
      legacyNotificationId(
        packageName = "com.insulet.myblue.pdm",
        notificationKey = "notification-key",
        postedAt = 1_723_648_500_000L,
        title = "7.2 mmol/L",
        text = "IOB 1.25 U",
        bigText = "Automated Mode",
      ),
    )
  }

  @Test
  fun captureTokenIsStableAndCoversEveryRetainedField() {
    val original = envelope()
    assertEquals(original.captureToken, original.copy().captureToken)
    assertTrue(
      original.captureToken.matches(
        Regex("^notification-capture:v1:[A-Za-z0-9_-]{43}$"),
      ),
    )

    val changes =
      listOf(
        original.copy(id = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
        original.copy(packageName = "com.example.other"),
        original.copy(postedAt = original.postedAt + 1),
        original.copy(notificationWhen = null),
        original.copy(receivedAt = original.receivedAt + 1),
        original.copy(isOngoing = false),
        original.copy(title = "Different title"),
        original.copy(text = "IOB 2 U"),
        original.copy(bigText = null),
        original.copy(subText = null),
        original.copy(infoText = null),
        original.copy(textLines = original.textLines.reversed()),
        original.copy(category = null),
        original.copy(channelId = null),
      )
    changes.forEach { changed ->
      assertNotEquals(original.captureToken, changed.captureToken)
    }
  }

  @Test
  fun exactDuplicatesCollapseButChangedSameIdentityCapturesRemain() {
    val original = envelope()
    val exactDuplicate = original.copy()
    val sameIdAndMillisecondDifferentText = original.copy(text = "IOB 2 U")
    val sameIdNewCaptureTime = original.copy(receivedAt = original.receivedAt + 1)

    var queue = retainCapturedEnvelope(emptyList(), original, 512)
    queue = retainCapturedEnvelope(queue, exactDuplicate, 512)
    assertEquals(listOf(original.captureToken), queue.map { it.captureToken })

    queue = retainCapturedEnvelope(queue, sameIdAndMillisecondDifferentText, 512)
    queue = retainCapturedEnvelope(queue, sameIdNewCaptureTime, 512)
    assertEquals(3, queue.size)
    assertEquals(1, queue.map { it.id }.distinct().size)
    assertEquals(3, queue.map { it.captureToken }.distinct().size)
  }

  @Test
  fun captureQueueKeepsTheNewest512ExactObservations() {
    val captures =
      (0..MAX_PENDING_CAPTURES).map { offset ->
        envelope(receivedAt = envelope().receivedAt + offset)
      }

    val queue =
      captures.fold(emptyList<NotificationCaptureEnvelope>()) { retained, capture ->
        retainCapturedEnvelope(retained, capture)
      }

    assertEquals(MAX_PENDING_CAPTURES, queue.size)
    assertEquals(captures.drop(1).map { it.captureToken }, queue.map { it.captureToken })
  }

  @Test
  fun exactReceiptAcknowledgesOldCaptureWithoutRemovingNewSameIdCapture() {
    val old = envelope()
    val replacement = old.copy(text = "IOB 2 U")
    val newer = old.copy(receivedAt = old.receivedAt + 60_000)
    val queue = listOf(old, replacement, newer)

    val result =
      acknowledgeCapturedEnvelopes(
        queue,
        listOf(old.receipt()),
      )

    assertEquals(1, result.removed)
    assertEquals(
      listOf(replacement.captureToken, newer.captureToken),
      result.retained.map { it.captureToken },
    )
  }

  @Test
  fun conditionalAcknowledgementHandlesMixedAndDuplicateReceiptsExactly() {
    val first = envelope()
    val second = first.copy(receivedAt = first.receivedAt + 1)
    val third = first.copy(receivedAt = first.receivedAt + 2)
    val mismatched = first.receipt().copy(receivedAt = first.receivedAt + 99)

    val result =
      acknowledgeCapturedEnvelopes(
        listOf(first, second, third),
        listOf(first.receipt(), first.receipt(), third.receipt(), mismatched),
      )

    assertEquals(2, result.removed)
    assertEquals(listOf(second.captureToken), result.retained.map { it.captureToken })
  }

  @Test
  fun legacyAcknowledgementStillRemovesEveryCaptureWithTheRequestedLegacyId() {
    val first = envelope()
    val second = first.copy(receivedAt = first.receivedAt + 1)
    val other = envelope(id = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")

    val result =
      acknowledgeLegacyEnvelopes(
        listOf(first, second, other),
        listOf(first.id),
      )

    assertEquals(2, result.removed)
    assertEquals(listOf(other.id), result.retained.map { it.id })
  }

  @Test
  fun v1QueueJsonWithoutCaptureTokenRoundTripsAndDerivesToken() {
    val oldJson =
      JSONObject()
        .put("id", envelope().id)
        .put("packageName", "com.insulet.myblue.pdm")
        .put("postedAt", 1_723_648_500_000L)
        .put("notificationWhen", JSONObject.NULL)
        .put("receivedAt", 1_723_648_500_500L)
        .put("isOngoing", true)
        .put("title", "7.2 mmol/L")
        .put("text", "IOB 1.25 U")
        .put("bigText", JSONObject.NULL)
        .put("subText", JSONObject.NULL)
        .put("infoText", JSONObject.NULL)
        .put("textLines", JSONArray(listOf("IOB 1.25 U")))
        .put("category", JSONObject.NULL)
        .put("channelId", JSONObject.NULL)

    val restored = NotificationCaptureEnvelope.fromJson(oldJson)
    val rewritten = restored.toJson()

    assertNull(restored.notificationWhen)
    assertNull(restored.bigText)
    assertTrue(restored.captureToken.startsWith("notification-capture:v1:"))
    assertEquals(restored.captureToken, rewritten.getString("captureToken"))
    assertEquals(restored, NotificationCaptureEnvelope.fromJson(rewritten))
    assertEquals("t1arc-notification-capture-v1.bin", QUEUE_FILE)
    assertEquals(1.toByte(), NOTIFICATION_QUEUE_FILE_VERSION)
  }

  @Test
  fun bridgeMapIncludesTokenAndOmitsNullableKeys() {
    val map =
      envelope()
        .copy(
          notificationWhen = null,
          title = null,
          bigText = null,
          subText = null,
          infoText = null,
          category = null,
          channelId = null,
        ).toMap()

    assertEquals(envelope().id, map["id"])
    assertTrue(map["captureToken"] is String)
    assertFalse(map.containsKey("notificationWhen"))
    assertFalse(map.containsKey("title"))
    assertFalse(map.containsKey("bigText"))
    assertFalse(map.containsKey("subText"))
    assertFalse(map.containsKey("infoText"))
    assertFalse(map.containsKey("category"))
    assertFalse(map.containsKey("channelId"))
  }

  @Test
  fun receiptJsonValidationIsStrictAndBounded() {
    val receipt = envelope().receipt()
    val valid =
      JSONArray()
        .put(
          JSONObject()
            .put("captureToken", receipt.captureToken)
            .put("id", receipt.id)
            .put("receivedAt", receipt.receivedAt),
        ).toString()
    assertEquals(listOf(receipt), parseCaptureReceipts(valid))

    val invalidReceipts =
      listOf(
        "{}",
        JSONArray().put(JSONObject().put("captureToken", receipt.captureToken)).toString(),
        JSONArray()
          .put(
            JSONObject()
              .put("captureToken", receipt.captureToken)
              .put("id", receipt.id)
              .put("receivedAt", receipt.receivedAt)
              .put("extra", true),
          ).toString(),
        JSONArray()
          .put(
            JSONObject()
              .put("captureToken", "not-a-token")
              .put("id", receipt.id)
              .put("receivedAt", receipt.receivedAt),
          ).toString(),
        JSONArray()
          .put(
            JSONObject()
              .put("captureToken", receipt.captureToken)
              .put("id", "")
              .put("receivedAt", receipt.receivedAt),
          ).toString(),
        JSONArray()
          .put(
            JSONObject()
              .put("captureToken", receipt.captureToken)
              .put("id", receipt.id)
              .put("receivedAt", 1.5),
          ).toString(),
      )
    invalidReceipts.forEach { raw ->
      assertThrows(IllegalArgumentException::class.java) {
        parseCaptureReceipts(raw)
      }
    }

    val tooMany = JSONArray()
    repeat(MAX_CAPTURE_RECEIPTS + 1) {
      tooMany.put(
        JSONObject()
          .put("captureToken", receipt.captureToken)
          .put("id", receipt.id)
          .put("receivedAt", receipt.receivedAt),
      )
    }
    assertThrows(IllegalArgumentException::class.java) {
      parseCaptureReceipts(tooMany.toString())
    }
    assertThrows(IllegalArgumentException::class.java) {
      parseCaptureReceipts(" ".repeat(128 * 1024 + 1))
    }
  }
}
