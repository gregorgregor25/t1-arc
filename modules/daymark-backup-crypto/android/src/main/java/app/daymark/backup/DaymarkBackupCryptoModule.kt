package app.daymark.backup

import android.content.Context
import android.net.Uri
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

class DaymarkBackupCryptoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DaymarkBackupCrypto")

    AsyncFunction("encryptJsonFileAsync") Coroutine {
        plaintextUri: String,
        passphrase: String,
      ->
      validatePassphrase(passphrase)
      withContext(Dispatchers.IO) {
        encryptJsonFile(plaintextUri, passphrase)
      }
    }

    AsyncFunction("decryptJsonFileAsync") Coroutine {
        encryptedUri: String,
        passphrase: String,
      ->
      validatePassphrase(passphrase)
      withContext(Dispatchers.IO) {
        decryptJsonFile(encryptedUri, passphrase)
      }
    }

    AsyncFunction("removeTemporaryFileAsync") Coroutine { uri: String ->
      withContext(Dispatchers.IO) {
        val file = internalFileForUri(uri)
        file?.delete() ?: false
      }
    }
  }

  private fun encryptJsonFile(
    plaintextUri: String,
    passphrase: String,
  ): Map<String, Any> {
    val context = requireNotNull(appContext.reactContext)
    val inputLength = contentLength(context, plaintextUri)
    if (inputLength <= 0L) {
      throw IllegalArgumentException("There is no health data to back up.")
    }
    if (inputLength > MAX_PLAINTEXT_BYTES) {
      throw IllegalArgumentException("The health backup is larger than the 512 MB safety limit.")
    }

    val salt = ByteArray(SALT_LENGTH)
    val nonce = ByteArray(NONCE_LENGTH)
    SecureRandom().nextBytes(salt)
    SecureRandom().nextBytes(nonce)
    val header = buildHeader(salt, nonce)
    val keyBytes = deriveKey(passphrase, salt, PBKDF2_ITERATIONS)
    val output = newTemporaryFile(context, ".daymark")

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
                limitMessage = "The health backup is larger than the 512 MB safety limit.",
              )
            }
          }
        }
      }
      return resultFor(output)
    } catch (error: Exception) {
      output.delete()
      throw IllegalStateException(
        error.message ?: "The encrypted backup could not be created.",
        error,
      )
    } finally {
      keyBytes.fill(0)
    }
  }

  private fun decryptJsonFile(
    encryptedUri: String,
    passphrase: String,
  ): Map<String, Any> {
    val context = requireNotNull(appContext.reactContext)
    val encryptedLength = contentLength(context, encryptedUri)
    if (encryptedLength <= HEADER_FIXED_LENGTH + SALT_LENGTH + NONCE_LENGTH + TAG_LENGTH_BYTES) {
      throw IllegalArgumentException("This is not a valid encrypted health backup.")
    }
    if (encryptedLength > MAX_ENCRYPTED_BYTES) {
      throw IllegalArgumentException("The encrypted backup is larger than the 256 MB safety limit.")
    }

    val output = newTemporaryFile(context, ".json")
    var keyBytes: ByteArray? = null
    try {
      openInput(context, encryptedUri).use { rawInput ->
        val input = DataInputStream(BufferedInputStream(rawInput, BUFFER_SIZE))
        val parsed = readHeader(input)
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
                limitMessage = "The restored health data exceeds the 512 MB safety limit.",
              )
            }
          }
        }
      }
      return resultFor(output)
    } catch (error: Exception) {
      output.delete()
      throw IllegalArgumentException(
        "The backup could not be unlocked. Check the passphrase and file.",
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

  private fun buildHeader(salt: ByteArray, nonce: ByteArray): ByteArray {
    val output = ByteArrayOutputStream(HEADER_FIXED_LENGTH + salt.size + nonce.size)
    output.write(MAGIC)
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

  private fun readHeader(input: DataInputStream): ParsedHeader {
    val magic = ByteArray(MAGIC.size)
    input.readFully(magic)
    if (!magic.contentEquals(MAGIC)) {
      throw IllegalArgumentException("Backup signature not recognised.")
    }
    val version = input.readUnsignedByte()
    val kdf = input.readUnsignedByte()
    if (version != FORMAT_VERSION || kdf != KDF_PBKDF2_SHA256) {
      throw IllegalArgumentException("This backup version is not supported.")
    }
    val iterations = input.readInt()
    if (iterations !in MIN_ACCEPTED_ITERATIONS..MAX_ACCEPTED_ITERATIONS) {
      throw IllegalArgumentException("Backup key settings are outside safe limits.")
    }
    val saltLength = input.readUnsignedByte()
    val nonceLength = input.readUnsignedByte()
    if (saltLength != SALT_LENGTH || nonceLength != NONCE_LENGTH) {
      throw IllegalArgumentException("Backup encryption parameters are invalid.")
    }
    val salt = ByteArray(saltLength)
    val nonce = ByteArray(nonceLength)
    input.readFully(salt)
    input.readFully(nonce)
    return ParsedHeader(
      iterations = iterations,
      salt = salt,
      nonce = nonce,
      encoded = buildHeaderForRead(iterations, salt, nonce),
    )
  }

  private fun buildHeaderForRead(
    iterations: Int,
    salt: ByteArray,
    nonce: ByteArray,
  ): ByteArray {
    val output = ByteArrayOutputStream(HEADER_FIXED_LENGTH + salt.size + nonce.size)
    output.write(MAGIC)
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
      "Use a backup passphrase between 12 and 200 characters."
    }
  }

  private fun openInput(context: Context, uriValue: String): InputStream {
    val uri = Uri.parse(uriValue)
    return when (uri.scheme?.lowercase()) {
      "content" ->
        context.contentResolver.openInputStream(uri)
          ?: throw IllegalArgumentException("The selected backup file cannot be read.")
      "file", null -> FileInputStream(requireNotNull(uri.path))
      else -> throw IllegalArgumentException("The selected backup address is not supported.")
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
    val directory = backupDirectory(context)
    cleanOldTemporaryFiles(directory)
    return File(directory, "backup-${UUID.randomUUID()}$suffix")
  }

  private fun backupDirectory(context: Context): File {
    val directory = File(context.cacheDir, "encrypted-backups")
    if (!directory.exists() && !directory.mkdirs()) {
      throw IllegalStateException("A private backup workspace could not be created.")
    }
    return directory
  }

  private fun cleanOldTemporaryFiles(directory: File) {
    val cutoff = System.currentTimeMillis() - TEMPORARY_FILE_LIFETIME_MS
    directory.listFiles()?.forEach { file ->
      if (file.lastModified() < cutoff) file.delete()
    }
  }

  private fun resultFor(file: File) =
    mapOf(
      "uri" to Uri.fromFile(file).toString(),
      "byteLength" to file.length().toDouble(),
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
    private val MAGIC = "DMKBACK1".toByteArray(Charsets.US_ASCII)
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
    private const val MAX_PLAINTEXT_BYTES = 512L * 1024L * 1024L
    private const val MAX_ENCRYPTED_BYTES = 256L * 1024L * 1024L
    private const val TEMPORARY_FILE_LIFETIME_MS = 24L * 60L * 60L * 1000L
    private const val CIPHER_TRANSFORMATION = "AES/GCM/NoPadding"
  }
}
