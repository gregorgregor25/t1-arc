package io.github.gregorgregor25.t1arc.wear

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import io.github.gregorgregor25.t1arc.wear.data.T1ArcDataLayerSync
import io.github.gregorgregor25.t1arc.wear.data.T1ArcWearRepository
import io.github.gregorgregor25.t1arc.wear.data.GlucoseHistoryPoint
import io.github.gregorgregor25.t1arc.wear.data.GlucoseSnapshot

class GraphActivity : Activity() {
    private lateinit var graphView: T1ArcGraphView
    private val clockHandler = Handler(Looper.getMainLooper())
    private val clockRefresh = object : Runnable {
        override fun run() {
            // The NOW axis and freshness must advance even if no reading arrives.
            graphView.snapshot = repository.snapshot()
            clockHandler.postDelayed(this, 30_000L)
        }
    }
    private val repository by lazy { T1ArcWearRepository.get(this) }
    private val snapshotListener: (GlucoseSnapshot?) -> Unit =
        { snapshot -> runOnUiThread { graphView.snapshot = snapshot } }
    private val historyListener: (List<GlucoseHistoryPoint>) -> Unit =
        { history -> runOnUiThread { graphView.history = history } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        graphView =
            T1ArcGraphView(this).apply {
                snapshot = repository.snapshot()
                history = repository.history()
            }
        setContentView(graphView)
    }

    override fun onResume() {
        super.onResume()
        clockHandler.removeCallbacks(clockRefresh)
        clockHandler.postDelayed(clockRefresh, 30_000L)
        repository.addListener(snapshotListener)
        repository.addHistoryListener(historyListener)
        graphView.snapshot = repository.snapshot()
        graphView.history = repository.history()
        T1ArcDataLayerSync.recover(this) {
            runOnUiThread {
                graphView.snapshot = repository.snapshot()
                graphView.history = repository.history()
            }
        }
    }

    override fun onPause() {
        clockHandler.removeCallbacks(clockRefresh)
        repository.removeListener(snapshotListener)
        repository.removeHistoryListener(historyListener)
        super.onPause()
    }
}
