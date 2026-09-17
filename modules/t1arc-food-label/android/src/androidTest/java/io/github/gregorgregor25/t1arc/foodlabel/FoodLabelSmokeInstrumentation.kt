package io.github.gregorgregor25.t1arc.foodlabel

import android.app.Activity
import android.app.Instrumentation
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayInputStream
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.Matrix
import android.net.Uri
import android.os.Build
import android.os.Bundle
import java.io.File
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.json.JSONObject

/** Separate, emulator-only APK. Private label fixtures require an explicit opt-in. */
class FoodLabelSmokeInstrumentation : Instrumentation() {
  private var privateFixtures = false
  override fun onCreate(arguments: Bundle?) {
    super.onCreate(arguments)
    privateFixtures = arguments?.getString("privateFixtures") == "true"
    start()
  }

  override fun onStart() {
    val report = StringBuilder()
    var stage = "emulator guard"
    try {
      check(Build.HARDWARE in setOf("ranchu", "goldfish")) { "Use an Android emulator for this test." }
      runBlocking {
        stage = "synthetic image generation"
        val directory = File(targetContext.cacheDir, LABEL_IMAGE_DIRECTORY).apply { mkdirs() }
        if (privateFixtures) {
          // Optional local benchmark: never package photos or emit recognized text into logs.
          stage = "private label fixture recognition"
          val fixtures = File(targetContext.cacheDir, "qa-label-fixtures")
          val inputs = fixtures.listFiles()?.filter { it.name.matches(Regex("fixture-[1-5]\\.jpg")) }.orEmpty()
          check(inputs.isNotEmpty())
          for (input in inputs) {
            val owned = File(directory, "label-${UUID.randomUUID()}.jpg")
            input.copyTo(owned)
            val started = android.os.SystemClock.elapsedRealtime()
            val result = recognizeOwnedLabelImage(targetContext, Uri.fromFile(owned).toString())
            File(fixtures, input.nameWithoutExtension + ".json").writeText(JSONObject(result).toString())
            report.append("Fixture recognition completed in ").append(android.os.SystemClock.elapsedRealtime() - started).append(" ms\n")
          }
          report.append("PASS: private fixtures processed; results retained only in emulator test storage\n")
        }
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
        stage = "private photo normalization"
        ExifInterface(label).apply {
          setAttribute(ExifInterface.TAG_USER_COMMENT, "private test metadata")
          setLatLong(55.8, -4.2)
          saveAttributes()
        }
        val normalized = prepareFoodPhoto(label.readBytes())
        val photoBytes = Base64.decode(normalized.substringAfter(","), Base64.DEFAULT)
        check(photoBytes.size <= 256 * 1024)
        val photoBounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(photoBytes, 0, photoBytes.size, photoBounds)
        check(photoBounds.outWidth in 1..1024 && photoBounds.outHeight in 1..1024)
        val metadata = ExifInterface(ByteArrayInputStream(photoBytes))
        check(metadata.latLong == null && metadata.getAttribute(ExifInterface.TAG_USER_COMMENT) == null)
        check(runCatching { prepareFoodPhoto("invalid".toByteArray()) }.isFailure)
        report.append("PASS: bounded JPEG photo; GPS and comments removed; invalid image rejected\n")
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
        report.append("PASS: bundled detector and word model recognized synthetic label; bounded output; successful capture removed\n")

        stage = "condensed table and separate numeric column"
        val narrow = File(directory, "label-${UUID.randomUUID()}.jpg")
        val narrowBitmap = Bitmap.createBitmap(900, 1100, Bitmap.Config.ARGB_8888)
        try {
          val canvas = Canvas(narrowBitmap)
          canvas.drawColor(Color.YELLOW)
          val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK; textSize = 40f; typeface = Typeface.create("sans-serif-condensed", Typeface.NORMAL)
          }
          canvas.drawText("NUTRITION INFORMATION", 40f, 70f, paint)
          canvas.drawText("TYPICAL VALUES PER 100g", 40f, 150f, paint)
          listOf("Energy (kcal)" to "272", "Fat (g)" to "21.6", "Carbohydrate (g)" to "10.5",
            "Fibre (g)" to "5.0", "Protein (g)" to "6.4", "Of which sugars (g)" to "0.6")
            .forEachIndexed { index, pair ->
              canvas.drawText(pair.first, 40f, 250f + index * 100f, paint)
              canvas.drawText(pair.second, 730f, 250f + index * 100f, paint)
            }
          narrow.outputStream().use { check(narrowBitmap.compress(Bitmap.CompressFormat.JPEG, 95, it)) }
        } finally { narrowBitmap.recycle() }
        val narrowResult = recognizeOwnedLabelImage(targetContext, Uri.fromFile(narrow).toString())
        val narrowText = (narrowResult["lines"] as List<*>).mapNotNull { (it as? Map<*, *>)?.get("text") as? String }.joinToString(" ")
        check(listOf("100g", "272", "21.6", "10.5", "5.0", "6.4", "0.6").all { narrowText.contains(it) })
        check(!narrow.exists())
        report.append("PASS: condensed label units and separate numeric column recognized offline; photo removed\n")

        stage = "original-resolution nutrition detail"
        val large = File(directory, "label-${UUID.randomUUID()}.jpg")
        val largeBitmap = Bitmap.createBitmap(4000, 3000, Bitmap.Config.ARGB_8888)
        try {
          val canvas = Canvas(largeBitmap)
          canvas.drawColor(Color.WHITE)
          val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK; textSize = 40f; typeface = Typeface.MONOSPACE
          }
          listOf("Nutrition information", "Per 100g", "Energy 456kJ/108kcal", "Fat 0.4g",
            "Of which saturates 0g", "Carbohydrate 15.2g", "Of which sugars 0g", "Fibre 8.0g", "Protein 7.0g")
            .forEachIndexed { index, text -> canvas.drawText(text, 1200f, 900f + index * 65f, paint) }
          large.outputStream().use { check(largeBitmap.compress(Bitmap.CompressFormat.JPEG, 95, it)) }
        } finally { largeBitmap.recycle() }
        val detailResult = recognizeOwnedLabelImage(targetContext, Uri.fromFile(large).toString())
        check(detailResult.containsKey("overviewLines")) { "Detail pass was not used." }
        val detailText = (detailResult["lines"] as List<*>).mapNotNull { (it as? Map<*, *>)?.get("text") as? String }.joinToString(" ")
        check(detailText.contains("7.0g") && detailText.contains("0g")) { "Small nutrient values were not recognized." }
        check(!large.exists())
        report.append("PASS: original-resolution table reread; protein and zero values recognized; photo removed\n")

        stage = "sideways and inverted table recognition"
        for (turn in listOf(90, 180, 270)) {
          val upright = Bitmap.createBitmap(1000, 800, Bitmap.Config.ARGB_8888)
          val rotatedLabel = File(directory, "label-${UUID.randomUUID()}.jpg")
          try {
            val canvas = Canvas(upright)
            canvas.drawColor(Color.WHITE)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK; textSize = 40f; typeface = Typeface.MONOSPACE }
            listOf("Nutrition information", "Per 100g", "Carbohydrate 12.5g", "Protein 4.0g", "Fat 8.0g")
              .forEachIndexed { index, text -> canvas.drawText(text, 80f, 100f + index * 100f, paint) }
            val sideways = Bitmap.createBitmap(upright, 0, 0, upright.width, upright.height,
              Matrix().apply { postRotate(turn.toFloat()) }, true)
            try { rotatedLabel.outputStream().use { check(sideways.compress(Bitmap.CompressFormat.JPEG, 95, it)) } }
            finally { sideways.recycle() }
          } finally { if (!upright.isRecycled) upright.recycle() }
          val turned = recognizeOwnedLabelImage(targetContext, Uri.fromFile(rotatedLabel).toString())
          val recognized = (turned["lines"] as List<*>).mapNotNull { it as? Map<*, *> }
          check(recognized.any { (it["text"] as? String)?.contains("12.5g") == true })
          check(recognized.filter { (it["text"] as? String)?.contains("Carbohydrate") == true }
            .any { kotlin.math.abs((it["angle"] as Number).toDouble()) < 15 })
          check(recognized.all { ((it["elements"] as? List<*>)?.size ?: 0) <= 30 })
          check(!rotatedLabel.exists())
        }
        report.append("PASS: sideways and inverted labels normalized; bounded word boxes; photos removed\n")

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
