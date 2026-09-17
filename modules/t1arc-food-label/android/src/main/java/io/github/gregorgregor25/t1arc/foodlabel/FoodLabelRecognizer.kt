package io.github.gregorgregor25.t1arc.foodlabel

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapRegionDecoder
import android.graphics.Rect
import android.graphics.Matrix
import androidx.core.net.toUri
import androidx.exifinterface.media.ExifInterface
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
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
    val overviewSample = labelImageSampleSize(bounds.outWidth, bounds.outHeight)
    val bitmap = requireNotNull(BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply {
      inSampleSize = overviewSample
    })) { "The label photo is unreadable." }
    val orientation = ExifInterface(file.path).getAttributeInt(
      ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL,
    )
    var rotation = when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90 -> 90
      ExifInterface.ORIENTATION_ROTATE_180 -> 180
      ExifInterface.ORIENTATION_ROTATE_270 -> 270
      else -> 0
    }
    val decodedWidth = bitmap.width
    val decodedHeight = bitmap.height
    val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    var wordRecognizer: FoodLabelWordRecognizer? = null
    suspend fun readWords(text: Text, decode: () -> Bitmap): List<Map<String, Any>> {
      val reader = wordRecognizer ?: FoodLabelWordRecognizer(context).also { wordRecognizer = it }
      val source = decode()
      var upright = source
      try {
        if (rotation != 0) upright = Bitmap.createBitmap(source, 0, 0, source.width, source.height,
          Matrix().apply { postRotate(rotation.toFloat()) }, true)
        return reader.read(upright, text)
      } finally {
        if (upright !== source) upright.recycle()
        source.recycle()
      }
    }
    try {
      return withTimeout(15_000L) {
        var overview = recognizeBitmap(recognizer, bitmap, rotation)
        val correction = labelQuarterTurn(overview.textBlocks.flatMap { it.lines }.take(200)
          .map { it.text to it.angle })
        if (correction != 0) {
          rotation = (rotation + correction) % 360
          val upright = requireNotNull(BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply {
            inSampleSize = overviewSample
          }))
          overview = recognizeBitmap(recognizer, upright, rotation)
        }
        val rotatedWidth = if (rotation == 90 || rotation == 270) decodedHeight else decodedWidth
        val rotatedHeight = if (rotation == 90 || rotation == 270) decodedWidth else decodedHeight
        val located = overview.textBlocks.flatMap { it.lines }.take(200).mapNotNull { line ->
          line.boundingBox?.let { LocatedLabelText(line.text, LabelBox(it.left, it.top, it.right, it.bottom)) }
        }
        val detailBox = nutritionDetailBox(located, rotatedWidth, rotatedHeight)
        if (detailBox == null) return@withTimeout mapOf("lines" to recognizedLines(overview))
        val overviewLines = readWords(overview) {
          requireNotNull(BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = overviewSample }))
        }
        val crop = sourceLabelBox(detailBox, rotation, decodedWidth, decodedHeight, bounds.outWidth, bounds.outHeight)
        val detailSample = labelImageSampleSize(crop.width, crop.height)
        val magnify = detailSample == 1 && maxOf(crop.width, crop.height) <= 1280
        if (detailSample >= overviewSample && !magnify) return@withTimeout mapOf("lines" to overviewLines)
        try {
          // Decode only the table from the original JPEG, avoiding a full-resolution
          // photograph allocation. Each pass stays within the existing bitmap bound.
          fun decodeDetail(): Bitmap {
            @Suppress("DEPRECATION")
            val decoder = requireNotNull(BitmapRegionDecoder.newInstance(file.path, false))
            var detail = try {
              requireNotNull(decoder.decodeRegion(Rect(crop.left, crop.top, crop.right, crop.bottom),
                BitmapFactory.Options().apply { inSampleSize = detailSample }))
            } finally { decoder.recycle() }
            if (magnify) {
              val enlarged = Bitmap.createScaledBitmap(detail, detail.width * 2, detail.height * 2, true)
              if (enlarged !== detail) detail.recycle()
              detail = enlarged
            }
            return detail
          }
          val detailed = recognizeBitmap(recognizer, decodeDetail(), rotation)
          val detailLines = readWords(detailed, ::decodeDetail)
          if (detailLines.isEmpty()) mapOf("lines" to overviewLines)
          else mapOf("lines" to detailLines, "overviewLines" to overviewLines)
        } catch (cancelled: CancellationException) {
          throw cancelled
        } catch (_: Exception) {
          mapOf("lines" to overviewLines)
        }
      }
    } finally {
      recognizer.close()
      wordRecognizer?.close()
    }
  } catch (_: Exception) {
    // Provider exceptions can contain file paths; expose only fixed, private-safe copy.
    throw IllegalStateException("The label could not be read. Try a clearer photo or enter its values.")
  } finally {
    imageFile?.delete()
  }
}

private fun recognizedLines(result: Text): List<Map<String, Any>> =
  result.textBlocks.flatMap { it.lines }.take(200).map { line ->
    val frame = line.boundingBox
    mapOf("text" to line.text.take(600), "confidence" to line.confidence.toDouble(),
      "left" to (frame?.left ?: 0), "top" to (frame?.top ?: 0),
      "width" to (frame?.width() ?: 0), "height" to (frame?.height() ?: 0),
      "angle" to line.angle.toDouble(),
      "elements" to line.elements.take(30).map { element ->
        val box = element.boundingBox
        mapOf("text" to element.text.take(80), "confidence" to element.confidence.toDouble(),
          "left" to (box?.left ?: 0), "top" to (box?.top ?: 0),
          "width" to (box?.width() ?: 0), "height" to (box?.height() ?: 0), "angle" to element.angle.toDouble())
      })
  }

private suspend fun recognizeBitmap(recognizer: TextRecognizer, bitmap: Bitmap, rotation: Int): Text =
  suspendCancellableCoroutine { continuation ->
    var pixels = bitmap
    try {
      if (rotation != 0) {
        pixels = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height,
          Matrix().apply { postRotate(rotation.toFloat()) }, true)
        if (pixels !== bitmap) bitmap.recycle()
      }
      val taskBitmap = pixels
      recognizer.process(InputImage.fromBitmap(taskBitmap, 0))
        .addOnSuccessListener { result -> if (continuation.isActive) continuation.resume(result) }
        .addOnFailureListener {
          if (continuation.isActive) continuation.resumeWithException(IllegalStateException("The label could not be read."))
        }
        // A timed-out task may still be reading pixels; release only when it finishes.
        .addOnCompleteListener { taskBitmap.recycle() }
    } catch (error: Exception) {
      pixels.recycle()
      if (!bitmap.isRecycled) bitmap.recycle()
      if (continuation.isActive) continuation.resumeWithException(error)
    }
  }
