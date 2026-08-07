package app.daymark.glooko

import android.app.Presentation
import android.content.Context
import android.graphics.SurfaceTexture
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.view.Surface
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout

/**
 * Gives scheduled Glooko WebViews a real, private Android window without
 * drawing anything on the user's physical display.
 *
 * Chromium deliberately limits parts of the browser lifecycle for a WebView
 * that has never been attached to a window. Glooko's generated export download
 * is one of those paths. A private virtual display keeps the whole operation
 * on-device and off-screen while allowing the page to finish normally.
 */
internal class GlookoOffscreenWebViewHost(
  context: Context,
  width: Int,
  height: Int,
) {
  private val surfaceTexture = SurfaceTexture(false)
  private val surface: Surface
  private val virtualDisplay: VirtualDisplay
  private val presentation: Presentation
  private val container: FrameLayout

  val webViewContext: Context
    get() = presentation.context

  init {
    surfaceTexture.setDefaultBufferSize(width, height)
    surface = Surface(surfaceTexture)
    val displayManager =
      context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
    virtualDisplay =
      requireNotNull(
        displayManager.createVirtualDisplay(
          "T1 Arc private Glooko",
          width,
          height,
          context.resources.displayMetrics.densityDpi,
          surface,
          DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY or
            DisplayManager.VIRTUAL_DISPLAY_FLAG_PRESENTATION,
        ),
      ) {
        "Android could not create a private Glooko display."
      }
    presentation = Presentation(context, virtualDisplay.display)
    container =
      FrameLayout(presentation.context).apply {
        visibility = View.VISIBLE
      }
    presentation.setContentView(container)
    presentation.show()
  }

  fun attach(webView: WebView) {
    (webView.parent as? ViewGroup)?.removeView(webView)
    webView.visibility = View.VISIBLE
    container.addView(
      webView,
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      ),
    )
  }

  fun detach(webView: WebView) {
    if (webView.parent === container) container.removeView(webView)
  }

  fun close() {
    container.removeAllViews()
    presentation.dismiss()
    virtualDisplay.release()
    surface.release()
    surfaceTexture.release()
  }
}
