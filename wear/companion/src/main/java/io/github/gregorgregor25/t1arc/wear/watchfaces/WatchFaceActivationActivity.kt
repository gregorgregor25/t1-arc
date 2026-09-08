package io.github.gregorgregor25.t1arc.wear.watchfaces

import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import io.github.gregorgregor25.t1arc.wear.R

/** Remote links only open this explanation. Permission/activation require a local tap. */
class WatchFaceActivationActivity : Activity() {
    private lateinit var runtime: WatchFaceRuntime
    private lateinit var detail: TextView
    private lateinit var activate: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        runtime = WatchFaceRuntime.get(this)
        val density = resources.displayMetrics.density
        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((32 * density).toInt(), (40 * density).toInt(), (32 * density).toInt(), (40 * density).toInt())
            gravity = android.view.Gravity.CENTER_HORIZONTAL
        }
        body.addView(TextView(this).apply {
            text = getString(R.string.watch_faces_title)
            textSize = 22f
            gravity = android.view.Gravity.CENTER
        })
        detail = TextView(this).apply {
            textSize = 16f
            gravity = android.view.Gravity.CENTER
            setPadding(0, (16 * density).toInt(), 0, (12 * density).toInt())
        }
        body.addView(detail)
        activate = Button(this).apply {
            text = getString(R.string.watch_faces_activate)
            minHeight = (48 * density).toInt()
            setOnClickListener { requestActivation() }
        }
        body.addView(activate)
        body.addView(Button(this).apply {
            text = getString(R.string.watch_faces_done)
            minHeight = (48 * density).toInt()
            setOnClickListener { finish() }
        })
        setContentView(ScrollView(this).apply { addView(body) })
        render()
    }

    private fun render() {
        val permissionGranted = checkSelfPermission(WatchFaceRuntime.ACTIVATE_PERMISSION) == PackageManager.PERMISSION_GRANTED
        val used = runtime.preferences.getBoolean("activation_attempted", false)
        val denied = runtime.preferences.getBoolean("permission_requested", false) && !permissionGranted
        val manual = used || denied
        detail.text = getString(when {
            runtime.backend == null -> R.string.watch_faces_unsupported
            manual -> R.string.watch_faces_manual
            else -> R.string.watch_faces_activation_explanation
        })
        activate.visibility = if (runtime.backend != null && !manual) android.view.View.VISIBLE else android.view.View.GONE
    }

    private fun requestActivation() {
        if (runtime.installer == null || runtime.installer?.isBusy() == true) {
            detail.setText(R.string.watch_faces_busy)
            return
        }
        if (checkSelfPermission(WatchFaceRuntime.ACTIVATE_PERMISSION) == PackageManager.PERMISSION_GRANTED) {
            activateInstalled()
        } else if (!runtime.preferences.getBoolean("permission_requested", false)) {
            // Commit before opening Android's dialog so recreation cannot prompt twice.
            if (!runtime.preferences.edit().putBoolean("permission_requested", true).commit()) {
                detail.setText(R.string.watch_faces_failed)
                return
            }
            requestPermissions(arrayOf(WatchFaceRuntime.ACTIVATE_PERMISSION), 71)
        } else render()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != 71) return
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) activateInstalled() else render()
    }

    private fun activateInstalled() {
        activate.isEnabled = false
        runtime.executor.execute {
            runtime.installer?.activate {
                check(!runtime.preferences.getBoolean("activation_attempted", false))
                check(runtime.preferences.edit().putBoolean("activation_attempted", true).commit())
            }?.whenComplete { _, error ->
                runOnUiThread {
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    activate.isEnabled = true
                    render()
                    detail.setText(if (error == null) R.string.watch_faces_active else R.string.watch_faces_manual)
                }
            }
        }
    }
}
