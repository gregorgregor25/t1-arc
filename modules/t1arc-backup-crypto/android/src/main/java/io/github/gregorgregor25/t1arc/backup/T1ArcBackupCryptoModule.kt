package io.github.gregorgregor25.t1arc.backup

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.io.Serializable
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream
import javax.crypto.Cipher
import javax.crypto.CipherInputStream
import javax.crypto.CipherOutputStream
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal const val PLAINTEXT_BACKUP_PREFIX = "health-backup-"
internal const val PLAINTEXT_BACKUP_SUFFIX = ".container"
private const val ENCRYPTED_BACKUP_EXTENSION = ".t1arc"
private const val ENCRYPTED_MIGRATION_EXTENSION = ".t1arc-migration"
internal const val MAX_BACKUP_PLAINTEXT_BYTES = 512L * 1024L * 1024L
internal const val ENCRYPTED_BACKUP_LIMIT_MESSAGE =
  "The encrypted backup is larger than the maximum supported backup size."

internal enum class EncryptedDocumentKind(
  val magicText: String,
  val extension: String,
  val noun: String,
) {
  BACKUP("T1ARCBK1", ENCRYPTED_BACKUP_EXTENSION, "health backup"),
  MIGRATION("T1ARCMG1", ENCRYPTED_MIGRATION_EXTENSION, "migration bundle"),
  ;

  val magic: ByteArray
    get() = magicText.toByteArray(Charsets.US_ASCII)
}

private data class FileDigest(
  val sha256: String,
  val byteLength: Long,
)

private const val RAW_DEFLATE_BOUND_FIXED_BYTES = 7L
private const val GZIP_HEADER_BYTES = 10L
private const val GZIP_TRAILER_BYTES = 8L
private const val BACKUP_ENCRYPTION_HEADER_BYTES = 16L + 16L + 12L
private const val BACKUP_GCM_TAG_BYTES = 16L

/**
 * zlib's tight bound for the default compression parameters used by Java's
 * GZIPOutputStream in raw-DEFLATE mode. The remaining additions are the exact
 * fixed gzip wrapper, T1 Arc encryption header and AES-GCM authentication tag.
 */
internal fun maximumEncryptedBackupBytes(plaintextBytes: Long): Long {
  require(plaintextBytes >= 0L) { "The plaintext size must not be negative." }
  val rawDeflateBound =
    plaintextBytes +
      (plaintextBytes shr 12) +
      (plaintextBytes shr 14) +
      (plaintextBytes shr 25) +
      RAW_DEFLATE_BOUND_FIXED_BYTES
  return rawDeflateBound +
    GZIP_HEADER_BYTES +
    GZIP_TRAILER_BYTES +
    BACKUP_ENCRYPTION_HEADER_BYTES +
    BACKUP_GCM_TAG_BYTES
}

internal val MAX_BACKUP_ENCRYPTED_BYTES =
  maximumEncryptedBackupBytes(MAX_BACKUP_PLAINTEXT_BYTES)

internal fun validateEncryptedInputLength(
  byteLength: Long,
  minimumBytesExclusive: Long,
  maximumBytes: Long,
  invalidMessage: String = "This is not a valid encrypted health backup.",
  limitMessage: String = ENCRYPTED_BACKUP_LIMIT_MESSAGE,
) {
  // Document providers are allowed to return UNKNOWN_LENGTH (-1). The stream
  // itself remains bounded below, so an unknown value is not a reason to
  // reject an otherwise readable Drive/OneDrive/document-provider URI.
  if (byteLength < 0L) return
  require(byteLength > minimumBytesExclusive) {
    invalidMessage
  }
  require(byteLength <= maximumBytes) {
    limitMessage
  }
}

internal class MaximumByteInputStream(
  private val source: InputStream,
  private val maximumBytes: Long,
  private val limitMessage: String,
) : InputStream() {
  private var consumedBytes = 0L

  init {
    require(maximumBytes >= 0L) { "The stream limit must not be negative." }
  }

  override fun read(): Int {
    val value = source.read()
    if (value >= 0) recordRead(1L)
    return value
  }

  override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
    if (length == 0) return 0
    val read = source.read(buffer, offset, length)
    if (read > 0) recordRead(read.toLong())
    return read
  }

  override fun skip(byteCount: Long): Long {
    if (byteCount <= 0L) return 0L
    val scratch = ByteArray(minOf(8 * 1024L, byteCount).toInt())
    var skipped = 0L
    while (skipped < byteCount) {
      val read = read(
        scratch,
        0,
        minOf(scratch.size.toLong(), byteCount - skipped).toInt(),
      )
      if (read < 0) break
      skipped += read
    }
    return skipped
  }

  override fun available(): Int = source.available()

  override fun close() = source.close()

  private fun recordRead(byteCount: Long) {
    consumedBytes += byteCount
    if (consumedBytes > maximumBytes) {
      throw IllegalArgumentException(limitMessage)
    }
  }
}

internal fun expiredPlaintextBackupArtifacts(
  files: Iterable<File>,
  now: Long,
  maximumAgeMs: Long,
): List<File> =
  files.filter { file ->
    val modified = file.lastModified()
    file.isFile &&
      file.name.startsWith(PLAINTEXT_BACKUP_PREFIX) &&
      file.name.endsWith(PLAINTEXT_BACKUP_SUFFIX) &&
      modified >= 0L &&
      modified <= now &&
      now - modified >= maximumAgeMs
  }

internal fun deleteExpiredPlaintextBackupArtifacts(
  cacheDirectory: File,
  now: Long = System.currentTimeMillis(),
  maximumAgeMs: Long,
): Boolean {
  var complete = true
  expiredPlaintextBackupArtifacts(
    cacheDirectory.listFiles()?.asIterable() ?: emptyList(),
    now,
    maximumAgeMs,
  ).forEach { file ->
    if (file.exists() && !file.delete()) complete = false
  }
  return complete
}

private data class SaveRequest(
  val sourceUri: String,
  val fileName: String,
  val mimeType: String,
) : Serializable

private data class SavePickerResult(
  val destinationUri: String?,
)

private class SaveBackupContract :
  AppContextActivityResultContract<SaveRequest, SavePickerResult> {
  override fun createIntent(context: Context, input: SaveRequest): Intent =
    Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = input.mimeType.ifBlank { "application/octet-stream" }
      putExtra(Intent.EXTRA_TITLE, input.fileName)
    }

  override fun parseResult(
    input: SaveRequest,
    resultCode: Int,
    intent: Intent?,
  ): SavePickerResult =
    SavePickerResult(
      destinationUri =
        intent?.data
          ?.takeIf { resultCode == Activity.RESULT_OK }
          ?.toString(),
    )
}

class T1ArcBackupCryptoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T1ArcBackupCrypto")

    lateinit var saveLauncher:
      AppContextActivityResultLauncher<SaveRequest, SavePickerResult>

    OnCreate {
      appContext.reactContext?.let(::sweepInterruptedBackupArtifacts)
    }

    OnActivityEntersForeground {
      // OnCreate can run before a React context is available. Foreground and
      // next-use sweeps also retry any deletion the OS temporarily refused.
      appContext.reactContext?.let(::sweepInterruptedBackupArtifacts)
    }

    RegisterActivityContracts {
      saveLauncher = registerForActivityResult(SaveBackupContract())
    }

    AsyncFunction("encryptJsonFileAsync") Coroutine {
        plaintextUri: String,
        passphrase: String,
      ->
      validatePassphrase(passphrase)
      withContext(Dispatchers.IO) {
        encryptFile(plaintextUri, passphrase, EncryptedDocumentKind.BACKUP)
      }
    }

    AsyncFunction("decryptJsonFileAsync") Coroutine {
        encryptedUri: String,
        passphrase: String,
      ->
      validatePassphrase(passphrase)
      withContext(Dispatchers.IO) {
        decryptFile(encryptedUri, passphrase, EncryptedDocumentKind.BACKUP)
      }
    }

    AsyncFunction("encryptMigrationFileAsync") Coroutine {
        plaintextUri: String,
        passphrase: String,
      ->
      validatePassphrase(passphrase)
      withContext(Dispatchers.IO) {
        encryptFile(plaintextUri, passphrase, EncryptedDocumentKind.MIGRATION)
      }
    }

    AsyncFunction("decryptMigrationFileAsync") Coroutine {
        encryptedUri: String,
        passphrase: String,
      ->
      validatePassphrase(passphrase)
      withContext(Dispatchers.IO) {
        decryptFile(encryptedUri, passphrase, EncryptedDocumentKind.MIGRATION)
      }
    }

    AsyncFunction("sha256FileAsync") Coroutine { sourceUri: String ->
      withContext(Dispatchers.IO) {
        val context = requireNotNull(appContext.reactContext)
        val digest = digestInput(context, sourceUri, MAX_PLAINTEXT_BYTES)
        mapOf(
          "sha256" to digest.sha256,
          "byteLength" to digest.byteLength.toDouble(),
        )
      }
    }

    AsyncFunction("removeTemporaryFileAsync") Coroutine { uri: String ->
      withContext(Dispatchers.IO) {
        val file = internalFileForUri(uri)
        file?.delete() ?: false
      }
    }

    AsyncFunction("saveTemporaryFileAsync") Coroutine {
        sourceUri: String,
        fileName: String,
        mimeType: String,
      ->
      require(fileName.isNotBlank() && !fileName.contains('/')) {
        "The backup filename is invalid."
      }
      val source =
        internalFileForUri(sourceUri)
          ?: throw IllegalArgumentException("The temporary backup file is unavailable.")
      val picked =
        saveLauncher.launch(
          SaveRequest(
            sourceUri = sourceUri,
            fileName = fileName,
            mimeType = mimeType,
          ),
        )
      val destinationValue = picked.destinationUri
        ?: return@Coroutine mapOf("status" to "cancelled")
      val destination = Uri.parse(destinationValue)
      val context = requireNotNull(appContext.reactContext)

      withContext(Dispatchers.IO) {
        try {
          FileInputStream(source).use { input ->
            val output =
              context.contentResolver.openOutputStream(destination, "wt")
                ?: throw IllegalStateException("The selected backup file cannot be written.")
            output.use {
              copyWithLimit(
                input = BufferedInputStream(input, BUFFER_SIZE),
                output = BufferedOutputStream(it, BUFFER_SIZE),
                maximumBytes = MAX_ENCRYPTED_BYTES,
                limitMessage = ENCRYPTED_BACKUP_LIMIT_MESSAGE,
              )
            }
          }
          mapOf(
            "status" to "saved",
            "uri" to destinationValue,
            "byteLength" to source.length().toDouble(),
          )
        } catch (error: Exception) {
          runCatching { context.contentResolver.delete(destination, null, null) }
          throw IllegalStateException(
            error.message ?: "The encrypted backup could not be saved.",
            error,
          )
        }
      }
    }
  }

  private fun encryptFile(
    plaintextUri: String,
    passphrase: String,
    kind: EncryptedDocumentKind,
  ): Map<String, Any> {
    val context = requireNotNull(appContext.reactContext)
    val inputLength = contentLength(context, plaintextUri)
    if (inputLength <= 0L) {
      throw IllegalArgumentException("There is no ${kind.noun} data to protect.")
    }
    if (inputLength > MAX_PLAINTEXT_BYTES) {
      throw IllegalArgumentException("The ${kind.noun} is larger than the 512 MB safety limit.")
    }

    val plaintextDigest = digestInput(context, plaintextUri, MAX_PLAINTEXT_BYTES)
    val salt = ByteArray(SALT_LENGTH)
    val nonce = ByteArray(NONCE_LENGTH)
    SecureRandom().nextBytes(salt)
    SecureRandom().nextBytes(nonce)
    val header = buildHeader(kind, salt, nonce)
    val keyBytes = deriveKey(passphrase, salt, PBKDF2_ITERATIONS)
    val output = newTemporaryFile(context, kind.extension)

    try {
      val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
      cipher.init(
        Cipher.ENCRYPT_MODE,
        SecretKeySpec(keyBytes, "AES"),
        GCMParameterSpec(TAG_LENGTH_BITS, nonce),
      )
      cipher.updateAAD(header)

      openInput(context, plaintextUri).use { input ->
        FileOutputStream(output).use { fileOutput ->
          val buffered = BufferedOutputStream(fileOutput, BUFFER_SIZE)
          buffered.write(header)
          CipherOutputStream(buffered, cipher).use { encrypted ->
            GZIPOutputStream(encrypted, BUFFER_SIZE).use { compressed ->
              copyWithLimit(
                input = BufferedInputStream(input, BUFFER_SIZE),
                output = compressed,
                maximumBytes = MAX_PLAINTEXT_BYTES,
                limitMessage = "The ${kind.noun} is larger than the 512 MB safety limit.",
              )
            }
          }
        }
      }
      if (output.length() > MAX_ENCRYPTED_BYTES) {
        throw IllegalStateException(
          "The encrypted ${kind.noun} is larger than the maximum supported size.",
        )
      }
      return resultFor(output, plaintextDigest.sha256)
    } catch (error: Exception) {
      output.delete()
      throw IllegalStateException(
        error.message ?: "The encrypted ${kind.noun} could not be created.",
        error,
      )
    } finally {
      keyBytes.fill(0)
    }
  }

  private fun decryptFile(
    encryptedUri: String,
    passphrase: String,
    kind: EncryptedDocumentKind,
  ): Map<String, Any> {
    val context = requireNotNull(appContext.reactContext)
    val encryptedLength = contentLength(context, encryptedUri)
    val encryptedLimitMessage =
      "The encrypted ${kind.noun} is larger than the maximum supported size."
    validateEncryptedInputLength(
      encryptedLength,
      (HEADER_FIXED_LENGTH + SALT_LENGTH + NONCE_LENGTH + TAG_LENGTH_BYTES).toLong(),
      MAX_ENCRYPTED_BYTES,
      invalidMessage = "This is not a valid encrypted ${kind.noun}.",
      limitMessage = encryptedLimitMessage,
    )

    val output = newTemporaryFile(context, ".json")
    var keyBytes: ByteArray? = null
    try {
      openInput(context, encryptedUri).use { rawInput ->
        val boundedInput =
          MaximumByteInputStream(
            rawInput,
            MAX_ENCRYPTED_BYTES,
            encryptedLimitMessage,
          )
        val input = DataInputStream(BufferedInputStream(boundedInput, BUFFER_SIZE))
        val parsed = readHeader(input, kind)
        keyBytes = deriveKey(passphrase, parsed.salt, parsed.iterations)
        val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
        cipher.init(
          Cipher.DECRYPT_MODE,
          SecretKeySpec(keyBytes, "AES"),
          GCMParameterSpec(TAG_LENGTH_BITS, parsed.nonce),
        )
        cipher.updateAAD(parsed.encoded)

        CipherInputStream(input, cipher).use { decrypted ->
          GZIPInputStream(decrypted, BUFFER_SIZE).use { expanded ->
            FileOutputStream(output).use { fileOutput ->
              copyWithLimit(
                input = expanded,
                output = BufferedOutputStream(fileOutput, BUFFER_SIZE),
                maximumBytes = MAX_PLAINTEXT_BYTES,
                limitMessage = "The unlocked ${kind.noun} exceeds the 512 MB safety limit.",
              )
            }
          }
        }
      }
      return resultFor(output, digestFile(output).sha256)
    } catch (error: Exception) {
      output.delete()
      var cause: Throwable? = error
      var exceededEncryptedLimit = false
      while (cause != null) {
        if (cause.message == encryptedLimitMessage) {
          exceededEncryptedLimit = true
          break
        }
        cause = cause.cause
      }
      throw IllegalArgumentException(
        if (exceededEncryptedLimit) {
          encryptedLimitMessage
        } else {
          "The ${kind.noun} could not be unlocked. Check the passphrase and file."
        },
        error,
      )
    } finally {
      keyBytes?.fill(0)
    }
  }

  private data class ParsedHeader(
    val iterations: Int,
    val salt: ByteArray,
    val nonce: ByteArray,
    val encoded: ByteArray,
  )

  private fun buildHeader(
    kind: EncryptedDocumentKind,
    salt: ByteArray,
    nonce: ByteArray,
  ): ByteArray {
    val output = ByteArrayOutputStream(HEADER_FIXED_LENGTH + salt.size + nonce.size)
    output.write(kind.magic)
    output.write(FORMAT_VERSION)
    output.write(KDF_PBKDF2_SHA256)
    output.write(
      byteArrayOf(
        (PBKDF2_ITERATIONS ushr 24).toByte(),
        (PBKDF2_ITERATIONS ushr 16).toByte(),
        (PBKDF2_ITERATIONS ushr 8).toByte(),
        PBKDF2_ITERATIONS.toByte(),
      ),
    )
    output.write(salt.size)
    output.write(nonce.size)
    output.write(salt)
    output.write(nonce)
    return output.toByteArray()
  }

  private fun readHeader(
    input: DataInputStream,
    kind: EncryptedDocumentKind,
  ): ParsedHeader {
    val expectedMagic = kind.magic
    val magic = ByteArray(expectedMagic.size)
    input.readFully(magic)
    if (!magic.contentEquals(expectedMagic)) {
      throw IllegalArgumentException("Migration or backup signature not recognised.")
    }
    val version = input.readUnsignedByte()
    val kdf = input.readUnsignedByte()
    if (version != FORMAT_VERSION || kdf != KDF_PBKDF2_SHA256) {
      throw IllegalArgumentException("This encrypted document version is not supported.")
    }
    val iterations = input.readInt()
    if (iterations !in MIN_ACCEPTED_ITERATIONS..MAX_ACCEPTED_ITERATIONS) {
      throw IllegalArgumentException("Encryption key settings are outside safe limits.")
    }
    val saltLength = input.readUnsignedByte()
    val nonceLength = input.readUnsignedByte()
    if (saltLength != SALT_LENGTH || nonceLength != NONCE_LENGTH) {
      throw IllegalArgumentException("Encryption parameters are invalid.")
    }
    val salt = ByteArray(saltLength)
    val nonce = ByteArray(nonceLength)
    input.readFully(salt)
    input.readFully(nonce)
    return ParsedHeader(
      iterations = iterations,
      salt = salt,
      nonce = nonce,
      encoded = buildHeaderForRead(kind, iterations, salt, nonce),
    )
  }

  private fun buildHeaderForRead(
    kind: EncryptedDocumentKind,
    iterations: Int,
    salt: ByteArray,
    nonce: ByteArray,
  ): ByteArray {
    val output = ByteArrayOutputStream(HEADER_FIXED_LENGTH + salt.size + nonce.size)
    output.write(kind.magic)
    output.write(FORMAT_VERSION)
    output.write(KDF_PBKDF2_SHA256)
    output.write(
      byteArrayOf(
        (iterations ushr 24).toByte(),
        (iterations ushr 16).toByte(),
        (iterations ushr 8).toByte(),
        iterations.toByte(),
      ),
    )
    output.write(salt.size)
    output.write(nonce.size)
    output.write(salt)
    output.write(nonce)
    return output.toByteArray()
  }

  private fun deriveKey(
    passphrase: String,
    salt: ByteArray,
    iterations: Int,
  ): ByteArray {
    val characters = passphrase.toCharArray()
    val specification = PBEKeySpec(characters, salt, iterations, KEY_LENGTH_BITS)
    return try {
      SecretKeyFactory
        .getInstance("PBKDF2WithHmacSHA256")
        .generateSecret(specification)
        .encoded
    } finally {
      specification.clearPassword()
      characters.fill('\u0000')
    }
  }

  private fun validatePassphrase(passphrase: String) {
    require(passphrase.length in MIN_PASSPHRASE_LENGTH..MAX_PASSPHRASE_LENGTH) {
      "Use a passphrase between 12 and 200 characters."
    }
  }

  private fun openInput(context: Context, uriValue: String): InputStream {
    val uri = Uri.parse(uriValue)
    return when (uri.scheme?.lowercase()) {
      "content" ->
        context.contentResolver.openInputStream(uri)
          ?: throw IllegalArgumentException("The selected encrypted document cannot be read.")
      "file", null -> FileInputStream(requireNotNull(uri.path))
      else -> throw IllegalArgumentException("The selected document address is not supported.")
    }
  }

  private fun contentLength(context: Context, uriValue: String): Long {
    val uri = Uri.parse(uriValue)
    return when (uri.scheme?.lowercase()) {
      "content" ->
        context.contentResolver
          .openAssetFileDescriptor(uri, "r")
          ?.use { descriptor -> descriptor.length }
          ?: -1L
      "file", null -> File(requireNotNull(uri.path)).length()
      else -> -1L
    }
  }

  private fun digestInput(
    context: Context,
    uriValue: String,
    maximumBytes: Long,
  ): FileDigest = openInput(context, uriValue).use { input ->
    digestStream(input, maximumBytes)
  }

  private fun digestFile(file: File): FileDigest =
    FileInputStream(file).use { input ->
      digestStream(input, MAX_PLAINTEXT_BYTES)
    }

  private fun digestStream(
    input: InputStream,
    maximumBytes: Long,
  ): FileDigest {
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(BUFFER_SIZE)
    var total = 0L
    while (true) {
      val read = input.read(buffer)
      if (read < 0) break
      total += read
      if (total > maximumBytes) {
        throw IllegalArgumentException(
          "The file exceeds the 512 MB migration and backup safety limit.",
        )
      }
      digest.update(buffer, 0, read)
    }
    return FileDigest(
      sha256 = digest.digest().joinToString("") { byte ->
        (byte.toInt() and 0xff).toString(16).padStart(2, '0')
      },
      byteLength = total,
    )
  }

  private fun internalFileForUri(uriValue: String): File? {
    val context = appContext.reactContext ?: return null
    val uri = Uri.parse(uriValue)
    if (uri.scheme != "file") return null
    val candidate = File(uri.path ?: return null).canonicalFile
    val directory = backupDirectory(context).canonicalFile
    return candidate.takeIf {
      it.parentFile == directory && it.name.startsWith("backup-")
    }
  }

  private fun newTemporaryFile(context: Context, suffix: String): File {
    sweepInterruptedBackupArtifacts(context)
    val directory = backupDirectory(context)
    return File(directory, "backup-${UUID.randomUUID()}$suffix")
  }

  private fun backupDirectory(context: Context): File {
    val directory = File(context.cacheDir, "encrypted-backups")
    if (!directory.exists() && !directory.mkdirs()) {
      throw IllegalStateException("A private backup workspace could not be created.")
    }
    return directory
  }

  private fun sweepInterruptedBackupArtifacts(context: Context) {
    cleanOldTemporaryFiles(backupDirectory(context))
    deleteExpiredPlaintextBackupArtifacts(
      context.cacheDir,
      maximumAgeMs = TEMPORARY_FILE_LIFETIME_MS,
    )
  }

  private fun cleanOldTemporaryFiles(directory: File) {
    val cutoff = System.currentTimeMillis() - TEMPORARY_FILE_LIFETIME_MS
    directory.listFiles()?.forEach { file ->
      if (file.lastModified() < cutoff) file.delete()
    }
  }

  private fun resultFor(file: File, plaintextSha256: String) =
    mapOf(
      "uri" to Uri.fromFile(file).toString(),
      "byteLength" to file.length().toDouble(),
      "plaintextSha256" to plaintextSha256,
    )

  private fun copyWithLimit(
    input: InputStream,
    output: java.io.OutputStream,
    maximumBytes: Long,
    limitMessage: String,
  ) {
    val buffer = ByteArray(BUFFER_SIZE)
    var total = 0L
    while (true) {
      val read = input.read(buffer)
      if (read < 0) break
      total += read
      if (total > maximumBytes) throw IllegalArgumentException(limitMessage)
      output.write(buffer, 0, read)
    }
    output.flush()
  }

  companion object {
    private const val FORMAT_VERSION = 1
    private const val KDF_PBKDF2_SHA256 = 1
    private const val PBKDF2_ITERATIONS = 600_000
    private const val MIN_ACCEPTED_ITERATIONS = 300_000
    private const val MAX_ACCEPTED_ITERATIONS = 2_000_000
    private const val SALT_LENGTH = 16
    private const val NONCE_LENGTH = 12
    private const val TAG_LENGTH_BYTES = 16
    private const val TAG_LENGTH_BITS = TAG_LENGTH_BYTES * 8
    private const val KEY_LENGTH_BITS = 256
    private const val HEADER_FIXED_LENGTH = 16
    private const val BUFFER_SIZE = 64 * 1024
    private const val MIN_PASSPHRASE_LENGTH = 12
    private const val MAX_PASSPHRASE_LENGTH = 200
    private const val MAX_PLAINTEXT_BYTES = MAX_BACKUP_PLAINTEXT_BYTES
    private val MAX_ENCRYPTED_BYTES = MAX_BACKUP_ENCRYPTED_BYTES
    private const val TEMPORARY_FILE_LIFETIME_MS = 24L * 60L * 60L * 1000L
    private const val CIPHER_TRANSFORMATION = "AES/GCM/NoPadding"
  }
}
