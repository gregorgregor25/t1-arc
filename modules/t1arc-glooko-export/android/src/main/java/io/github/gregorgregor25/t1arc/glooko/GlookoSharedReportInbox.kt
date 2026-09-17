package io.github.gregorgregor25.t1arc.glooko

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

private const val MAX_SHARED_REPORT_BYTES = 25 * 1024 * 1024
private const val MAX_PENDING_REPORTS = 4
private const val SHARED_REPORT_DIRECTORY = "glooko-shared-report-inbox"
internal const val SHARED_REPORT_MAX_AGE_MS = 7L * 24L * 60L * 60L * 1_000L

data class PendingSharedGlookoReport(
  val uri: String,
  val fileName: String,
  val byteLength: Long,
)

internal fun isPdfHeader(bytes: ByteArray): Boolean =
  bytes.size >= 5 &&
    bytes[0] == '%'.code.toByte() &&
    bytes[1] == 'P'.code.toByte() &&
    bytes[2] == 'D'.code.toByte() &&
    bytes[3] == 'F'.code.toByte() &&
    bytes[4] == '-'.code.toByte()

internal fun pruneSharedReportInbox(
  inbox: File,
  now: Long = System.currentTimeMillis(),
): Boolean {
  if (!inbox.exists()) return true
  val pdfs =
    inbox
      .listFiles { file -> file.isFile && file.extension.equals("pdf", true) }
      ?.toList()
      .orEmpty()
  val expired =
    pdfs.filter { file -> isExpiredArtifact(file, now, SHARED_REPORT_MAX_AGE_MS) }
  val overflow =
    pdfs
      .filterNot { file -> file in expired }
      .sortedByDescending(File::lastModified)
      .drop(MAX_PENDING_REPORTS)
  val removedReports =
    (expired + overflow)
      .distinctBy(File::getAbsolutePath)
      .map { file ->
        deletePrivateArtifacts(listOf(File(file.absolutePath + ".name"), file))
      }
      .all { deleted -> deleted }

  val retainedPaths =
    pdfs
      .filterNot { file -> file in expired || file in overflow }
      .map { file -> file.absolutePath }
      .toSet()
  val sidecarsAndParts =
    inbox
      .listFiles()
      ?.filter { file ->
        file.isFile &&
          (
            file.name.endsWith(".part") ||
              (
                file.name.endsWith(".pdf.name") &&
                  file.absolutePath.removeSuffix(".name") !in retainedPaths
              ) ||
              (
                !file.extension.equals("pdf", true) &&
                  !file.name.endsWith(".pdf.name")
              )
          )
      }
      .orEmpty()
  val removedSidecarsAndParts = deletePrivateArtifacts(sidecarsAndParts)
  return removedReports && removedSidecarsAndParts
}

/**
 * Private, crash-resilient hand-off for PDFs sent to T1 Arc through Android's
 * Share/Open-with sheet. The external content URI is copied while Android's
 * temporary read grant is active, then JavaScript validates and imports it.
 */
object GlookoSharedReportInbox {
  private val lock = Any()

  private fun directory(context: Context): File =
    File(context.noBackupFilesDir, SHARED_REPORT_DIRECTORY).apply { mkdirs() }

  @Suppress("DEPRECATION")
  private fun sharedUri(intent: Intent): Uri? =
    when (intent.action) {
      Intent.ACTION_VIEW -> intent.data
      Intent.ACTION_SEND ->
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
          intent.getParcelableExtra(Intent.EXTRA_STREAM)
        }
      else -> null
    }

  private fun displayName(context: Context, uri: Uri): String {
    val queried =
      runCatching {
        context.contentResolver
          .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
          ?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
          }
      }.getOrNull()
    val safe =
      (queried ?: "shared-glooko-report.pdf")
        .substringAfterLast('/')
        .substringAfterLast('\\')
        .trim()
        .take(160)
    return if (safe.lowercase().endsWith(".pdf")) safe else "$safe.pdf"
  }

  fun captureIntent(context: Context, intent: Intent?): Boolean {
    if (intent == null) return false
    val uri = sharedUri(intent) ?: return false
    if (uri.scheme != "content" && uri.scheme != "file") return false
    val mime = intent.type?.lowercase()
    if (mime != null && mime != "application/pdf" && mime != "application/octet-stream") {
      return false
    }

    return synchronized(lock) {
      val inbox = directory(context)
      val temporary = File(inbox, ".${UUID.randomUUID()}.part")
      val destination = File(inbox, "${System.currentTimeMillis()}-${UUID.randomUUID()}.pdf")
      val nameFile = File(destination.absolutePath + ".name")
      try {
        val input =
          if (uri.scheme == "file") {
            File(requireNotNull(uri.path)).inputStream()
          } else {
            requireNotNull(context.contentResolver.openInputStream(uri))
          }
        val firstBytes = ByteArray(5)
        var firstByteCount = 0
        var total = 0L
        input.use { source ->
          FileOutputStream(temporary).use { output ->
            val buffer = ByteArray(16 * 1024)
            while (true) {
              val read = source.read(buffer)
              if (read < 0) break
              total += read
              require(total <= MAX_SHARED_REPORT_BYTES) {
                "The shared report exceeds the 25 MB safety limit."
              }
              if (firstByteCount < firstBytes.size) {
                val copied = minOf(read, firstBytes.size - firstByteCount)
                buffer.copyInto(firstBytes, firstByteCount, 0, copied)
                firstByteCount += copied
              }
              output.write(buffer, 0, read)
            }
            output.fd.sync()
          }
        }
        require(total >= 5L && isPdfHeader(firstBytes)) {
          "The shared item is not a PDF."
        }
        require(temporary.renameTo(destination)) {
          "The shared report could not be retained privately."
        }
        nameFile.writeText(displayName(context, uri), Charsets.UTF_8)
        if (!pruneSharedReportInbox(inbox)) {
          Log.w(
            "T1ArcGlooko",
            "An expired shared Glooko report could not be removed; cleanup will retry later.",
          )
        }
        true
      } catch (_: Exception) {
        deletePrivateArtifacts(listOf(temporary, destination, nameFile))
        false
      }
    }
  }

  fun pending(context: Context): PendingSharedGlookoReport? {
    return synchronized(lock) {
      val inbox = directory(context)
      if (!pruneSharedReportInbox(inbox)) {
        Log.w(
          "T1ArcGlooko",
          "The shared Glooko report inbox could not be fully cleaned.",
        )
      }
      val file =
        inbox
          .listFiles { candidate ->
            candidate.isFile && candidate.extension.equals("pdf", true)
          }
          ?.minByOrNull(File::lastModified)
          ?: return@synchronized null
      val originalName =
        runCatching {
          File(file.absolutePath + ".name")
            .takeIf(File::isFile)
            ?.readText(Charsets.UTF_8)
            ?.trim()
            ?.take(160)
        }.getOrNull()
      PendingSharedGlookoReport(
        uri = Uri.fromFile(file).toString(),
        fileName = originalName?.takeIf(String::isNotBlank) ?: "shared-glooko-report.pdf",
        byteLength = file.length(),
      )
    }
  }

  fun acknowledge(context: Context, uriValue: String): Boolean {
    val requested = runCatching { Uri.parse(uriValue) }.getOrNull() ?: return false
    if (requested.scheme != "file") return false
    val inbox = runCatching { directory(context).canonicalFile }.getOrNull() ?: return false
    val file =
      runCatching { File(requireNotNull(requested.path)).canonicalFile }.getOrNull()
        ?: return false
    if (file.parentFile != inbox || !file.extension.equals("pdf", true)) return false
    return synchronized(lock) {
      deletePrivateArtifacts(listOf(File(file.absolutePath + ".name"), file))
    }
  }

  fun clear(context: Context): Boolean {
    return synchronized(lock) {
      val inbox = File(context.noBackupFilesDir, SHARED_REPORT_DIRECTORY)
      runCatching {
        !inbox.exists() || inbox.deleteRecursively() || !inbox.exists()
      }.getOrDefault(false)
    }
  }

  fun sweep(context: Context): Boolean {
    return synchronized(lock) {
      val inbox = File(context.noBackupFilesDir, SHARED_REPORT_DIRECTORY)
      pruneSharedReportInbox(inbox)
    }
  }
}
