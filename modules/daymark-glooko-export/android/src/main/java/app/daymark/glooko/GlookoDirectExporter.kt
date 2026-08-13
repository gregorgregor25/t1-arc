package app.daymark.glooko

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import java.io.File
import java.io.FileOutputStream
import java.time.LocalDate
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

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

internal fun retiredGlookoDownloadFiles(files: Iterable<File>): List<File> =
  files.filter { file -> file.isFile && !file.name.startsWith("direct-") }

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
    internal fun cleanOrphanedDownloads(context: Context) {
      synchronized(downloadLifecycleLock) {
        if (running.get()) return
        pruneReleasedDownloads()
        val activePaths = issuedDownloads.activePaths()
        directDownloadFiles(context)
          .filterNot { file -> file.canonicalPath in activePaths }
          .forEach { file -> file.delete() }
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

    /** Upgrade cleanup for filenames produced by the retired WebView connector. */
    internal fun clearRetiredDownloads(context: Context): Boolean =
      synchronized(downloadLifecycleLock) {
        retiredGlookoDownloadFiles(allDownloadFiles(context))
          .map { file -> !file.exists() || file.delete() }
          .all { deleted -> deleted }
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
          file.isFile && file.name.startsWith("direct-") && file.extension == "zip"
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
            file.extension == "zip"
        }
      }.getOrNull()

    private fun pruneReleasedDownloads(now: Long = System.currentTimeMillis()) {
      issuedDownloads.pruneMissing { path -> File(path).exists() }
      issuedDownloads.takeExpired(now).forEach { path -> File(path).delete() }
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
              File(path).delete()
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
            exportBlocking(startDate, endDate)
          } finally {
            synchronized(downloadLifecycleLock) {
              running.set(false)
            }
          }
        }
      persistDiagnostic(result)
      result
    }

  private fun exportBlocking(
    startDate: LocalDate,
    endDate: LocalDate,
  ): SilentGlookoExportResult {
    cleanStaleDownloads()
    val vault = GlookoCredentialVault(appContext)
    val credentials = vault.read()
      ?: return SilentGlookoExportResult(
        status = "session-required",
        reason = "session-required",
        message = "Save your Glooko sign-in before refreshing.",
        diagnostic = "Direct connector has no saved credentials.",
        credentialGeneration = vault.credentialGeneration(),
      )
    if (credentials.region != GlookoRegion.EU) {
      return SilentGlookoExportResult(
        status = "failed",
        reason = "unsupported-region",
        message = "Automatic Glooko updates currently support UK accounts on Glooko's EU service only.",
        diagnostic = "Direct connector stopped: unsupported-region.",
        credentialGeneration = credentials.credentialGeneration,
      )
    }
    var archive: ByteArray? = null
    var destination: File? = null
    val result = try {
      val downloaded =
        GlookoDirectClient(credentials.region).downloadIdentifiedExport(
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
        diagnostic = "Direct Glooko export downloaded and validated.",
        accountFingerprint = downloaded.accountFingerprint,
      )
    } catch (error: GlookoDirectException) {
      synchronized(downloadLifecycleLock) {
        destination?.let { issuedDownloads.acknowledge(it.canonicalPath) }
      }
      destination?.delete()
      failureResult(error)
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
    )
  }

  private fun failureResult(error: GlookoDirectException): SilentGlookoExportResult {
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
      diagnostic = "Direct connector stopped: $reason.",
    )
  }

  private fun cleanStaleDownloads() {
    val cutoff = System.currentTimeMillis() - STALE_DOWNLOAD_AGE_MS
    synchronized(downloadLifecycleLock) {
      pruneReleasedDownloads()
      val activePaths = issuedDownloads.activePaths()
      directDownloadFiles(appContext)
        .filter { file ->
          file.lastModified() < cutoff &&
            file.canonicalPath !in activePaths
        }
        .forEach { file -> file.delete() }
    }
  }

  private fun persistDiagnostic(result: SilentGlookoExportResult) {
    result.diagnostic?.let { diagnostic ->
      appContext
        .getSharedPreferences(GLOOKO_TRACE_PREFERENCES, Context.MODE_PRIVATE)
        .edit()
        .putString(GLOOKO_LAST_TRACE_KEY, diagnostic)
        .apply()
    }
  }
}
