package io.github.gregorgregor25.t1arc.foodlabel

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import android.net.Uri

class T1ArcFoodLabelModule : Module() {
  private val reading = AtomicBoolean(false)

  override fun definition() = ModuleDefinition {
    Name("T1ArcFoodLabel")

    OnCreate {
      appContext.reactContext?.let { clearAbandonedLabelImages(it.cacheDir) }
    }

    AsyncFunction("preparePhotoAsync") Coroutine { uriValue: String ->
      withContext(Dispatchers.IO) {
        val uri = Uri.parse(uriValue)
        require(uri.scheme == "file")
        val file = ownedLabelImage(requireNotNull(appContext.reactContext).cacheDir, requireNotNull(uri.path))
        try { prepareFoodPhoto(file.readBytes()) } finally { file.delete() }
      }
    }

    AsyncFunction("productPhotoAsync") Coroutine { url: String ->
      withContext(Dispatchers.IO) {
        try { downloadProductPhoto(url) } catch (_: Exception) { throw IllegalStateException("The product photo is unavailable.") }
      }
    }

    AsyncFunction("recognizeAsync") Coroutine { uriValue: String ->
      withContext(Dispatchers.IO) {
        check(reading.compareAndSet(false, true)) { "A label photo is already being read." }
        try {
          recognizeOwnedLabelImage(
            requireNotNull(appContext.reactContext) { "Label capture is unavailable." }, uriValue,
          )
        } finally {
          reading.set(false)
        }
      }
    }
  }
}
