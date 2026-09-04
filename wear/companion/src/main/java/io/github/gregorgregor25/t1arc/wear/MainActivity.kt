package io.github.gregorgregor25.t1arc.wear

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import io.github.gregorgregor25.t1arc.wear.data.T1ArcDataLayerSync
import io.github.gregorgregor25.t1arc.wear.data.T1ArcWearRepository

class MainActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var watchView: T1ArcWatchView
    private val snapshotListener: (io.github.gregorgregor25.t1arc.wear.data.GlucoseSnapshot?) -> Unit =
        { snapshot ->
            runOnUiThread {
                watchView.snapshot = snapshot
            }
        }
    private val refresh =
        object : Runnable {
            override fun run() {
                watchView.snapshot = T1ArcWearRepository.get(this@MainActivity).snapshot()
                handler.postDelayed(this, 30_000L)
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        watchView =
            T1ArcWatchView(this).apply {
                snapshot = T1ArcWearRepository.get(this@MainActivity).snapshot()
                setOnClickListener {
                    startActivity(Intent(this@MainActivity, GraphActivity::class.java))
                }
            }
        setContentView(watchView)
    }

    override fun onResume() {
        super.onResume()
        handler.removeCallbacks(refresh)
        refresh.run()
        T1ArcWearRepository.get(this).addListener(snapshotListener)
        // A freshly sideloaded companion can miss the original listener event.
        // Recover the retained Data Layer item whenever the user opens T1 Arc.
        T1ArcDataLayerSync.recover(this) {
            runOnUiThread {
                watchView.snapshot = T1ArcWearRepository.get(this).snapshot()
            }
        }
    }

    override fun onPause() {
        handler.removeCallbacks(refresh)
        T1ArcWearRepository.get(this).removeListener(snapshotListener)
        super.onPause()
    }
}
