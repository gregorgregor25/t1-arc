package io.github.gregorgregor25.t1arc.notificationsource

internal data class NotificationCaptureAdmission(
  val rule: NotificationCaptureRule,
  val configurationRevision: Long,
)

internal data class NotificationCaptureConfigurationSnapshot(
  val configuration: NotificationCaptureConfiguration,
  val revision: Long,
)

/**
 * Owns the notification-source serialization boundary. Expensive notification extraction happens
 * outside this coordinator; persistent configuration checks and queue mutations happen inside it.
 */
internal class NotificationCaptureCoordinator {
  private val monitor = Any()
  private var configurationRevision = 0L
  private var captureBlocked = false

  fun beginCapture(
    packageName: String,
    readConfiguration: () -> NotificationCaptureConfiguration,
  ): NotificationCaptureAdmission? =
    synchronized(monitor) {
      if (captureBlocked) return@synchronized null
      val configuration = readConfiguration()
      if (!configuration.enabled) return@synchronized null
      val rule =
        configuration.rules.firstOrNull { it.packageName == packageName }
          ?: return@synchronized null
      NotificationCaptureAdmission(rule, configurationRevision)
    }

  fun appendIfCurrent(
    admission: NotificationCaptureAdmission,
    readConfiguration: () -> NotificationCaptureConfiguration,
    append: (NotificationCaptureRule) -> Unit,
  ): Boolean =
    synchronized(monitor) {
      if (captureBlocked || admission.configurationRevision != configurationRevision) {
        return@synchronized false
      }
      val configuration = readConfiguration()
      if (!configuration.enabled) return@synchronized false
      val currentRule =
        configuration.rules.firstOrNull { it.packageName == admission.rule.packageName }
          ?: return@synchronized false
      if (currentRule != admission.rule) return@synchronized false
      append(currentRule)
      true
    }

  /**
   * Reconfiguration is a fail-closed two-phase transition. The persisted
   * staging state survives process death, while key destruction makes every
   * envelope admitted under the preceding rules permanently unreadable.
   */
  fun replaceConfigurationAndClear(
    configuration: NotificationCaptureConfiguration,
    persistStagingDisabled: (NotificationCaptureConfiguration) -> Boolean,
    eraseQueueAndVerify: () -> Boolean,
    persistDesired: (NotificationCaptureConfiguration) -> Boolean,
  ): NotificationCaptureConfiguration =
    synchronized(monitor) {
      invalidateAndBlock()
      val staging = NotificationCaptureConfiguration(false, emptyList())
      check(persistStagingDisabled(staging)) {
        "Notification capture could not be staged disabled. Capture remains blocked."
      }
      check(eraseQueueAndVerify()) {
        "Notification capture data could not be cleared. Capture remains blocked."
      }
      check(persistDesired(configuration)) {
        "Notification-source settings could not be persisted. Capture remains blocked."
      }
      captureBlocked = !configuration.enabled
      configuration
    }

  fun disableAndClear(
    pendingCount: () -> Int,
    persistDisabledAndClearMetadata: (NotificationCaptureConfiguration) -> Boolean,
    eraseQueueAndVerify: () -> Boolean,
  ): Int =
    synchronized(monitor) {
      invalidateAndBlock()
      val count = runCatching(pendingCount).getOrDefault(0)
      val disabled = NotificationCaptureConfiguration(false, emptyList())
      val persistence = runCatching { persistDisabledAndClearMetadata(disabled) }
      val erasure = runCatching(eraseQueueAndVerify)
      if (persistence.getOrNull() != true) {
        val failure =
          persistence.exceptionOrNull()
            ?: IllegalStateException(
              "Notification capture could not be disabled. Capture remains blocked.",
            )
        erasure.exceptionOrNull()?.let(failure::addSuppressed)
        throw failure
      }
      if (erasure.getOrNull() != true) {
        throw erasure.exceptionOrNull()
          ?: IllegalStateException(
            "Notification capture data erasure could not be verified. Capture remains blocked.",
          )
      }
      count
    }

  fun <T> serially(block: () -> T): T = synchronized(monitor) { block() }

  fun configurationSnapshot(
    readConfiguration: () -> NotificationCaptureConfiguration,
  ): NotificationCaptureConfigurationSnapshot =
    synchronized(monitor) {
      NotificationCaptureConfigurationSnapshot(
        configuration = readConfiguration(),
        revision = configurationRevision,
      )
    }

  internal fun currentConfigurationRevision(): Long =
    synchronized(monitor) { configurationRevision }

  private fun invalidateAndBlock() {
    captureBlocked = true
    check(configurationRevision < 9_007_199_254_740_991L) {
      "The notification configuration revision cannot be advanced safely."
    }
    configurationRevision += 1L
  }
}

/**
 * Ciphertext is no longer readable once the queue-only key is verifiably absent. AtomicFile
 * artifacts are then removed as a best-effort storage cleanup; their deletion is not the privacy
 * boundary.
 */
internal fun cryptographicallyEraseCapturedQueue(
  destroyKey: () -> Unit,
  keyExists: () -> Boolean,
  deleteArtifactsBestEffort: () -> Unit,
): Boolean {
  val destroyed =
    runCatching {
      destroyKey()
      !keyExists()
    }.getOrDefault(false)
  runCatching(deleteArtifactsBestEffort)
  if (!destroyed) return false
  return runCatching { !keyExists() }.getOrDefault(false)
}
