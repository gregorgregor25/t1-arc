package app.daymark.wear

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import app.daymark.wear.data.DaymarkDataLayerSync
import app.daymark.wear.data.DaymarkWearRepository

class MainActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var watchView: DaymarkWatchView
    private val snapshotListener: (app.daymark.wear.data.GlucoseSnapshot?) -> Unit =
        { snapshot ->
            runOnUiThread {
                watchView.snapshot = snapshot
            }
        }
    private val refresh =
        object : Runnable {
            override fun run() {
                watchView.snapshot = DaymarkWearRepository.get(this@MainActivity).snapshot()
                handler.postDelayed(this, 30_000L)
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        watchView =
            DaymarkWatchView(this).apply {
                snapshot = DaymarkWearRepository.get(this@MainActivity).snapshot()
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
        DaymarkWearRepository.get(this).addListener(snapshotListener)
        // A freshly sideloaded companion can miss the original listener event.
        // Recover the retained Data Layer item whenever the user opens T1 Arc.
        DaymarkDataLayerSync.recover(this) {
            runOnUiThread {
                watchView.snapshot = DaymarkWearRepository.get(this).snapshot()
            }
        }
    }

    override fun onPause() {
        handler.removeCallbacks(refresh)
        DaymarkWearRepository.get(this).removeListener(snapshotListener)
        super.onPause()
    }
}
