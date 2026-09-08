package io.github.gregorgregor25.t1arc.wear.watchfaces

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.annotation.DoNotInline
import androidx.annotation.RequiresApi
import io.github.gregorgregor25.t1arc.watchfaces.WatchFaceProtocol
import org.json.JSONObject
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors

internal class WatchFaceRuntime private constructor(context: Context) {
    private val context = context.applicationContext
    val executor = Executors.newSingleThreadExecutor { task -> Thread(task, "T1ArcWatchFaces") }
    val preferences = context.getSharedPreferences("t1arc_watch_faces", Context.MODE_PRIVATE)
    private val requests = InstallRequestLedger(
        read = {
            val saved = org.json.JSONArray(preferences.getString("install_requests", "[]"))
            (0 until saved.length()).map { saved.getString(it) }
        },
        write = { recent ->
            check(preferences.edit().putString("install_requests", org.json.JSONArray(recent).toString()).commit()) {
                "Could not record watch face request."
            }
        },
    )
    val backend: FaceBackend? = if (Build.VERSION.SDK_INT >= 36 &&
        context.packageManager.systemSharedLibraryNames.orEmpty().contains("wear-sdk")
    ) {
        try { Api36.create(this.context, executor) }
        catch (_: LinkageError) { null }
        catch (_: Exception) { null }
    } else null
    val installer = backend?.let(::WatchFaceInstaller)

    val catalog: List<BundledFace> by lazy {
        val json = context.assets.open("watchfaces/catalog.json").bufferedReader().use { JSONObject(it.readText()) }
        require(json.getInt("version") == 1 && json.getString("companionPackage") == context.packageName)
        val faces = json.getJSONArray("faces")
        require(faces.length() == WatchFaceProtocol.faceIds.size)
        (0 until faces.length()).map { index ->
            val item = faces.getJSONObject(index)
            val id = item.getString("id")
            require(id in WatchFaceProtocol.faceIds)
            require(item.getString("packageName") == WatchFaceProtocol.facePackage(context.packageName, id))
            require(item.getString("apkAsset") == "watchfaces/" + id + ".apk")
            require(item.getString("sha256").matches(Regex("[0-9a-f]{64}")))
            require(item.getString("revision").matches(Regex("[0-9a-f]{16}")))
            require(item.getLong("versionCode") > 0)
            require(item.getString("validationToken").isNotBlank())
            BundledFace(id, item.getString("packageName"), item.getLong("versionCode"),
                item.getString("revision"), item.getString("apkAsset"), item.getString("sha256"),
                item.getString("validationToken"))
        }.also { require(it.map { face -> face.id }.toSet() == WatchFaceProtocol.faceIds) }
    }

    fun status(): CompletableFuture<JSONObject> {
        val availableBackend = backend ?: return CompletableFuture.completedFuture(base("unsupported"))
        if (installer?.isBusy() == true) return CompletableFuture.completedFuture(base("busy"))
        return try {
            val known = catalog
            availableBackend.list().thenCompose { slots ->
                val slot = slots.installed.firstOrNull()
                val active = slot?.let { availableBackend.isActive(it.packageName) }
                    ?: CompletableFuture.completedFuture(false)
                active.thenApply { isActive ->
                    base("ready").apply {
                        put("catalog", org.json.JSONArray(known.map { it.id }))
                        put("active", isActive)
                        slot?.let {
                            put("installedFaceId", WatchFaceProtocol.faceId(context.packageName, it.packageName))
                            if (WatchFaceProtocol.isRetiredFace(context.packageName, it.packageName)) {
                                put("retiredFaceId", "orbit")
                            }
                            put("installedVersion", it.versionCode)
                        }
                    }
                }
            }
        } catch (error: Exception) { failedFaceOperation(error) }
    }

    fun select(faceId: String, requestKey: String): CompletableFuture<JSONObject> {
        val availableInstaller = installer ?: return CompletableFuture.completedFuture(base("unsupported"))
        if (availableInstaller.isBusy()) return CompletableFuture.completedFuture(base("busy"))
        return try {
            val face = catalog.single { it.id == faceId }
            if (!requests.claim(requestKey)) return status()
            availableInstaller.install(face).thenApply { selected ->
                base(if (selected.active) "active" else "activation_required").apply {
                    put("catalog", org.json.JSONArray(catalog.map { it.id }))
                    put("installedFaceId", face.id)
                    put("installedVersion", selected.face.versionCode)
                    put("active", selected.active)
                }
            }
        } catch (error: Exception) { failedFaceOperation(error) }
    }

    fun base(code: String) = JSONObject()
        .put("version", WatchFaceProtocol.VERSION)
        .put("code", code)
        .put("supported", backend != null)
        .put("active", false)
        .put("activationUsed", preferences.getBoolean("activation_attempted", false))
        .put("activationDenied", preferences.getBoolean("permission_requested", false) &&
            context.checkSelfPermission(ACTIVATE_PERMISSION) != android.content.pm.PackageManager.PERMISSION_GRANTED)

    companion object {
        const val ACTIVATE_PERMISSION = "com.google.wear.permission.SET_PUSHED_WATCH_FACE_AS_ACTIVE"
        @Volatile private var instance: WatchFaceRuntime? = null
        fun get(context: Context): WatchFaceRuntime =
            instance ?: synchronized(this) {
                instance ?: WatchFaceRuntime(context).also { instance = it }
            }
    }

    @RequiresApi(36)
    private object Api36 {
        @DoNotInline
        fun create(context: Context, executor: java.util.concurrent.Executor): FaceBackend? {
            // API level alone does not guarantee that the device has an enabled installer.
            val service = context.packageManager.resolveService(
                Intent("com.google.wear.ACTION_PUSH_WATCH_FACES"), PackageManager.MATCH_SYSTEM_ONLY,
            )
            if (service?.serviceInfo == null) return null
            return PlatformFaceBackend(context, executor)
        }
    }
}
