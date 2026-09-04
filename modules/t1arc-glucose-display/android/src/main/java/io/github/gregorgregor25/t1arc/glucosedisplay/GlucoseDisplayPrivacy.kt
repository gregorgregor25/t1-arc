package io.github.gregorgregor25.t1arc.glucosedisplay

import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import java.util.concurrent.ExecutionException
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

internal fun resolveLockScreenVisibility(storedValue: Boolean?): Boolean =
  storedValue == true

/** Pure policy shared by the bridge gate and JVM regression tests. */
internal object GlucosePublicationEpochPolicy {
  private const val MAX_JS_SAFE_INTEGER = 9_007_199_254_740_991.0

  fun parseBridgeEpoch(value: Double): Long? {
    if (!value.isFinite() || value < 0.0 || value > MAX_JS_SAFE_INTEGER) {
      return null
    }
    val epoch = value.toLong()
    return epoch.takeIf { it.toDouble() == value }
  }

  fun acceptsMutation(current: Long, requested: Long): Boolean =
    current >= 0L && requested == current

  fun epochAfterClear(current: Long, requested: Long): Long? =
    requested.takeIf { current >= 0L && requested >= current }

  fun acceptsLegacyMutation(current: Long): Boolean = current == 0L
}

internal object WearRequestHistoryPolicy {
  fun shouldPublish(
    hasSnapshot: Boolean,
    hasInMemoryHistory: Boolean,
    writeEpoch: Long,
  ): Boolean =
    hasInMemoryHistory || (!hasSnapshot && writeEpoch > 0L)
}

/**
 * The Wearable API on a phone with no Wear support fails GoogleApi calls with
 * ApiException status 17 and a retained ConnectionResult error 16. Those two
 * values are from the exact Play Services dependency; either value alone is
 * ambiguous and must remain fail-closed.
 */
internal object RetainedWearClearFailurePolicy {
  private fun directApiException(error: Throwable): ApiException? =
    when (error) {
      is ApiException -> error
      is ExecutionException -> error.cause as? ApiException
      else -> null
    }

  fun isAbsentWearApi(error: Throwable): Boolean {
    val apiException = directApiException(error) ?: return false
    return apiException.statusCode == CommonStatusCodes.API_NOT_CONNECTED &&
      apiException.status.connectionResult?.errorCode ==
        ConnectionResult.API_UNAVAILABLE
  }

  fun acceptsAggregate(
    currentFailure: Throwable?,
    historyFailure: Throwable?,
  ): Boolean =
    (currentFailure == null && historyFailure == null) ||
      (currentFailure != null &&
        historyFailure != null &&
        isAbsentWearApi(currentFailure) &&
        isAbsentWearApi(historyFailure))
}

/** Testable process-wide serialization primitive used by the Android bridge. */
internal class GlucosePublicationEpochArbiter {
  private val lock = ReentrantLock(true)

  fun <T> mutate(
    requested: Long,
    readCurrent: () -> Long,
    mutation: (Long) -> T,
  ): T =
    lock.withLock {
      val current = readCurrent()
      check(GlucosePublicationEpochPolicy.acceptsMutation(current, requested)) {
        "This glucose publication was superseded by a privacy erase."
      }
      mutation(requested)
    }

  fun <T> clear(
    requested: Long,
    readCurrent: () -> Long,
    persistEpochAndClearSnapshot: (Long) -> Boolean,
    mutation: (Long) -> T,
  ): T =
    lock.withLock {
      val next =
        requireNotNull(
          GlucosePublicationEpochPolicy.epochAfterClear(readCurrent(), requested),
        ) { "A stale glucose privacy clear cannot replace a newer epoch." }
      check(persistEpochAndClearSnapshot(next)) {
        "The native glucose privacy epoch could not be saved."
      }
      mutation(next)
    }

  fun <T> mutateLegacy(readCurrent: () -> Long, mutation: (Long) -> T): T =
    lock.withLock {
      val current = readCurrent()
      check(GlucosePublicationEpochPolicy.acceptsLegacyMutation(current)) {
        "This legacy glucose mutation is unavailable after a privacy erase."
      }
      mutation(current)
    }

  fun <T> observe(readCurrent: () -> Long, operation: (Long) -> T): T =
    lock.withLock { operation(readCurrent()) }

  fun ifCurrent(readCurrent: () -> Long, epoch: Long, operation: () -> Unit) {
    lock.withLock {
      if (readCurrent() == epoch) operation()
    }
  }
}
