package io.github.gregorgregor25.t1arc.glucosedisplay

import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Status
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.concurrent.thread
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GlucoseDisplayPrivacyTest {
  private fun unavailableWearApi() =
    ApiException(
      Status(
        ConnectionResult(ConnectionResult.API_UNAVAILABLE),
        "Wearable API is unavailable",
      ),
    )

  @Test
  fun `missing lock screen preference defaults to private`() {
    assertFalse(resolveLockScreenVisibility(null))
  }

  @Test
  fun `stored private preference remains private`() {
    assertFalse(resolveLockScreenVisibility(false))
  }

  @Test
  fun `only an explicit stored opt in exposes the value`() {
    assertTrue(resolveLockScreenVisibility(true))
  }

  @Test
  fun `guarded publications require the exact durable privacy epoch`() {
    assertTrue(GlucosePublicationEpochPolicy.acceptsMutation(4L, 4L))
    assertFalse(GlucosePublicationEpochPolicy.acceptsMutation(4L, 3L))
    assertFalse(GlucosePublicationEpochPolicy.acceptsMutation(4L, 5L))
  }

  @Test
  fun `privacy clear advances monotonically and supports idempotent retry`() {
    assertEquals(5L, GlucosePublicationEpochPolicy.epochAfterClear(4L, 5L))
    assertEquals(5L, GlucosePublicationEpochPolicy.epochAfterClear(5L, 5L))
    assertNull(GlucosePublicationEpochPolicy.epochAfterClear(5L, 4L))
  }

  @Test
  fun `legacy mutations stop being usable after the first privacy erase`() {
    assertTrue(GlucosePublicationEpochPolicy.acceptsLegacyMutation(0L))
    assertFalse(GlucosePublicationEpochPolicy.acceptsLegacyMutation(1L))
  }

  @Test
  fun `bridge epochs must be exact nonnegative integers`() {
    assertEquals(7L, GlucosePublicationEpochPolicy.parseBridgeEpoch(7.0))
    assertEquals(
      9_007_199_254_740_991L,
      GlucosePublicationEpochPolicy.parseBridgeEpoch(9_007_199_254_740_991.0),
    )
    assertNull(GlucosePublicationEpochPolicy.parseBridgeEpoch(-1.0))
    assertNull(GlucosePublicationEpochPolicy.parseBridgeEpoch(1.5))
    assertNull(GlucosePublicationEpochPolicy.parseBridgeEpoch(9_007_199_254_740_992.0))
    assertNull(GlucosePublicationEpochPolicy.parseBridgeEpoch(Long.MAX_VALUE.toDouble()))
    assertNull(GlucosePublicationEpochPolicy.parseBridgeEpoch(Double.NaN))
  }

  @Test
  fun `watch request preserves retained history after a process restart`() {
    assertFalse(
      WearRequestHistoryPolicy.shouldPublish(
        hasSnapshot = true,
        hasInMemoryHistory = false,
        writeEpoch = 4L,
      ),
    )
    assertTrue(
      WearRequestHistoryPolicy.shouldPublish(
        hasSnapshot = false,
        hasInMemoryHistory = false,
        writeEpoch = 4L,
      ),
    )
    assertTrue(
      WearRequestHistoryPolicy.shouldPublish(
        hasSnapshot = true,
        hasInMemoryHistory = true,
        writeEpoch = 4L,
      ),
    )
  }

  @Test
  fun `retained Wear clear accepts direct and Tasks await API unavailable`() {
    val unavailable = unavailableWearApi()

    assertTrue(RetainedWearClearFailurePolicy.isAbsentWearApi(unavailable))
    assertTrue(
      RetainedWearClearFailurePolicy.isAbsentWearApi(
        ExecutionException(unavailable),
      ),
    )
    assertTrue(
      RetainedWearClearFailurePolicy.acceptsAggregate(
        currentFailure = unavailable,
        historyFailure = ExecutionException(unavailableWearApi()),
      ),
    )
  }

  @Test
  @Suppress("DEPRECATION")
  fun `retained Wear clear rejects bare or unrelated Play Services statuses`() {
    assertFalse(
      RetainedWearClearFailurePolicy.isAbsentWearApi(
        ApiException(Status(CommonStatusCodes.API_NOT_CONNECTED)),
      ),
    )
    assertFalse(
      RetainedWearClearFailurePolicy.isAbsentWearApi(
        ApiException(
          Status(
            ConnectionResult(ConnectionResult.API_UNAVAILABLE),
            "Wearable API is unavailable",
            CommonStatusCodes.TIMEOUT,
          ),
        ),
      ),
    )
    assertFalse(
      RetainedWearClearFailurePolicy.isAbsentWearApi(
        ApiException(
          Status(
            ConnectionResult(ConnectionResult.SERVICE_MISSING_PERMISSION),
            "Wearable permission missing",
          ),
        ),
      ),
    )
    assertFalse(
      RetainedWearClearFailurePolicy.isAbsentWearApi(
        ApiException(Status(CommonStatusCodes.TIMEOUT)),
      ),
    )
  }

  @Test
  fun `retained Wear clear rejects security and unknown wrappers`() {
    assertFalse(
      RetainedWearClearFailurePolicy.isAbsentWearApi(
        SecurityException("Wear permission denied"),
      ),
    )
    assertFalse(
      RetainedWearClearFailurePolicy.isAbsentWearApi(
        IllegalStateException("unexpected wrapper", unavailableWearApi()),
      ),
    )
  }

  @Test
  fun `retained Wear clear rejects mixed success or failure outcomes`() {
    val unavailable = unavailableWearApi()
    val timeout = ApiException(Status(CommonStatusCodes.TIMEOUT))

    assertTrue(
      RetainedWearClearFailurePolicy.acceptsAggregate(
        currentFailure = null,
        historyFailure = null,
      ),
    )
    assertFalse(
      RetainedWearClearFailurePolicy.acceptsAggregate(
        currentFailure = null,
        historyFailure = unavailable,
      ),
    )
    assertFalse(
      RetainedWearClearFailurePolicy.acceptsAggregate(
        currentFailure = unavailable,
        historyFailure = null,
      ),
    )
    assertFalse(
      RetainedWearClearFailurePolicy.acceptsAggregate(
        currentFailure = unavailable,
        historyFailure = timeout,
      ),
    )
  }

  @Test
  fun `clear wins over a stale mutation queued behind it and survives restart`() {
    val durableEpoch = AtomicLong(0L)
    val clearEntered = CountDownLatch(1)
    val releaseClear = CountDownLatch(1)
    val staleMutationRan = AtomicBoolean(false)
    val staleRejected = AtomicBoolean(false)
    val arbiter = GlucosePublicationEpochArbiter()

    val clearThread = thread {
      arbiter.clear(
        requested = 1L,
        readCurrent = durableEpoch::get,
        persistEpochAndClearSnapshot = {
          durableEpoch.set(it)
          true
        },
      ) {
        clearEntered.countDown()
        check(releaseClear.await(2, TimeUnit.SECONDS))
      }
    }
    assertTrue(clearEntered.await(2, TimeUnit.SECONDS))
    val staleThread = thread {
      runCatching {
        arbiter.mutate(0L, durableEpoch::get) {
          staleMutationRan.set(true)
        }
      }.onFailure { staleRejected.set(true) }
    }
    releaseClear.countDown()
    clearThread.join(2_000)
    staleThread.join(2_000)

    assertFalse(clearThread.isAlive)
    assertFalse(staleThread.isAlive)
    assertTrue(staleRejected.get())
    assertFalse(staleMutationRan.get())
    assertEquals(1L, durableEpoch.get())

    val restartedArbiter = GlucosePublicationEpochArbiter()
    assertTrue(
      runCatching {
        restartedArbiter.mutate(0L, durableEpoch::get) {}
      }.isFailure,
    )
    assertTrue(
      runCatching {
        restartedArbiter.mutate(1L, durableEpoch::get) {}
      }.isSuccess,
    )
  }
}
