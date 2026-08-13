package app.daymark.glooko

/** Persistent completion state for the retired-browser privacy migration. */
internal interface LegacyPrivacyMigrationMarker {
  fun isComplete(): Boolean

  fun markComplete(): Boolean
}

/** One asynchronous attempt to erase every retired-browser privacy artifact. */
internal fun interface LegacyPrivacyCleanupWork {
  fun start(onComplete: (Boolean) -> Unit)
}

/**
 * Serialises privacy cleanup attempts and only persists completion after the
 * asynchronous cleanup reports success.
 *
 * A force request still runs after a completed migration. If a full cleanup
 * is already in flight, it joins that same attempt rather than starting a
 * second destructive browser wipe.
 */
internal class LegacyPrivacyCleanupCoordinator(
  private val marker: LegacyPrivacyMigrationMarker,
  private val work: LegacyPrivacyCleanupWork,
) {
  private val lock = Any()
  private var nextAttempt = 0L
  private var activeAttempt: Long? = null
  private val activeCallbacks = mutableListOf<(Boolean) -> Unit>()

  fun migrate() {
    request(force = false, callback = null)
  }

  fun forceClear(onComplete: (Boolean) -> Unit) {
    request(force = true, callback = onComplete)
  }

  private fun request(
    force: Boolean,
    callback: ((Boolean) -> Unit)?,
  ) {
    val attempt =
      synchronized(lock) {
        if (!force && runCatching { marker.isComplete() }.getOrDefault(false)) {
          return
        }
        activeAttempt?.let {
          callback?.let(activeCallbacks::add)
          return
        }
        callback?.let(activeCallbacks::add)
        nextAttempt += 1
        nextAttempt.also { activeAttempt = it }
      }

    try {
      work.start { success -> finish(attempt, success) }
    } catch (_: Throwable) {
      finish(attempt, false)
    }
  }

  private fun finish(
    attempt: Long,
    workSucceeded: Boolean,
  ) {
    val callbacks: List<(Boolean) -> Unit>
    val succeeded: Boolean
    synchronized(lock) {
      if (activeAttempt != attempt) return
      succeeded =
        workSucceeded &&
          runCatching { marker.markComplete() }.getOrDefault(false)
      activeAttempt = null
      callbacks = activeCallbacks.toList()
      activeCallbacks.clear()
    }
    callbacks.forEach { callback -> runCatching { callback(succeeded) } }
  }
}
