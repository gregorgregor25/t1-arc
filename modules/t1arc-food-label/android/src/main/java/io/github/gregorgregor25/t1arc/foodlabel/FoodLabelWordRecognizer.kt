// Preprocessing/CTC algorithm adapted from PaddleOCR / RapidOCR (Apache-2.0).
// Copyright (c) 2020 PaddlePaddle Authors; RapidAI contributors.
// See the bundled food-label-notices for licenses and modifications.
package io.github.gregorgregor25.t1arc.foodlabel

import android.content.Context
import android.graphics.Bitmap
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import com.google.mlkit.vision.text.Text
import java.nio.FloatBuffer
import java.security.MessageDigest
import kotlin.math.ceil
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/** ML Kit locates words; the bundled English model transcribes their pixels.
 * Recognition stays local. No digit substitution, numeric whitelist or label lookup.
 */
internal class FoodLabelWordRecognizer(context: Context) : AutoCloseable {
  private val environment = OrtEnvironment.getEnvironment()
  private val session: OrtSession
  private val alphabet: List<String>
  init {
    val model = context.assets.open("t1arc-ocr/en-v4.onnx").use { it.readBytes() }
    require(MessageDigest.getInstance("SHA-256").digest(model).joinToString("") { "%02x".format(it) } ==
      "e8770c967605983d1570cdf5352041dfb68fa0c21664f49f47b155abd3e0e318")
    session = OrtSession.SessionOptions().use { options ->
      options.setIntraOpNumThreads(2)
      options.setInterOpNumThreads(1)
      environment.createSession(model, options)
    }
    try {
      val characters = requireNotNull(session.metadata.customMetadata["character"]).split('\n').dropLastWhile { it.isEmpty() }
      alphabet = listOf("") + characters + " "
      require(alphabet.size == 97)
    } catch (error: Exception) {
      session.close()
      throw error
    }
  }

  suspend fun read(bitmap: Bitmap, located: Text): List<Map<String, Any>> {
    val lines = located.textBlocks.flatMap { it.lines }.take(200)
    val region = nutritionDetailBox(lines.mapNotNull { line -> line.boundingBox?.let {
      LocatedLabelText(line.text, LabelBox(it.left, it.top, it.right, it.bottom))
    } }, bitmap.width, bitmap.height) ?: return emptyList()
    var count = 0
    return lines.filter { line -> line.boundingBox?.let { it.bottom >= region.top && it.top <= region.bottom } == true }
      .mapNotNull lineLoop@ { line ->
        currentCoroutineContext().ensureActive()
        if (count + line.elements.size > 160) return@lineLoop null
        val elements = line.elements.take(30).mapNotNull wordLoop@ { element ->
          currentCoroutineContext().ensureActive()
          val box = element.boundingBox ?: return@wordLoop null
          if (box.width() <= 0 || box.height() <= 0) return@wordLoop null
          count++
          val padding = ceil(box.height() * 0.12).toInt()
          val left = (box.left - padding).coerceIn(0, bitmap.width - 1)
          val top = (box.top - padding).coerceIn(0, bitmap.height - 1)
          val right = (box.right + padding).coerceIn(left + 1, bitmap.width)
          val bottom = (box.bottom + padding).coerceIn(top + 1, bitmap.height)
          val cropped = Bitmap.createBitmap(bitmap, left, top, right - left, bottom - top)
          val read = try { recognizeWord(cropped) } finally { if (cropped !== bitmap) cropped.recycle() }
          mapOf<String, Any>("text" to read.first, "confidence" to read.second,
            "left" to box.left, "top" to box.top, "width" to box.width(), "height" to box.height(), "angle" to element.angle.toDouble())
        }
        if (elements.isEmpty()) return@lineLoop null
        val original = line.text
        // Keep confidently located nutrient names, never original numeric values.
        // This avoids a stray mark turning "of which" into "0 which" on curved packs.
        val labelOnly = !original.any { it.isDigit() } && line.confidence >= 0.6f &&
          Regex("^\\s*(energy|calories|fat|protein|carbohydrate|fibre|fiber|salt|of which)\\b", RegexOption.IGNORE_CASE).containsMatchIn(original)
        val frame = requireNotNull(line.boundingBox)
        mapOf("text" to if (labelOnly) original.take(600) else elements.joinToString(" ") { it["text"] as String }.take(600),
          "confidence" to if (labelOnly) line.confidence.toDouble() else elements.map { it["confidence"] as Double }.average(),
          "left" to frame.left, "top" to frame.top, "width" to frame.width(), "height" to frame.height(),
          "angle" to line.angle.toDouble(), "elements" to elements)
      }
  }

  private fun recognizeWord(bitmap: Bitmap): Pair<String, Double> {
    val height = 48
    val resizedWidth = ceil(height.toDouble() * bitmap.width / bitmap.height).toInt().coerceIn(1, 1024)
    val width = maxOf(320, resizedWidth)
    val resized = Bitmap.createScaledBitmap(bitmap, resizedWidth, height, true)
    val pixels = IntArray(resizedWidth * height)
    try { resized.getPixels(pixels, 0, resizedWidth, 0, 0, resizedWidth, height) }
    finally { if (resized !== bitmap) resized.recycle() }
    val input = FloatArray(3 * height * width)
    for (y in 0 until height) for (x in 0 until resizedWidth) {
      val pixel = pixels[y * resizedWidth + x]
      // Paddle's published recognizer normalizes BGR channels to [-1, 1].
      for (channel in 0..2) input[channel * height * width + y * width + x] =
        ((pixel shr (channel * 8)) and 255) / 127.5f - 1f
    }
    return OnnxTensor.createTensor(environment, FloatBuffer.wrap(input), longArrayOf(1, 3, height.toLong(), width.toLong())).use { tensor ->
      session.run(mapOf(session.inputNames.first() to tensor)).use { result ->
        val output = result[0] as OnnxTensor
        val shape = output.info.shape
        require(shape.size == 3 && shape[0] == 1L && shape[2] == alphabet.size.toLong() && shape[1] <= 512)
        val probabilities = output.floatBuffer
        var previous = -1
        var confidence = 0.0
        var characters = 0
        val text = StringBuilder()
        repeat(shape[1].toInt()) {
          var index = 0
          var probability = -1f
          for (candidate in alphabet.indices) {
            val value = probabilities.get()
            if (value > probability) { index = candidate; probability = value }
          }
          if (index != 0 && index != previous && characters < 80) {
            text.append(alphabet[index]); confidence += probability; characters++
          }
          previous = index
        }
        text.toString() to if (characters > 0) confidence / characters else 0.0
      }
    }
  }
  override fun close() { session.close() }
}
