package io.github.gregorgregor25.t1arc.watchfaces

/** Separate from glucose transport. Commands never carry APK paths or health records. */
object WatchFaceProtocol {
    const val VERSION = 1
    const val CAPABILITY = "t1arc_watch_faces_v1"
    const val COMMAND_PATH = "/t1arc/v1/watchfaces/command"
    const val RESULT_PATH = "/t1arc/v1/watchfaces/result"
    const val MAX_MESSAGE_BYTES = 8192
    const val REVISION_PROPERTY = "t1arc.face.revision"
    // Version 1 already negotiates the available catalog. Older companions can
    // still install shared faces; new designs must be offered only if advertised.
    val faceIds = setOf("meridian", "chronograph", "atelier", "pace", "summit")

    fun isRetiredFace(companionPackage: String, packageName: String): Boolean =
        packageName == companionPackage + ".watchfacepush.orbit"

    fun validRequestId(value: String): Boolean =
        value.matches(Regex("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"))

    fun validCommand(version: Int, requestId: String, action: String, faceId: String?): Boolean =
        version == VERSION && validRequestId(requestId) &&
            ((action == "status" && faceId == null) || (action == "install" && faceId in faceIds))

    fun facePackage(companionPackage: String, faceId: String): String {
        require(faceId in faceIds) { "Unknown bundled face." }
        return companionPackage + ".watchfacepush." + faceId
    }

    fun faceId(companionPackage: String, packageName: String): String? =
        faceIds.firstOrNull { facePackage(companionPackage, it) == packageName }
}
