package io.github.gregorgregor25.t1arc.glooko

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

internal const val GLOOKO_RENDERER_DIRECTORY = "glooko-report-renderer"
internal const val GLOOKO_RENDERER_PREFIX = "t1arc-glooko-report-"
internal const val GLOOKO_RENDERER_MAX_AGE_MS = 60L * 60L * 1_000L
internal const val GLOOKO_PICKER_REPORT_MAX_AGE_MS = 24L * 60L * 60L * 1_000L
internal const val EXPO_DOCUMENT_PICKER_DIRECTORY = "DocumentPicker"

internal fun isExpiredArtifact(
  file: File,
  now: Long,
  maximumAgeMs: Long,
): Boolean {
  val modifiedAt = file.lastModified()
  return maximumAgeMs <= 0L ||
    modifiedAt <= 0L ||
    (now >= modifiedAt && now - modifiedAt >= maximumAgeMs)
}

internal fun rendererArtifacts(files: Iterable<File>): List<File> =
  files.filter { file ->
    file.isFile &&
      file.name.startsWith(GLOOKO_RENDERER_PREFIX) &&
      file.extension.equals("pdf", ignoreCase = true)
  }

internal fun manualPickerReportArtifacts(files: Iterable<File>): List<File> =
  files.filter { file ->
    file.isFile && file.extension.equals("pdf", ignoreCase = true)
  }

internal fun deletePrivateArtifacts(files: Iterable<File>): Boolean =
  files
    .map { file ->
      runCatching { !file.exists() || file.delete() || !file.exists() }
        .getOrDefault(false)
    }
    .all { deleted -> deleted }

/**
 * Owns only transient, app-private Glooko report files. It never traverses or
 * deletes a user-selected Storage Access Framework folder.
 */
internal object GlookoReportArtifactCleanup {
  private const val EXPIRY_SWEEP_DELAY_MS = 15L * 60L * 1_000L
  private val sweepScheduled = AtomicBoolean(false)
  private val cleanupHandler by lazy { Handler(Looper.getMainLooper()) }

  fun sweepAtStartup(context: Context): Boolean =
    sweep(
      context,
      rendererMaximumAgeMs = 0L,
      pickerMaximumAgeMs = 0L,
    )

  fun sweepInForeground(context: Context): Boolean =
    sweep(
      context,
      rendererMaximumAgeMs = GLOOKO_RENDERER_MAX_AGE_MS,
      pickerMaximumAgeMs = GLOOKO_PICKER_REPORT_MAX_AGE_MS,
    )

  fun scheduleExpirySweep(context: Context) {
    val applicationContext = context.applicationContext
    if (!sweepScheduled.compareAndSet(false, true)) return
    val posted =
      cleanupHandler.postDelayed(
        {
          val succeeded = sweepInForeground(applicationContext)
          sweepScheduled.set(false)
          if (!succeeded) {
            Log.w(
              "T1ArcGlooko",
              "A private Glooko staging file could not be removed; cleanup will retry later.",
            )
          }
        },
        EXPIRY_SWEEP_DELAY_MS,
      )
    if (!posted) sweepScheduled.set(false)
  }

  fun clearAll(context: Context): Boolean {
    val applicationContext = context.applicationContext
    val results =
      listOf(
        runCatching {
          GlookoDirectExporter.clearAllDownloads(applicationContext)
        }.getOrDefault(false),
        clearRendererWorkspace(applicationContext),
        runCatching {
          GlookoSharedReportInbox.clear(applicationContext)
        }.getOrDefault(false),
        clearManualPickerReports(applicationContext, maximumAgeMs = 0L),
      )
    return results.all { succeeded -> succeeded }
  }

  /** Deletes a copied picker PDF only when it resolves inside app cache. */
  fun releaseManualPickerReport(
    context: Context,
    uriValue: String,
  ): Boolean {
    val file =
      runCatching {
        val uri = Uri.parse(uriValue)
        if (!uri.scheme.equals("file", ignoreCase = true)) {
          return@runCatching null
        }
        val pickerDirectory =
          File(context.applicationContext.cacheDir, EXPO_DOCUMENT_PICKER_DIRECTORY)
            .canonicalFile
        File(requireNotNull(uri.path)).canonicalFile.takeIf { candidate ->
          candidate.parentFile == pickerDirectory &&
            candidate.extension.equals("pdf", ignoreCase = true)
        }
      }.getOrNull() ?: return false
    return deletePrivateArtifacts(listOf(file))
  }

  /** Releases only the exact persisted tree grant previously stored by T1 Arc. */
  fun releaseReportFolderGrant(
    context: Context,
    uriValue: String,
  ): Boolean {
    val requested =
      runCatching { Uri.parse(uriValue) }
        .getOrNull()
        ?.takeIf { uri -> uri.scheme.equals("content", ignoreCase = true) }
        ?: return false
    return runCatching {
      val resolver = context.applicationContext.contentResolver
      val matching =
        resolver.persistedUriPermissions.filter { permission ->
          permission.uri == requested
        }
      val flags =
        matching.fold(0) { accumulated, permission ->
          var next = accumulated
          if (permission.isReadPermission) {
            next = next or Intent.FLAG_GRANT_READ_URI_PERMISSION
          }
          if (permission.isWritePermission) {
            next = next or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
          }
          next
        }
      if (flags != 0) {
        resolver.releasePersistableUriPermission(requested, flags)
      }
      resolver.persistedUriPermissions.none { permission ->
        permission.uri == requested
      }
    }.getOrDefault(false)
  }

  private fun sweep(
    context: Context,
    rendererMaximumAgeMs: Long,
    pickerMaximumAgeMs: Long,
  ): Boolean {
    val applicationContext = context.applicationContext
    val results =
      listOf(
        runCatching {
          GlookoDirectExporter.cleanOrphanedDownloads(applicationContext)
        }.getOrDefault(false),
        clearRendererArtifacts(applicationContext, rendererMaximumAgeMs),
        runCatching {
          GlookoSharedReportInbox.sweep(applicationContext)
        }.getOrDefault(false),
        clearManualPickerReports(
          applicationContext,
          maximumAgeMs = pickerMaximumAgeMs,
        ),
      )
    scheduleExpirySweep(applicationContext)
    return results.all { succeeded -> succeeded }
  }

  private fun clearRendererArtifacts(
    context: Context,
    maximumAgeMs: Long,
    now: Long = System.currentTimeMillis(),
  ): Boolean {
    val rendererDirectory = File(context.cacheDir, GLOOKO_RENDERER_DIRECTORY)
    val current =
      rendererArtifacts(rendererDirectory.listFiles()?.toList().orEmpty())
        .filter { file -> isExpiredArtifact(file, now, maximumAgeMs) }
    val deleted = deletePrivateArtifacts(current)
    val directoryRemoved =
      runCatching {
        !rendererDirectory.exists() ||
          rendererDirectory.listFiles()?.isNotEmpty() == true ||
          rendererDirectory.delete() ||
          !rendererDirectory.exists()
      }.getOrDefault(false)
    return deleted && directoryRemoved
  }

  private fun clearRendererWorkspace(context: Context): Boolean {
    val rendererDirectory = File(context.cacheDir, GLOOKO_RENDERER_DIRECTORY)
    val directoryRemoved =
      runCatching {
        !rendererDirectory.exists() ||
          rendererDirectory.deleteRecursively() ||
          !rendererDirectory.exists()
      }.getOrDefault(false)
    return directoryRemoved
  }

  private fun clearManualPickerReports(
    context: Context,
    maximumAgeMs: Long,
    now: Long = System.currentTimeMillis(),
  ): Boolean {
    val directory = File(context.cacheDir, EXPO_DOCUMENT_PICKER_DIRECTORY)
    val reports =
      manualPickerReportArtifacts(directory.listFiles()?.toList().orEmpty())
        .filter { file -> isExpiredArtifact(file, now, maximumAgeMs) }
    return deletePrivateArtifacts(reports)
  }
}
