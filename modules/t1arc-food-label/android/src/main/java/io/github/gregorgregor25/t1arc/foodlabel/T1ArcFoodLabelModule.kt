package io.github.gregorgregor25.t1arc.foodlabel

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class T1ArcFoodLabelModule : Module() {
  private val reading = AtomicBoolean(false)

  override fun definition() = ModuleDefinition {
    Name("T1ArcFoodLabel")

    OnCreate {
      appContext.reactContext?.let { clearAbandonedLabelImages(it.cacheDir) }
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
