package io.github.gregorgregor25.t1arc.foodlabel

import android.content.Context
import android.graphics.BitmapFactory
import androidx.core.net.toUri
import androidx.exifinterface.media.ExifInterface
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout

/** The production pipeline is also exercised by the emulator's synthetic-image test. */
internal suspend fun recognizeOwnedLabelImage(context: Context, uriValue: String): Map<String, Any> {
  var imageFile: File? = null
  try {
    val uri = uriValue.toUri()
    require(uri.scheme == "file") { "Only a temporary label photo can be read." }
    val file = ownedLabelImage(context.cacheDir, requireNotNull(uri.path))
    imageFile = file
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    val bitmap = requireNotNull(BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply {
      inSampleSize = labelImageSampleSize(bounds.outWidth, bounds.outHeight)
    })) { "The label photo is unreadable." }
    val orientation = ExifInterface(file.path).getAttributeInt(
      ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL,
    )
    val rotation = when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90 -> 90
      ExifInterface.ORIENTATION_ROTATE_180 -> 180
      ExifInterface.ORIENTATION_ROTATE_270 -> 270
      else -> 0
    }
    val image = InputImage.fromBitmap(bitmap, rotation)
    val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    try {
      return withTimeout(15_000L) {
        suspendCancellableCoroutine { continuation ->
          recognizer.process(image)
            .addOnSuccessListener { result ->
              val lines = result.textBlocks.flatMap { it.lines }.take(200).map { line ->
                val frame = line.boundingBox
                mapOf(
                  "text" to line.text.take(600),
                  "confidence" to line.confidence.toDouble(),
                  "left" to (frame?.left ?: 0),
                  "top" to (frame?.top ?: 0),
                  "width" to (frame?.width() ?: 0),
                  "height" to (frame?.height() ?: 0),
                )
              }
              if (continuation.isActive) continuation.resume(mapOf("lines" to lines))
            }
            .addOnFailureListener {
              if (continuation.isActive) continuation.resumeWithException(
                IllegalStateException("The label could not be read. Try a clearer photo."),
              )
            }
            // A timed-out ML Kit task may still be reading these pixels.
            .addOnCompleteListener { bitmap.recycle() }
        }
      }
    } finally {
      recognizer.close()
    }
  } catch (_: Exception) {
    // Provider exceptions can contain file paths; expose only fixed, private-safe copy.
    throw IllegalStateException("The label could not be read. Try a clearer photo or enter its values.")
  } finally {
    imageFile?.delete()
  }
}
