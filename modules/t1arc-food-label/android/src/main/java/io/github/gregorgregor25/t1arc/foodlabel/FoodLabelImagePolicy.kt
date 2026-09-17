package io.github.gregorgregor25.t1arc.foodlabel

import java.io.File
import java.nio.file.Files

internal const val LABEL_IMAGE_DIRECTORY = "food-label-capture"
internal const val MAX_LABEL_IMAGE_BYTES = 16L * 1024L * 1024L
private val LABEL_IMAGE_NAME = Regex("label-[a-fA-F0-9-]{36}\\.jpg")

/** Only an explicitly owned temporary JPEG may be read or removed by this module. */
internal fun ownedLabelImage(cacheDirectory: File, imagePath: String): File {
  val directory = File(cacheDirectory, LABEL_IMAGE_DIRECTORY).canonicalFile
  val image = File(imagePath).canonicalFile
  require(image.parentFile == directory &&
    LABEL_IMAGE_NAME.matches(image.name)) {
    "The label photo must be a temporary capture."
  }
  require(image.isFile && image.length() in 1..MAX_LABEL_IMAGE_BYTES) {
    "The label photo is missing or too large."
  }
  return image
}

/** Recover only old, owned crash remnants; never scan the shared Camera directory. */
internal fun clearAbandonedLabelImages(cacheDirectory: File, now: Long = System.currentTimeMillis()) {
  runCatching {
    val directory = File(cacheDirectory, LABEL_IMAGE_DIRECTORY).canonicalFile
    if (!directory.isDirectory) return
    Files.newDirectoryStream(directory.toPath()).use { stream ->
      stream.asSequence().take(100).forEach { path ->
        runCatching {
          val file = path.toFile().canonicalFile
          if (file.parentFile == directory && LABEL_IMAGE_NAME.matches(file.name) && file.isFile &&
            file.lastModified() in 1..(now - 60 * 60 * 1_000L)) file.delete()
        }
      }
    }
  }
}

internal fun labelImageSampleSize(width: Int, height: Int): Int {
  require(width > 0 && height > 0) { "The label photo is unreadable." }
  var sampleSize = 1
  while (width / sampleSize > 2_560 || height / sampleSize > 2_560) sampleSize *= 2
  return sampleSize
}
