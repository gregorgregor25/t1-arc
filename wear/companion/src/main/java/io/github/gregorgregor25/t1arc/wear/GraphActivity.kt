package io.github.gregorgregor25.t1arc.wear

import android.app.Activity
import android.os.Bundle
import io.github.gregorgregor25.t1arc.wear.data.T1ArcDataLayerSync
import io.github.gregorgregor25.t1arc.wear.data.T1ArcWearRepository
import io.github.gregorgregor25.t1arc.wear.data.GlucoseHistoryPoint
import io.github.gregorgregor25.t1arc.wear.data.GlucoseSnapshot

class GraphActivity : Activity() {
    private lateinit var graphView: T1ArcGraphView
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
        repository.removeListener(snapshotListener)
        repository.removeHistoryListener(historyListener)
        super.onPause()
    }
}
