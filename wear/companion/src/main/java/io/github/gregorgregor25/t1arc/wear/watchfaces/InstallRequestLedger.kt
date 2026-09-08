package io.github.gregorgregor25.t1arc.wear.watchfaces

/** A delayed duplicate command must not undo a later face choice, even after restart. */
internal class InstallRequestLedger(
    private val read: () -> List<String>,
    private val write: (List<String>) -> Unit,
) {
    @Synchronized fun claim(request: String): Boolean {
        val recent = read()
        if (request in recent) return false
        write((recent + request).takeLast(64))
        return true
    }
}
