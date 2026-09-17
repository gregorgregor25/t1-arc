package io.github.gregorgregor25.t1arc.glucosedisplay

import android.app.NotificationManager
import androidx.core.app.NotificationCompat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidAutoNotificationPolicyTest {
  private fun contentIdentity(
    timestampMs: Long? = 1_000L,
    value: Double? = 5.9,
    trend: String? = "flat",
    history: List<CarNotificationHistoryPointIdentity> = emptyList(),
  ) =
    CarNotificationContentIdentity(
      available = timestampMs != null && value != null,
      readingTimestampMs = timestampMs,
      valueBits = value?.let(java.lang.Double::doubleToLongBits),
      trend = trend,
      trendOrigin = "provider",
      sourceLabel = "LibreLinkUp",
      sourceHasError = false,
      history = history,
    )

  private fun persistedPolicy(
    notificationPosted: Boolean = true,
    dismissedForSession: Boolean = !notificationPosted,
    sessionToken: String = "session-7",
    lastAlertElapsedRealtimeMs: Long? = 5_000L,
    lastPostElapsedRealtimeMs: Long? = 5_000L,
    messageEventWallClockMs: Long? = lastAlertElapsedRealtimeMs?.let { 999_000L },
    savedAtElapsedRealtimeMs: Long = 6_000L,
    savedAtWallClockMs: Long = 1_000_000L,
    bootSessionId: String = "boot-count:7",
  ) =
    PersistedCarNotificationPolicy(
      notificationPosted = notificationPosted,
      dismissedForSession = dismissedForSession,
      sessionToken = sessionToken,
      lastAlertElapsedRealtimeMs = lastAlertElapsedRealtimeMs,
      lastPostElapsedRealtimeMs = lastPostElapsedRealtimeMs,
      messageEventWallClockMs = messageEventWallClockMs,
      savedAtElapsedRealtimeMs = savedAtElapsedRealtimeMs,
      savedAtWallClockMs = savedAtWallClockMs,
      bootSessionId = bootSessionId,
    )

  @Test
  fun `only first post of fresh projection is alert eligible`() {
    val transition =
      transitionCarNotificationConnection(
        state = CarNotificationSessionState(),
        connected = true,
      )
    val firstDecision =
      decideCarNotificationPost(
        state = transition.state,
        freshProjectionSession = transition.freshProjectionSession,
        readingTimestampMs = 1_000L,
      )

    assertTrue(transition.freshProjectionSession)
    assertTrue(firstDecision.shouldNotify)
    assertTrue(firstDecision.shouldAlert)
    assertTrue(firstDecision.onlyAlertOnce)
    assertEquals(NotificationCompat.PRIORITY_HIGH, firstDecision.notificationPriority)
    assertEquals(NotificationManager.IMPORTANCE_HIGH, firstDecision.carImportance)
    assertEquals("t1arc_android_auto_glucose_v1", firstDecision.channelId)
    assertFalse(firstDecision.ongoing)

    val posted =
      recordCarNotificationPost(
        state = transition.state,
        readingTimestampMs = 1_000L,
        nowElapsedRealtimeMs = 10_000L,
        messageTimestampMs = 1_000_000L,
        alerted = true,
      )
    val duplicateFreshSignal =
      decideCarNotificationPost(
        state = posted,
        freshProjectionSession = true,
        readingTimestampMs = 1_000L,
      )

    assertFalse(duplicateFreshSignal.shouldNotify)
    assertFalse(duplicateFreshSignal.shouldAlert)
    assertEquals(1_000_000L, posted.messageEventWallClockMs)
    assertEquals(
      9_000_000L,
      carNotificationMessageTimestampMs(nowWallClockMs = 9_000_000L),
    )
  }

  @Test
  fun `initial post remains eligible when the first notify attempt did not complete`() {
    val transition =
      transitionCarNotificationConnection(
        state = CarNotificationSessionState(),
        connected = true,
        newSessionToken = "session-7",
      )
    val firstAttempt =
      decideCarNotificationPost(
        state = transition.state,
        freshProjectionSession = true,
        readingTimestampMs = 1_000L,
        nowElapsedRealtimeMs = 10_000L,
      )
    // Deliberately do not record the attempt: this models channel/build/notify
    // failure before Android accepted the notification.
    val retry =
      decideCarNotificationPost(
        state = transition.state,
        freshProjectionSession = false,
        readingTimestampMs = 1_000L,
        nowElapsedRealtimeMs = 11_000L,
      )

    assertTrue(firstAttempt.shouldNotify)
    assertTrue(firstAttempt.shouldAlert)
    assertTrue(retry.shouldNotify)
    assertTrue(retry.shouldAlert)
  }

  @Test
  fun `new reading updates an existing compact card quietly`() {
    val state =
      CarNotificationSessionState(
        connected = true,
        notificationPosted = true,
        lastPresentedReadingTimestampMs = 1_000L,
        lastPresentedContentIdentity = contentIdentity(),
        lastAlertElapsedRealtimeMs = 5_000L,
        lastPostElapsedRealtimeMs = 5_000L,
      )
    val decision =
      decideCarNotificationPost(
        state = state,
        freshProjectionSession = false,
        readingTimestampMs = 2_000L,
      )

    assertTrue(decision.shouldNotify)
    assertFalse(decision.shouldAlert)
    assertTrue(decision.onlyAlertOnce)
    assertEquals(NotificationCompat.PRIORITY_DEFAULT, decision.notificationPriority)
    assertEquals(NotificationManager.IMPORTANCE_DEFAULT, decision.carImportance)
    assertEquals("t1arc_android_auto_glucose_quiet_v1", decision.channelId)
  }

  @Test
  fun `routine age only refresh does not notify`() {
    val state =
      CarNotificationSessionState(
        connected = true,
        notificationPosted = true,
        lastPresentedReadingTimestampMs = 1_000L,
        lastPresentedContentIdentity =
          CarNotificationContentIdentity(available = true, readingTimestampMs = 1_000L),
        lastAlertElapsedRealtimeMs = 5_000L,
        lastPostElapsedRealtimeMs = 5_000L,
      )
    val decision =
      decideCarNotificationPost(
        state = state,
        freshProjectionSession = false,
        readingTimestampMs = 1_000L,
      )

    assertFalse(decision.shouldNotify)
    assertFalse(decision.shouldAlert)
  }

  @Test
  fun `first car message uses current wall time`() {
    assertEquals(
      1_000_000L,
      carNotificationMessageTimestampMs(
        nowWallClockMs = 1_000_000L,
      ),
    )
  }

  @Test
  fun `each car publication receives a current transport timestamp`() {
    val state =
      CarNotificationSessionState(
        connected = true,
        notificationPosted = true,
        lastPresentedReadingTimestampMs = 1_000L,
        lastAlertElapsedRealtimeMs = 5_000L,
        messageEventWallClockMs = 998_000L,
      )

    val firstUpdate =
      carNotificationMessageTimestampMs(
        nowWallClockMs = 1_000_000L,
      )
    val laterUpdate =
      carNotificationMessageTimestampMs(
        nowWallClockMs = 1_002_000L,
      )
    val recordedUpdate =
      recordCarNotificationPost(
        state = state,
        readingTimestampMs = 1_000L,
        nowElapsedRealtimeMs = 7_000L,
        messageTimestampMs = firstUpdate,
        alerted = false,
      )

    assertEquals(1_000_000L, firstUpdate)
    assertEquals(1_002_000L, laterUpdate)
    assertEquals(firstUpdate, recordedUpdate.messageEventWallClockMs)
  }

  @Test
  fun `first reading after unavailable projection post is a quiet update`() {
    val connected = CarNotificationSessionState(connected = true)
    val firstDecision =
      decideCarNotificationPost(
        state = connected,
        freshProjectionSession = true,
        readingTimestampMs = null,
      )
    val unavailablePosted =
      recordCarNotificationPost(
        state = connected,
        readingTimestampMs = null,
        nowElapsedRealtimeMs = 5_000L,
        messageTimestampMs = 1_000_000L,
        alerted = firstDecision.shouldAlert,
      )
    val readingDecision =
      decideCarNotificationPost(
        state = unavailablePosted,
        freshProjectionSession = false,
        readingTimestampMs = 2_000L,
      )

    assertTrue(firstDecision.shouldAlert)
    assertTrue(readingDecision.shouldNotify)
    assertFalse(readingDecision.shouldAlert)
    assertEquals(NotificationManager.IMPORTANCE_DEFAULT, readingDecision.carImportance)
  }

  @Test
  fun `dismissal remains sticky until a new projection`() {
    val postedState =
      CarNotificationSessionState(
        connected = true,
        notificationPosted = true,
        lastPresentedReadingTimestampMs = 1_000L,
        lastAlertElapsedRealtimeMs = 5_000L,
        lastPostElapsedRealtimeMs = 5_000L,
      )
    val dismissedState = cancelCarNotification(postedState)
    val newReadingDecision =
      decideCarNotificationPost(
        state = dismissedState,
        freshProjectionSession = false,
        readingTimestampMs = 2_000L,
      )
    val repeatedConnection =
      transitionCarNotificationConnection(dismissedState, connected = true)

    assertTrue(dismissedState.connected)
    assertFalse(dismissedState.notificationPosted)
    assertFalse(newReadingDecision.shouldNotify)
    assertFalse(repeatedConnection.freshProjectionSession)

    val disconnected = transitionCarNotificationConnection(dismissedState, connected = false)
    val reconnected = transitionCarNotificationConnection(disconnected.state, connected = true)
    val nextProjectionDecision =
      decideCarNotificationPost(
        state = reconnected.state,
        freshProjectionSession = reconnected.freshProjectionSession,
        readingTimestampMs = 2_000L,
      )

    assertTrue(reconnected.freshProjectionSession)
    assertTrue(nextProjectionDecision.shouldNotify)
    assertTrue(nextProjectionDecision.shouldAlert)
  }

  @Test
  fun `disconnected state never posts`() {
    val decision =
      decideCarNotificationPost(
        state = CarNotificationSessionState(),
        freshProjectionSession = true,
        readingTimestampMs = 2_000L,
      )

    assertFalse(decision.shouldNotify)
    assertFalse(decision.shouldAlert)
  }

  @Test
  fun `disconnect resets session while cancellation alone does not`() {
    val state =
      CarNotificationSessionState(
        connected = true,
        notificationPosted = true,
        lastPresentedReadingTimestampMs = 1_000L,
        lastAlertElapsedRealtimeMs = 5_000L,
        lastPostElapsedRealtimeMs = 5_000L,
      )
    val cancelled = cancelCarNotification(state)
    val disconnected = transitionCarNotificationConnection(cancelled, connected = false)

    assertTrue(cancelled.connected)
    assertEquals(1_000L, cancelled.lastPresentedReadingTimestampMs)
    assertEquals(5_000L, cancelled.lastAlertElapsedRealtimeMs)
    assertEquals(CarNotificationSessionState(), disconnected.state)
    assertFalse(disconnected.freshProjectionSession)
  }

  @Test
  fun `snapshot advanced during process death receives exactly one quiet catch up`() {
    val restored =
      restoreCarNotificationSessionState(
        persisted = persistedPolicy(),
        nowElapsedRealtimeMs = 7_000L,
        nowWallClockMs = 1_001_000L,
        bootSessionId = "boot-count:7",
        currentReadingTimestampMs = 2_000L,
      )

    requireNotNull(restored)
    val transition = transitionCarNotificationConnection(restored, connected = true)
    val catchUpDecision =
      decideCarNotificationPost(
        state = transition.state,
        freshProjectionSession = transition.freshProjectionSession,
        readingTimestampMs = 2_000L,
      )

    assertFalse(transition.freshProjectionSession)
    assertTrue(restored.notificationPosted)
    assertNull(restored.lastPresentedReadingTimestampMs)
    assertTrue(catchUpDecision.shouldNotify)
    assertFalse(catchUpDecision.shouldAlert)
    assertTrue(catchUpDecision.onlyAlertOnce)
    assertEquals(NotificationCompat.PRIORITY_DEFAULT, catchUpDecision.notificationPriority)
    assertEquals(NotificationManager.IMPORTANCE_DEFAULT, catchUpDecision.carImportance)

    val caughtUp =
      recordCarNotificationPost(
        state = restored,
        readingTimestampMs = 2_000L,
        nowElapsedRealtimeMs = 7_000L,
        messageTimestampMs = 999_000L,
        alerted = catchUpDecision.shouldAlert,
      )
    val repeatedRefresh =
      decideCarNotificationPost(
        state = caughtUp,
        freshProjectionSession = false,
        readingTimestampMs = 2_000L,
      )

    assertFalse(repeatedRefresh.shouldNotify)
    assertFalse(repeatedRefresh.shouldAlert)
  }

  @Test
  fun `unavailable snapshot after process restart immediately replaces an old glucose card`() {
    val restored =
      restoreCarNotificationSessionState(
        persisted = persistedPolicy(),
        nowElapsedRealtimeMs = 7_000L,
        nowWallClockMs = 1_001_000L,
        bootSessionId = "boot-count:7",
        currentReadingTimestampMs = null,
      )

    requireNotNull(restored)
    val decision =
      decideCarNotificationPost(
        state = restored,
        freshProjectionSession = false,
        readingTimestampMs = null,
        contentIdentity = CarNotificationContentIdentity(available = false),
        nowElapsedRealtimeMs = 7_000L,
      )

    assertTrue(decision.shouldNotify)
    assertFalse(decision.shouldAlert)
  }

  @Test
  fun `new reading after process restart updates quietly`() {
    val restored =
      restoreCarNotificationSessionState(
        persisted = persistedPolicy(),
        nowElapsedRealtimeMs = 7_000L,
        nowWallClockMs = 1_001_000L,
        bootSessionId = "boot-count:7",
        currentReadingTimestampMs = 2_000L,
      )

    requireNotNull(restored)
    val caughtUp =
      recordCarNotificationPost(
        state = restored,
        readingTimestampMs = 2_000L,
        nowElapsedRealtimeMs = 7_000L,
        messageTimestampMs = 999_000L,
        alerted = false,
      )
    val decision =
      decideCarNotificationPost(
        state = caughtUp,
        freshProjectionSession = false,
        readingTimestampMs = 3_000L,
      )

    assertTrue(decision.shouldNotify)
    assertFalse(decision.shouldAlert)
    assertTrue(decision.onlyAlertOnce)
    assertEquals(NotificationManager.IMPORTANCE_DEFAULT, decision.carImportance)
  }

  @Test
  fun `dismissal survives process restart regardless of new readings`() {
    val restored =
      restoreCarNotificationSessionState(
        persisted = persistedPolicy(notificationPosted = false),
        nowElapsedRealtimeMs = 7_000L,
        nowWallClockMs = 1_001_000L,
        bootSessionId = "boot-count:7",
        currentReadingTimestampMs = 2_000L,
      )

    requireNotNull(restored)
    val decision =
      decideCarNotificationPost(
        state = restored,
        freshProjectionSession = false,
        readingTimestampMs = 3_000L,
      )

    assertFalse(restored.notificationPosted)
    assertFalse(decision.shouldNotify)
    assertFalse(decision.shouldAlert)
  }

  @Test
  fun `reading that appears after dismissed process restart stays dismissed`() {
    val restored =
      restoreCarNotificationSessionState(
        persisted = persistedPolicy(notificationPosted = false),
        nowElapsedRealtimeMs = 7_000L,
        nowWallClockMs = 1_001_000L,
        bootSessionId = "boot-count:7",
        currentReadingTimestampMs = null,
      )

    requireNotNull(restored)
    val decision =
      decideCarNotificationPost(
        state = restored,
        freshProjectionSession = false,
        readingTimestampMs = 2_000L,
      )

    assertFalse(decision.shouldNotify)
    assertFalse(decision.shouldAlert)
  }

  @Test
  fun `expired persisted session starts clean`() {
    val restored =
      restoreCarNotificationSessionState(
        persisted = persistedPolicy(),
        nowElapsedRealtimeMs = 6_000L + CAR_NOTIFICATION_SESSION_EXPIRY_MS + 1L,
        nowWallClockMs = 1_000_000L + CAR_NOTIFICATION_SESSION_EXPIRY_MS + 1L,
        bootSessionId = "boot-count:7",
        currentReadingTimestampMs = 1_000L,
      )

    assertNull(restored)
  }

  @Test
  fun `reboot or monotonic reset cannot restore an old projection session`() {
    val afterReboot =
      restoreCarNotificationSessionState(
        persisted = persistedPolicy(),
        nowElapsedRealtimeMs = 7_000L,
        nowWallClockMs = 1_001_000L,
        bootSessionId = "boot-count:8",
        currentReadingTimestampMs = 1_000L,
      )
    val monotonicRollback =
      restoreCarNotificationSessionState(
        persisted = persistedPolicy(),
        nowElapsedRealtimeMs = 5_999L,
        nowWallClockMs = 1_001_000L,
        bootSessionId = "boot-count:7",
        currentReadingTimestampMs = 1_000L,
      )

    assertNull(afterReboot)
    assertNull(monotonicRollback)
  }

  @Test
  fun `wall clock rollback keeps same boot session`() {
    val restored =
      restoreCarNotificationSessionState(
        persisted = persistedPolicy(notificationPosted = false),
        nowElapsedRealtimeMs = 7_000L,
        nowWallClockMs = 900_000L,
        bootSessionId = "boot-count:7",
        currentReadingTimestampMs = 1_000L,
      )

    requireNotNull(restored)
    assertTrue(restored.connected)
    assertFalse(restored.notificationPosted)
  }

  @Test
  fun `large wall clock jump cannot expire a live same boot session`() {
    val restored =
      restoreCarNotificationSessionState(
        persisted = persistedPolicy(),
        nowElapsedRealtimeMs = 7_000L,
        nowWallClockMs = 100_000_000L,
        bootSessionId = "boot-count:7",
        currentReadingTimestampMs = 1_000L,
      )

    assertTrue(restored?.connected == true)
  }

  @Test
  fun `unchanged content refreshes quietly only when sixty second keepalive is due`() {
    val identity = contentIdentity()
    val state =
      CarNotificationSessionState(
        connected = true,
        sessionToken = "session-7",
        notificationPosted = true,
        lastPresentedReadingTimestampMs = 1_000L,
        lastPresentedContentIdentity = identity,
        lastAlertElapsedRealtimeMs = 5_000L,
        lastPostElapsedRealtimeMs = 10_000L,
      )

    val justBefore =
      decideCarNotificationPost(
        state = state,
        freshProjectionSession = false,
        readingTimestampMs = 1_000L,
        contentIdentity = identity,
        nowElapsedRealtimeMs = 69_999L,
      )
    val due =
      decideCarNotificationPost(
        state = state,
        freshProjectionSession = false,
        readingTimestampMs = 1_000L,
        contentIdentity = identity,
        nowElapsedRealtimeMs = 70_000L,
      )

    assertFalse(justBefore.shouldNotify)
    assertTrue(due.shouldNotify)
    assertFalse(due.shouldAlert)
    assertEquals(NotificationCompat.PRIORITY_DEFAULT, due.notificationPriority)
    assertEquals(NotificationManager.IMPORTANCE_DEFAULT, due.carImportance)
  }

  @Test
  fun `every successful post restarts the full keepalive deadline`() {
    val firstIdentity = contentIdentity(timestampMs = 1_000L, value = 5.9)
    val secondIdentity = contentIdentity(timestampMs = 2_000L, value = 6.0)
    val initial =
      CarNotificationSessionState(
        connected = true,
        sessionToken = "session-7",
        notificationPosted = true,
        lastPresentedReadingTimestampMs = 1_000L,
        lastPresentedContentIdentity = firstIdentity,
        lastAlertElapsedRealtimeMs = 5_000L,
        lastPostElapsedRealtimeMs = 10_000L,
      )
    val changed =
      decideCarNotificationPost(
        state = initial,
        freshProjectionSession = false,
        readingTimestampMs = 2_000L,
        contentIdentity = secondIdentity,
        nowElapsedRealtimeMs = 40_000L,
      )
    assertTrue(changed.shouldNotify)

    val posted =
      recordCarNotificationPost(
        state = initial,
        readingTimestampMs = 2_000L,
        contentIdentity = secondIdentity,
        nowElapsedRealtimeMs = 40_050L,
        messageTimestampMs = 999_000L,
        alerted = false,
      )
    val justBeforeNewDeadline =
      decideCarNotificationPost(
        state = posted,
        freshProjectionSession = false,
        readingTimestampMs = 2_000L,
        contentIdentity = secondIdentity,
        nowElapsedRealtimeMs = 100_049L,
      )
    val atNewDeadline =
      decideCarNotificationPost(
        state = posted,
        freshProjectionSession = false,
        readingTimestampMs = 2_000L,
        contentIdentity = secondIdentity,
        nowElapsedRealtimeMs = 100_050L,
      )

    assertFalse(justBeforeNewDeadline.shouldNotify)
    assertTrue(atNewDeadline.shouldNotify)
    assertFalse(atNewDeadline.shouldAlert)
  }

  @Test
  fun `new reading posts immediately even one second after the previous post`() {
    val previousIdentity = contentIdentity(timestampMs = 1_000L, value = 5.9)
    val state =
      CarNotificationSessionState(
        connected = true,
        sessionToken = "session-7",
        notificationPosted = true,
        lastPresentedReadingTimestampMs = 1_000L,
        lastPresentedContentIdentity = previousIdentity,
        lastAlertElapsedRealtimeMs = 5_000L,
        lastPostElapsedRealtimeMs = 10_000L,
      )
    val decision =
      decideCarNotificationPost(
        state = state,
        freshProjectionSession = false,
        readingTimestampMs = 2_000L,
        contentIdentity = contentIdentity(timestampMs = 2_000L, value = 6.1),
        nowElapsedRealtimeMs = 11_000L,
      )

    assertTrue(decision.shouldNotify)
    assertFalse(decision.shouldAlert)
  }

  @Test
  fun `same timestamp value and trend corrections post immediately`() {
    val previousIdentity = contentIdentity(timestampMs = 1_000L, value = 5.9, trend = "flat")
    val state =
      CarNotificationSessionState(
        connected = true,
        sessionToken = "session-7",
        notificationPosted = true,
        lastPresentedReadingTimestampMs = 1_000L,
        lastPresentedContentIdentity = previousIdentity,
        lastAlertElapsedRealtimeMs = 5_000L,
        lastPostElapsedRealtimeMs = 10_000L,
      )

    val correctedValue =
      decideCarNotificationPost(
        state = state,
        freshProjectionSession = false,
        readingTimestampMs = 1_000L,
        contentIdentity = contentIdentity(timestampMs = 1_000L, value = 6.0, trend = "flat"),
        nowElapsedRealtimeMs = 11_000L,
      )
    val correctedTrend =
      decideCarNotificationPost(
        state = state,
        freshProjectionSession = false,
        readingTimestampMs = 1_000L,
        contentIdentity = contentIdentity(timestampMs = 1_000L, value = 5.9, trend = "slightUp"),
        nowElapsedRealtimeMs = 11_000L,
      )

    assertTrue(correctedValue.shouldNotify)
    assertFalse(correctedValue.shouldAlert)
    assertTrue(correctedTrend.shouldNotify)
    assertFalse(correctedTrend.shouldAlert)
  }

  @Test
  fun `same reading history correction refreshes the rendered card immediately`() {
    val originalHistory =
      listOf(
        CarNotificationHistoryPointIdentity(900L, java.lang.Double.doubleToLongBits(5.8)),
        CarNotificationHistoryPointIdentity(1_000L, java.lang.Double.doubleToLongBits(5.9)),
      )
    val correctedHistory =
      listOf(
        CarNotificationHistoryPointIdentity(900L, java.lang.Double.doubleToLongBits(5.7)),
        CarNotificationHistoryPointIdentity(1_000L, java.lang.Double.doubleToLongBits(5.9)),
      )
    val originalIdentity = contentIdentity(history = originalHistory)
    val state =
      CarNotificationSessionState(
        connected = true,
        sessionToken = "session-7",
        notificationPosted = true,
        lastPresentedReadingTimestampMs = 1_000L,
        lastPresentedContentIdentity = originalIdentity,
        lastAlertElapsedRealtimeMs = 5_000L,
        lastPostElapsedRealtimeMs = 10_000L,
      )
    val decision =
      decideCarNotificationPost(
        state = state,
        freshProjectionSession = false,
        readingTimestampMs = 1_000L,
        contentIdentity = contentIdentity(history = correctedHistory),
        nowElapsedRealtimeMs = 11_000L,
      )

    assertTrue(decision.shouldNotify)
    assertFalse(decision.shouldAlert)
  }

  @Test
  fun `history correction also refreshes immediately while glucose is unavailable`() {
    val originalHistory =
      listOf(CarNotificationHistoryPointIdentity(900L, java.lang.Double.doubleToLongBits(5.8)))
    val correctedHistory =
      listOf(CarNotificationHistoryPointIdentity(900L, java.lang.Double.doubleToLongBits(5.7)))
    val originalIdentity =
      CarNotificationContentIdentity(available = false, history = originalHistory)
    val state =
      CarNotificationSessionState(
        connected = true,
        sessionToken = "session-7",
        notificationPosted = true,
        lastPresentedContentIdentity = originalIdentity,
        lastAlertElapsedRealtimeMs = 5_000L,
        lastPostElapsedRealtimeMs = 10_000L,
        messageEventWallClockMs = 999_000L,
      )
    val decision =
      decideCarNotificationPost(
        state = state,
        freshProjectionSession = false,
        readingTimestampMs = null,
        contentIdentity =
          CarNotificationContentIdentity(available = false, history = correctedHistory),
        nowElapsedRealtimeMs = 11_000L,
      )

    assertTrue(decision.shouldNotify)
    assertFalse(decision.shouldAlert)
  }

  @Test
  fun `stale callbacks from an earlier projection session are ignored`() {
    val firstConnection =
      transitionCarNotificationConnection(
        state = CarNotificationSessionState(),
        connected = true,
        newSessionToken = "session-1",
      )
    val firstPosted =
      recordCarNotificationPost(
        state = firstConnection.state,
        readingTimestampMs = 1_000L,
        contentIdentity = contentIdentity(),
        nowElapsedRealtimeMs = 10_000L,
        messageTimestampMs = 1_000_000L,
        alerted = true,
      )
    val disconnected = transitionCarNotificationConnection(firstPosted, connected = false)
    val secondConnection =
      transitionCarNotificationConnection(
        state = disconnected.state,
        connected = true,
        newSessionToken = "session-2",
      )
    val secondPosted =
      recordCarNotificationPost(
        state = secondConnection.state,
        readingTimestampMs = 2_000L,
        contentIdentity = contentIdentity(timestampMs = 2_000L, value = 6.0),
        nowElapsedRealtimeMs = 20_000L,
        messageTimestampMs = 1_010_000L,
        alerted = true,
      )

    assertEquals("session-1", firstPosted.sessionToken)
    assertEquals("session-2", secondPosted.sessionToken)
    assertFalse(shouldRunCarNotificationCallback("session-1", secondPosted))
    assertTrue(shouldRunCarNotificationCallback("session-2", secondPosted))
  }

  @Test
  fun `dismissed session cannot be resurrected by a due keepalive`() {
    val posted =
      CarNotificationSessionState(
        connected = true,
        sessionToken = "session-7",
        notificationPosted = true,
        lastPresentedReadingTimestampMs = 1_000L,
        lastPresentedContentIdentity = contentIdentity(),
        lastAlertElapsedRealtimeMs = 5_000L,
        lastPostElapsedRealtimeMs = 10_000L,
      )
    val dismissed = cancelCarNotification(posted)
    val decision =
      decideCarNotificationPost(
        state = dismissed,
        freshProjectionSession = false,
        readingTimestampMs = 2_000L,
        contentIdentity = contentIdentity(timestampMs = 2_000L, value = 6.0),
        nowElapsedRealtimeMs = 100_000L,
      )

    assertFalse(decision.shouldNotify)
    assertNull(carNotificationKeepAliveDelayMs(dismissed, 100_000L))
    assertFalse(shouldRunCarNotificationCallback("session-7", dismissed))
  }

  @Test
  fun `keepalive delay is measured from the last successful post using monotonic time`() {
    val state =
      CarNotificationSessionState(
        connected = true,
        sessionToken = "session-7",
        notificationPosted = true,
        lastPostElapsedRealtimeMs = 10_000L,
      )

    assertEquals(60_000L, carNotificationKeepAliveDelayMs(state, 10_000L))
    assertEquals(1L, carNotificationKeepAliveDelayMs(state, 69_999L))
    assertEquals(0L, carNotificationKeepAliveDelayMs(state, 70_000L))
    assertEquals(60_000L, carNotificationKeepAliveDelayMs(state, 9_000L))
  }

  @Test
  fun `process restore preserves the session token and rejects a missing token`() {
    val restored =
      restoreCarNotificationSessionState(
        persisted = persistedPolicy(sessionToken = "session-7"),
        nowElapsedRealtimeMs = 7_000L,
        nowWallClockMs = 1_001_000L,
        bootSessionId = "boot-count:7",
        currentReadingTimestampMs = 2_000L,
      )
    val missingToken =
      restoreCarNotificationSessionState(
        persisted = persistedPolicy(sessionToken = ""),
        nowElapsedRealtimeMs = 7_000L,
        nowWallClockMs = 1_001_000L,
        bootSessionId = "boot-count:7",
        currentReadingTimestampMs = 2_000L,
      )

    assertEquals("session-7", restored?.sessionToken)
    assertEquals(999_000L, restored?.messageEventWallClockMs)
    assertNull(missingToken)
  }

  @Test
  fun `phone lock screen receives only a redacted private notification`() {
    val privacy = carNotificationPrivacyContract()
    val publicCopy = "${privacy.publicTitle} ${privacy.publicText}"

    assertEquals(NotificationCompat.VISIBILITY_PRIVATE, privacy.privateVisibility)
    assertEquals(NotificationCompat.VISIBILITY_PUBLIC, privacy.publicVisibility)
    assertFalse(publicCopy.contains("mmol", ignoreCase = true))
    assertFalse(publicCopy.contains("glucose", ignoreCase = true))
    assertFalse(Regex("\\b\\d+[.,]\\d+\\b").containsMatchIn(publicCopy))
    assertFalse(Regex("\\d").containsMatchIn(privacy.publicText))
  }

  @Test
  fun `plaintext policy storage contains no health derived fields`() {
    val fieldNames = carNotificationPersistedPolicyFieldNames().map(String::lowercase)
    val persistedModelFields =
      PersistedCarNotificationPolicy::class.java.declaredFields.map { it.name.lowercase() }
    val forbiddenTerms = listOf("reading", "availability", "timestamp", "value", "trend", "source")

    assertTrue(fieldNames.none { name -> forbiddenTerms.any(name::contains) })
    assertTrue(persistedModelFields.none { name -> forbiddenTerms.any(name::contains) })
  }
}
