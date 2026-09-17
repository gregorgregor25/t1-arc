package io.github.gregorgregor25.t1arc.foodlabel

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.util.Base64
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL

/** Re-encode pixels only: no EXIF, location or other original metadata survives. */
internal fun prepareFoodPhoto(bytes: ByteArray): String {
  require(bytes.size in 1..(16 * 1024 * 1024))
  val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
  BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
  require(bounds.outWidth > 0 && bounds.outHeight > 0)
  var sample = 1
  while (bounds.outWidth / sample > 1024 || bounds.outHeight / sample > 1024) sample *= 2
  var bitmap = requireNotNull(BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }))
  try {
    val exif = ExifInterface(ByteArrayInputStream(bytes))
    val matrix = Matrix().apply {
      if (exif.isFlipped) postScale(-1f, 1f)
      postRotate(exif.rotationDegrees.toFloat())
    }
    val oriented = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    if (oriented !== bitmap) { bitmap.recycle(); bitmap = oriented }
    var quality = 85
    while (true) {
      val output = ByteArrayOutputStream()
      check(bitmap.compress(Bitmap.CompressFormat.JPEG, quality, output))
      if (output.size() <= 256 * 1024) return "data:image/jpeg;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
      if (quality > 45) quality -= 15
      else {
        val smaller = Bitmap.createScaledBitmap(bitmap, (bitmap.width * 0.75).toInt().coerceAtLeast(1), (bitmap.height * 0.75).toInt().coerceAtLeast(1), true)
        bitmap.recycle(); bitmap = smaller
      }
    }
  } finally { bitmap.recycle() }
}

internal fun downloadProductPhoto(value: String): String {
  val url = URL(value)
  require(url.protocol == "https" && url.host == "images.openfoodfacts.org" && url.port == -1 && url.userInfo == null)
  val connection = url.openConnection() as HttpURLConnection
  try {
    connection.connectTimeout = 15000; connection.readTimeout = 15000
    connection.instanceFollowRedirects = false
    connection.setRequestProperty("User-Agent", "T1-Arc/Android (https://github.com/gregorgregor25/t1-arc)")
    require(connection.responseCode == 200 && connection.contentType?.startsWith("image/") == true)
    require(connection.contentLengthLong <= 3 * 1024 * 1024)
    val bytes = connection.inputStream.use { input ->
      val output = ByteArrayOutputStream(); val buffer = ByteArray(8192)
      while (true) {
        val count = input.read(buffer); if (count < 0) break
        require(output.size() + count <= 3 * 1024 * 1024)
        output.write(buffer, 0, count)
      }
      output.toByteArray()
    }
    return prepareFoodPhoto(bytes)
  } finally { connection.disconnect() }
}
