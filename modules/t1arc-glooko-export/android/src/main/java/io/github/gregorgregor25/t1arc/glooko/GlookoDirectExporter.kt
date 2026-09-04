package io.github.gregorgregor25.t1arc.glooko

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.time.LocalDate
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Both consumer regions have a public-evidence connector route. The US route
 * remains labelled experimental in the UI until community field reports cover
 * the complete archive flow, but it is usable rather than artificially blocked.
 */
internal object GlookoRegionalCapability {
  fun supportsAutomaticImport(region: GlookoRegion): Boolean =
    region in setOf(GlookoRegion.EU, GlookoRegion.US)
}

internal class GlookoIssuedDownloadRegistry(
  private val maximumLeaseMs: Long,
) {
  private val issuedAtByPath = mutableMapOf<String, Long>()

  init {
    require(maximumLeaseMs > 0L)
  }

  @Synchronized
  fun issue(
    path: String,
    issuedAt: Long,
  ) {
    issuedAtByPath[path] = issuedAt
  }

  @Synchronized
  fun acknowledge(path: String): Boolean = issuedAtByPath.remove(path) != null

  @Synchronized
  fun expire(
    path: String,
    issuedAt: Long,
    now: Long,
  ): Boolean {
    if (issuedAtByPath[path] != issuedAt || now - issuedAt < maximumLeaseMs) {
      return false
    }
    issuedAtByPath.remove(path)
    return true
  }

  @Synchronized
  fun takeExpired(now: Long): List<String> =
    issuedAtByPath
      .filterValues { issuedAt -> now - issuedAt >= maximumLeaseMs }
      .keys
      .toList()
      .also { expired -> expired.forEach(issuedAtByPath::remove) }

  @Synchronized
  fun pruneMissing(exists: (String) -> Boolean) {
    issuedAtByPath.keys.removeAll { path -> !exists(path) }
  }

  @Synchronized
  fun activePaths(): Set<String> = issuedAtByPath.keys.toSet()

  @Synchronized
  fun clear() {
    issuedAtByPath.clear()
  }
}

internal data class SilentGlookoExportResult(
  val status: String,
  val uri: String? = null,
  val fileName: String? = null,
  val byteLength: Long = 0,
  val message: String? = null,
  val reason: String? = null,
  val diagnostic: String? = null,
  val credentialGeneration: Long? = null,
  val accountFingerprint: String? = null,
  val timeZone: String? = null,
)

/**
 * Adapts the direct HTTP client to the existing Expo file-result contract.
 * Downloaded archives stay in app-private cache only until TypeScript imports
 * and deletes them.
 */
internal class GlookoDirectExporter(context: Context) {
  companion object {
    private const val DOWNLOAD_DIRECTORY = "glooko-downloads"
    private const val STALE_DOWNLOAD_AGE_MS = 24L * 60L * 60L * 1_000L
    private const val MAX_ISSUED_DOWNLOAD_LEASE_MS = 15L * 60L * 1_000L
    private val running = AtomicBoolean(false)
    private val downloadLifecycleLock = Any()
    private val issuedDownloads =
      GlookoIssuedDownloadRegistry(MAX_ISSUED_DOWNLOAD_LEASE_MS)
    private val cleanupHandler by lazy { Handler(Looper.getMainLooper()) }

    /**
     * A fresh module process cannot have an import in flight, so any direct
     * download left in the private cache belongs to an interrupted prior run.
     */
    internal fun cleanOrphanedDownloads(context: Context): Boolean {
      return synchronized(downloadLifecycleLock) {
        if (running.get()) return@synchronized true
        pruneReleasedDownloads()
        val activePaths = issuedDownloads.activePaths()
        directDownloadFiles(context)
          .filterNot { file -> file.canonicalPath in activePaths }
          .map { file -> !file.exists() || file.delete() || !file.exists() }
          .all { deleted -> deleted }
      }
    }

    /** Explicit credential forget/reset removes every file in this reserved directory. */
    internal fun clearAllDownloads(context: Context): Boolean {
      synchronized(downloadLifecycleLock) {
        issuedDownloads.clear()
        return allDownloadFiles(context)
          .map { file -> !file.exists() || file.delete() }
          .all { deleted -> deleted }
      }
    }

    /** Acknowledges that JavaScript has copied the private archive into memory. */
    internal fun releaseDownload(
      context: Context,
      uriValue: String,
    ): Boolean {
      val file = directDownloadFile(context, uriValue) ?: return false
      return synchronized(downloadLifecycleLock) {
        issuedDownloads.acknowledge(file.canonicalPath)
        !file.exists() || file.delete()
      }
    }

    private fun downloadDirectory(context: Context) =
      File(context.applicationContext.cacheDir, DOWNLOAD_DIRECTORY)

    private fun allDownloadFiles(context: Context): List<File> =
      downloadDirectory(context).listFiles()?.filter(File::isFile).orEmpty()

    private fun directDownloadFiles(context: Context): List<File> =
      allDownloadFiles(context)
        .filter { file ->
          file.isFile &&
            file.name.startsWith("direct-") &&
            file.extension in setOf("zip", "pdf")
        }

    private fun directDownloadFile(
      context: Context,
      uriValue: String,
    ): File? =
      runCatching {
        val uri = Uri.parse(uriValue)
        if (!uri.scheme.equals("file", ignoreCase = true)) return@runCatching null
        val directory = downloadDirectory(context).canonicalFile
        val candidate = File(requireNotNull(uri.path)).canonicalFile
        candidate.takeIf { file ->
          file.parentFile == directory &&
            file.name.startsWith("direct-") &&
            file.extension in setOf("zip", "pdf")
        }
      }.getOrNull()

    private fun pruneReleasedDownloads(now: Long = System.currentTimeMillis()) {
      issuedDownloads.pruneMissing { path -> File(path).exists() }
      issuedDownloads.takeExpired(now).forEach { path ->
        val file = File(path)
        if (file.exists() && !file.delete()) {
          Log.w(
            "T1ArcGlooko",
            "An expired private Glooko download could not be removed; cleanup will retry later.",
          )
        }
      }
    }

    private fun registerIssuedDownload(file: File) {
      val path = file.canonicalPath
      val issuedAt = System.currentTimeMillis()
      issuedDownloads.issue(path, issuedAt)
      cleanupHandler.postDelayed(
        {
          synchronized(downloadLifecycleLock) {
            if (
              issuedDownloads.expire(
                path,
                issuedAt,
                System.currentTimeMillis(),
              )
            ) {
              val expired = File(path)
              if (expired.exists() && !expired.delete()) {
                Log.w(
                  "T1ArcGlooko",
                  "An expired private Glooko download could not be removed; cleanup will retry later.",
                )
              }
            }
          }
        },
        MAX_ISSUED_DOWNLOAD_LEASE_MS,
      )
    }
  }

  private val appContext = context.applicationContext

  suspend fun export(
    startDate: LocalDate,
    endDate: LocalDate,
  ): SilentGlookoExportResult =
    runExclusive { exportBlocking(startDate, endDate) }

  suspend fun exportRecent(days: Int): SilentGlookoExportResult =
    runExclusive { exportRecentBlocking(days) }

  suspend fun exportReport(
    startDate: LocalDate,
    endDate: LocalDate,
  ): SilentGlookoExportResult =
    runExclusive { exportReportBlocking(startDate, endDate) }

  suspend fun exportRecentReport(days: Int): SilentGlookoExportResult =
    runExclusive { exportRecentReportBlocking(days) }

  private suspend fun runExclusive(
    operation: () -> SilentGlookoExportResult,
  ): SilentGlookoExportResult =
    withContext(Dispatchers.IO) {
      val acquired =
        synchronized(downloadLifecycleLock) {
          running.compareAndSet(false, true)
        }
      val result =
        if (!acquired) {
          SilentGlookoExportResult(
            status = "cancelled",
            reason = "busy",
            message = "Another Glooko refresh is already running.",
            diagnostic = "Direct connector skipped because another attempt is active.",
          )
        } else {
          try {
            operation()
          } finally {
            synchronized(downloadLifecycleLock) {
              running.set(false)
            }
          }
        }
      persistDiagnostic(result)
      result
    }

  private fun exportRecentBlocking(days: Int): SilentGlookoExportResult {
    val vault = GlookoCredentialVault(appContext)
    val credentials = vault.read()
      ?: return SilentGlookoExportResult(
        status = "session-required",
        reason = "session-required",
        message = "Save your Glooko sign-in and confirm its export timezone before refreshing.",
        diagnostic = "Direct connector has no confirmed account timezone.",
        credentialGeneration = vault.credentialGeneration(),
      )
    val endDate = LocalDate.now(credentials.timeZone)
    return exportBlocking(
      startDate = endDate.minusDays((days - 1).toLong()),
      endDate = endDate,
      capturedCredentials = credentials,
    )
  }

  private fun exportBlocking(
    startDate: LocalDate,
    endDate: LocalDate,
    capturedCredentials: GlookoCredentials? = null,
  ): SilentGlookoExportResult {
    cleanStaleDownloads()
    val vault = GlookoCredentialVault(appContext)
    val credentials = capturedCredentials ?: vault.read()
      ?: return SilentGlookoExportResult(
        status = "session-required",
        reason = "session-required",
        message = "Save your Glooko sign-in and confirm its export timezone before refreshing.",
        diagnostic = "Direct connector has no confirmed account timezone.",
        credentialGeneration = vault.credentialGeneration(),
      )
    if (!GlookoRegionalCapability.supportsAutomaticImport(credentials.region)) {
      return SilentGlookoExportResult(
        status = "failed",
        reason = "unsupported-region",
        message = "Automatic Glooko updates are not available for this account region.",
        diagnostic = "Direct connector stopped: unsupported-region.",
        credentialGeneration = credentials.credentialGeneration,
      )
    }
    var archive: ByteArray? = null
    var destination: File? = null
    val result = try {
      val downloaded =
        GlookoDirectClient(
          credentials.region,
          timeZone = credentials.timeZone,
        ).downloadIdentifiedExport(
          credentials = credentials,
          startDate = startDate,
          endDate = endDate,
          fingerprintAccount =
            GlookoAccountFingerprint()::forAccountCode,
        )
      archive = downloaded.archive
      val directory = File(appContext.cacheDir, DOWNLOAD_DIRECTORY)
      check(directory.exists() || directory.mkdirs()) {
        "The private Glooko download directory could not be created."
      }
      destination = File(directory, "direct-${UUID.randomUUID()}.zip")
      FileOutputStream(destination).use { output -> output.write(downloaded.archive) }
      synchronized(downloadLifecycleLock) {
        registerIssuedDownload(destination)
      }
      SilentGlookoExportResult(
        status = "downloaded",
        uri = Uri.fromFile(destination).toString(),
        fileName = "glooko-export-${startDate}-to-${endDate}.zip",
        byteLength = destination.length(),
        diagnostic =
          "Direct Glooko export downloaded and validated; region=${credentials.region.name.lowercase()}.",
        accountFingerprint = downloaded.accountFingerprint,
      )
    } catch (error: GlookoDirectException) {
      synchronized(downloadLifecycleLock) {
        destination?.let { issuedDownloads.acknowledge(it.canonicalPath) }
      }
      destination?.delete()
      failureResult(error, credentials.region)
    } catch (_: Exception) {
      synchronized(downloadLifecycleLock) {
        destination?.let { issuedDownloads.acknowledge(it.canonicalPath) }
      }
      destination?.delete()
      SilentGlookoExportResult(
        status = "failed",
        reason = "device-storage",
        message = "T1 Arc could not save the Glooko update on this phone. Free some storage and try again.",
        diagnostic = "Direct connector stopped while saving its validated archive.",
      )
    } finally {
      archive?.fill(0)
    }
    return result.copy(
      credentialGeneration = credentials.credentialGeneration,
      timeZone = credentials.timeZone.id,
    )
  }

  private fun exportRecentReportBlocking(days: Int): SilentGlookoExportResult {
    val vault = GlookoCredentialVault(appContext)
    val credentials = vault.read()
      ?: return SilentGlookoExportResult(
        status = "session-required",
        reason = "session-required",
        message = "Save your Glooko sign-in and confirm its export timezone before refreshing pump activity.",
        diagnostic = "Direct report connector has no confirmed account timezone.",
        credentialGeneration = vault.credentialGeneration(),
      )
    // Preserve the inclusive span while Glooko aligns it to the authenticated
    // report end date. The account's saved clock, not the travel clock, owns it.
    val endDate = LocalDate.now(credentials.timeZone).minusDays(1)
    return exportReportBlocking(
      startDate = endDate.minusDays((days - 1).toLong()),
      endDate = endDate,
      capturedCredentials = credentials,
    )
  }

  private fun exportReportBlocking(
    startDate: LocalDate,
    endDate: LocalDate,
    capturedCredentials: GlookoCredentials? = null,
  ): SilentGlookoExportResult {
    cleanStaleDownloads()
    val vault = GlookoCredentialVault(appContext)
    val credentials = capturedCredentials ?: vault.read()
      ?: return SilentGlookoExportResult(
        status = "session-required",
        reason = "session-required",
        message = "Save your Glooko sign-in and confirm its export timezone before refreshing pump activity.",
        diagnostic = "Direct report connector has no confirmed account timezone.",
        credentialGeneration = vault.credentialGeneration(),
      )
    if (!GlookoRegionalCapability.supportsAutomaticImport(credentials.region)) {
      return SilentGlookoExportResult(
        status = "failed",
        reason = "unsupported-region",
        message = "Automatic Glooko reports are not available for this account region.",
        diagnostic = "Direct report connector stopped: unsupported-region.",
        credentialGeneration = credentials.credentialGeneration,
      )
    }
    var reportBytes: ByteArray? = null
    var destination: File? = null
    val result = try {
      val downloaded =
        GlookoDirectClient(
          credentials.region,
          timeZone = credentials.timeZone,
        ).downloadIdentifiedReport(
          credentials = credentials,
          startDate = startDate,
          endDate = endDate,
          fingerprintAccount =
            GlookoAccountFingerprint()::forAccountCode,
        )
      reportBytes = downloaded.report
      val directory = File(appContext.cacheDir, DOWNLOAD_DIRECTORY)
      check(directory.exists() || directory.mkdirs()) {
        "The private Glooko download directory could not be created."
      }
      destination = File(directory, "direct-${UUID.randomUUID()}.pdf")
      FileOutputStream(destination).use { output -> output.write(downloaded.report) }
      synchronized(downloadLifecycleLock) {
        registerIssuedDownload(destination)
      }
      SilentGlookoExportResult(
        status = "downloaded",
        uri = Uri.fromFile(destination).toString(),
        fileName =
          "glooko-daily-overview-${downloaded.startDate}-to-${downloaded.endDate}.pdf",
        byteLength = destination.length(),
        diagnostic =
          "Direct Glooko Daily Overview downloaded and validated; " +
            "region=${credentials.region.name.lowercase()}.",
        accountFingerprint = downloaded.accountFingerprint,
      )
    } catch (error: GlookoDirectException) {
      synchronized(downloadLifecycleLock) {
        destination?.let { issuedDownloads.acknowledge(it.canonicalPath) }
      }
      destination?.delete()
      failureResult(error, credentials.region)
    } catch (_: Exception) {
      synchronized(downloadLifecycleLock) {
        destination?.let { issuedDownloads.acknowledge(it.canonicalPath) }
      }
      destination?.delete()
      SilentGlookoExportResult(
        status = "failed",
        reason = "device-storage",
        message = "T1 Arc could not save the Glooko report on this phone. Free some storage and try again.",
        diagnostic = "Direct report connector stopped while saving its validated PDF.",
      )
    } finally {
      reportBytes?.fill(0)
    }
    return result.copy(
      credentialGeneration = credentials.credentialGeneration,
      timeZone = credentials.timeZone.id,
    )
  }

  private fun failureResult(
    error: GlookoDirectException,
    region: GlookoRegion,
  ): SilentGlookoExportResult {
    val reason = error.failure.name.lowercase().replace('_', '-')
    val sessionRequired =
      error.failure in
        setOf(
          GlookoDirectFailure.BAD_CREDENTIALS,
          GlookoDirectFailure.AUTHENTICATION_CHALLENGE,
          GlookoDirectFailure.REGION_MISMATCH,
          GlookoDirectFailure.SESSION_REJECTED,
        )
    return SilentGlookoExportResult(
      status = if (sessionRequired) "session-required" else "failed",
      reason =
        when (error.failure) {
          GlookoDirectFailure.BAD_CREDENTIALS -> "credentials-rejected"
          else -> reason
        },
      message = error.message,
      diagnostic =
        "Direct connector stopped: region=${region.name.lowercase()}; " +
          "code=${error.diagnosticCode ?: reason}.",
    )
  }

  private fun cleanStaleDownloads(): Boolean {
    val cutoff = System.currentTimeMillis() - STALE_DOWNLOAD_AGE_MS
    synchronized(downloadLifecycleLock) {
      pruneReleasedDownloads()
      val activePaths = issuedDownloads.activePaths()
      return directDownloadFiles(appContext)
        .filter { file ->
          file.lastModified() < cutoff &&
            file.canonicalPath !in activePaths
        }
        .map { file -> !file.exists() || file.delete() || !file.exists() }
        .all { deleted -> deleted }
    }
  }

  private fun persistDiagnostic(result: SilentGlookoExportResult) {
    result.diagnostic?.let { diagnostic ->
      Log.i("T1ArcGlooko", diagnostic)
      appContext
        .getSharedPreferences(GLOOKO_TRACE_PREFERENCES, Context.MODE_PRIVATE)
        .edit()
        .putString(GLOOKO_LAST_TRACE_KEY, diagnostic)
        .apply()
    }
  }
}
