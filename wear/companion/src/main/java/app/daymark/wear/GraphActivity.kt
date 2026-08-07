package app.daymark.wear

import android.app.Activity
import android.os.Bundle
import app.daymark.wear.data.DaymarkDataLayerSync
import app.daymark.wear.data.DaymarkWearRepository
import app.daymark.wear.data.GlucoseHistoryPoint
import app.daymark.wear.data.GlucoseSnapshot

class GraphActivity : Activity() {
    private lateinit var graphView: DaymarkGraphView
    private val repository by lazy { DaymarkWearRepository.get(this) }
    private val snapshotListener: (GlucoseSnapshot?) -> Unit =
        { snapshot -> runOnUiThread { graphView.snapshot = snapshot } }
    private val historyListener: (List<GlucoseHistoryPoint>) -> Unit =
        { history -> runOnUiThread { graphView.history = history } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        graphView =
            DaymarkGraphView(this).apply {
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
        DaymarkDataLayerSync.recover(this) {
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
