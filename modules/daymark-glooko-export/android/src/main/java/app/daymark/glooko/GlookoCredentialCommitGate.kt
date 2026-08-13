package app.daymark.glooko

import java.util.UUID

/**
 * Process-global bridge between the Android credential vault and the
 * JavaScript SQLite commit. Tokens are deliberately not thread-owned because
 * Expo may begin and end an async native call on different coroutine threads.
 */
internal object GlookoCredentialCommitGate {
  private val monitor = Any()
  private val active = mutableSetOf<String>()
  private var activeDataReset: String? = null

  fun beginCommit(
    expectedGeneration: Long,
    generationIsCurrent: () -> Boolean,
  ): String? = synchronized(monitor) {
    if (
      expectedGeneration < 1L ||
      activeDataReset != null ||
      !generationIsCurrent()
    ) {
      return@synchronized null
    }
    UUID.randomUUID().toString().also { token ->
      active += token
    }
  }

  fun endCommit(token: String): Boolean = synchronized(monitor) {
    active.remove(token)
  }

  /** Manual ZIP writes have no credential epoch but still exclude deletion. */
  fun beginDataCommit(): String? = synchronized(monitor) {
    if (activeDataReset != null) return@synchronized null
    UUID.randomUUID().toString().also { token ->
      active += token
    }
  }

  /**
   * Exclusively owns imported-data deletion. A reset cannot start while any
   * database commit is active, and no new commit can start until it ends.
   */
  fun beginDataReset(): String? = synchronized(monitor) {
    if (active.isNotEmpty() || activeDataReset != null) return@synchronized null
    UUID.randomUUID().toString().also { token ->
      activeDataReset = token
    }
  }

  /** Advances the epoch and releases deletion as one atomic gate operation. */
  fun finishDataReset(
    token: String,
    advanceGeneration: () -> Unit,
  ): Boolean = synchronized(monitor) {
    if (activeDataReset != token || active.isNotEmpty()) {
      return@synchronized false
    }
    advanceGeneration()
    activeDataReset = null
    true
  }

  /** Direct exporters fail closed instead of reading credentials mid-reset. */
  fun <T> readCredentials(block: () -> T): T? = synchronized(monitor) {
    if (activeDataReset != null) return@synchronized null
    block()
  }

  /** Serialises every credential-state mutation against active DB commits. */
  fun <T> mutateCredentials(block: () -> T): T = synchronized(monitor) {
    check(active.isEmpty() && activeDataReset == null) {
      "Glooko data is changing. Wait a moment, then save the sign-in again."
    }
    block()
  }
}
