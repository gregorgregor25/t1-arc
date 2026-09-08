package io.github.gregorgregor25.t1arc.foodlabel

import android.app.Activity
import android.app.Instrumentation
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import java.io.File
import java.util.UUID
import kotlinx.coroutines.runBlocking

/** Separate, emulator-only APK. No camera, real label, or app database. */
class FoodLabelSmokeInstrumentation : Instrumentation() {
  override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }

  override fun onStart() {
    val report = StringBuilder()
    var stage = "emulator guard"
    try {
      check(Build.HARDWARE in setOf("ranchu", "goldfish")) { "Use an Android emulator for this test." }
      runBlocking {
        stage = "synthetic image generation"
        val directory = File(targetContext.cacheDir, LABEL_IMAGE_DIRECTORY).apply { mkdirs() }
        val label = File(directory, "label-${UUID.randomUUID()}.jpg")
        val bitmap = Bitmap.createBitmap(1_200, 1_000, Bitmap.Config.ARGB_8888)
        try {
          val canvas = Canvas(bitmap)
          canvas.drawColor(Color.WHITE)
          val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK; textSize = 48f; typeface = Typeface.create("sans-serif", Typeface.BOLD)
          }
          listOf("NUTRITION INFORMATION", "Per 100 g", "Energy 200 kcal", "Carbohydrate 25 g",
            "Fat 8 g", "Protein 7 g", "Fibre 4 g").forEachIndexed { index, line ->
            canvas.drawText(line, 60f, 100f + index * 110f, paint)
          }
          label.outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.JPEG, 95, it)) }
        } finally { bitmap.recycle() }
        stage = "bundled OCR recognition"
        val result = recognizeOwnedLabelImage(targetContext, Uri.fromFile(label).toString())
        stage = "bounded, confident OCR output and image cleanup"
        val lines = result["lines"] as? List<*> ?: error("Missing OCR lines.")
        val text = lines.mapNotNull { (it as? Map<*, *>)?.get("text") as? String }.joinToString(" ")
        check(text.contains("Carbohydrate", ignoreCase = true) && text.contains("25")) { "Synthetic nutrient was not recognized." }
        check(text.contains("100") && text.contains("200")) { "Synthetic basis or energy was not recognized." }
        check(lines.size <= 200) { "OCR output exceeded its bound." }
        check(lines.any { line ->
          val fields = line as? Map<*, *> ?: return@any false
          (fields["text"] as? String)?.contains("Carbohydrate", ignoreCase = true) == true &&
            ((fields["confidence"] as? Number)?.toDouble() ?: 0.0) >= 0.8
        }) { "Synthetic carbohydrate confidence is insufficient for a draft." }
        check(!label.exists()) { "Successful capture was not removed." }
        report.append("PASS: bundled ML Kit recognized synthetic label; bounded output; successful capture removed\n")

        stage = "malformed image cleanup"
        val malformed = File(directory, "label-${UUID.randomUUID()}.jpg").apply { writeText("not an image") }
        check(runCatching { recognizeOwnedLabelImage(targetContext, Uri.fromFile(malformed).toString()) }.isFailure)
        check(!malformed.exists()) { "Failed capture was not removed." }
        report.append("PASS: malformed owned image rejected and removed\n")

        stage = "unowned path preservation"
        val outside = File(targetContext.cacheDir, "label-${UUID.randomUUID()}.jpg").apply { writeText("unrelated fixture") }
        try {
          check(runCatching { recognizeOwnedLabelImage(targetContext, Uri.fromFile(outside).toString()) }.isFailure)
          check(outside.exists()) { "Unowned image was deleted." }
        } finally { outside.delete() }
        report.append("PASS: unowned path rejected without deletion\n")
      }
      finish(Activity.RESULT_OK, Bundle().apply { putString("stream", report.toString()) })
    } catch (_: Throwable) {
      // Even diagnostics never emit recognized text or private filesystem paths.
      report.append("FAIL: ").append(stage).append(" did not satisfy its contract\n")
      finish(Activity.RESULT_CANCELED, Bundle().apply { putString("stream", report.toString()) })
    }
  }
}
