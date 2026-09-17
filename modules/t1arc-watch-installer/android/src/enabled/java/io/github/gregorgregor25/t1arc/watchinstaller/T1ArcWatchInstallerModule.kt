package io.github.gregorgregor25.t1arc.watchinstaller

import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.PackageInfo
import android.os.Build
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import io.github.muntashirakon.adb.AdbConnection
import io.github.muntashirakon.adb.AdbStream
import io.github.muntashirakon.adb.PairingConnectionCtx
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class T1ArcWatchInstallerModule : Module() {
    private val busy = AtomicBoolean(false)
    private val generation = AtomicInteger(0)
    private val timer = Executors.newSingleThreadScheduledExecutor()
    @Volatile private var tunnel: WatchTunnel? = null
    @Volatile private var connection: AdbConnection? = null
    @Volatile private var worker: Thread? = null
    private var identity: InstallerIdentity? = null
    private var model = "Watch"
    private val context: Context get() = requireNotNull(appContext.reactContext)

    override fun definition() = ModuleDefinition {
        Name("T1ArcWatchInstaller")
        Constants("available" to true)
        Events("progress")
        AsyncFunction("discoverAsync") Coroutine { ->
            operation(45) { token -> discoverWatches(context) { generation.get() != token } }
        }
        AsyncFunction("pairAsync") Coroutine { host: String, port: Int, code: String ->
            operation(40) { token ->
                require(code.matches(Regex("[0-9]{6}"))) { "Enter the six-digit code from Pair new device on your watch." }
                closeTransport()
                val keys = keys()
                val relay = WatchTunnel(wifiNetwork(context), host, port)
                tunnel = relay
                try {
                    checkCurrent(token)
                    PairingConnectionCtx("127.0.0.1", relay.port, code.toByteArray(Charsets.UTF_8), keys.key, keys.certificate, "T1 Arc").use { it.start() }
                } finally { relay.close(); tunnel = null }
            }
        }
        AsyncFunction("connectAsync") Coroutine { host: String, port: Int ->
            operation(40) { token ->
                closeTransport()
                val relay = WatchTunnel(wifiNetwork(context), host, port)
                tunnel = relay
                checkCurrent(token)
                val keys = keys()
                val client = AdbConnection.Builder("127.0.0.1", relay.port).setApi(30)
                    .setPrivateKey(keys.key).setCertificate(keys.certificate).setDeviceName("T1 Arc").build()
                connection = client
                check(client.connect(25, TimeUnit.SECONDS, false)) { "Check the watch for an Allow debugging prompt, or pair it again." }
                check(shell("pm list features").contains("feature:android.hardware.type.watch")) { "This is not a Wear OS watch. Choose your watch and try again." }
                check((shell("getprop ro.build.version.sdk").trim().toIntOrNull() ?: 0) >= 30) { "This companion needs Wear OS 3 or newer." }
                model = shell("getprop ro.product.model").trim().take(80)
                mapOf("model" to model)
            }
        }
        AsyncFunction("installAsync") Coroutine { ->
            operation(240) { token -> install(token) }
        }
        AsyncFunction("cancelAsync") Coroutine { -> withContext(Dispatchers.IO) { stopOperation() } }
        AsyncFunction("disconnectAsync") Coroutine { -> withContext(Dispatchers.IO) { stopOperation() } }
        OnDestroy { stopOperation(); timer.shutdownNow() }
    }

    private fun keys(): InstallerIdentity = identity ?: InstallerIdentity(context).also { identity = it }

    private suspend fun <T> operation(seconds: Long, body: (Int) -> T): T = withContext(Dispatchers.IO) {
        if (!busy.compareAndSet(false, true)) throw CodedException("BUSY", "Another watch setup step is finishing. Try again in a moment.", null)
        val token = generation.get()
        worker = Thread.currentThread()
        val timeout = timer.schedule({ stopOperation() }, seconds, TimeUnit.SECONDS)
        try {
            val result = body(token)
            checkCurrent(token)
            result
        } catch (error: Exception) {
            closeTransport()
            if (generation.get() != token) throw CodedException("INTERRUPTED", "Setup stopped or timed out. Keep your watch awake, then reconnect and retry. Installation will be checked before trying again.", null)
            if (error is CodedException) throw error
            // Never forward library diagnostics, pairing codes or credential details to JS/logs.
            val detail = if (error is IllegalArgumentException || error is IllegalStateException) error.message else null
            throw CodedException("WATCH_SETUP_FAILED", detail ?: "Could not reach or authorise the watch. Keep its debugging screen open, check the code and Wi-Fi, then retry.", null)
        } finally { timeout.cancel(false); worker = null; Thread.interrupted(); busy.set(false) }
    }

    private fun stopOperation() {
        generation.incrementAndGet()
        worker?.interrupt()
        closeTransport()
    }

    private fun checkCurrent(token: Int) { check(generation.get() == token) { "Setup was cancelled." } }
    private fun closeTransport() {
        tunnel?.close(); tunnel = null
        val client = connection; connection = null
        runCatching { client?.close() }
    }

    private fun shell(command: String): String {
        val client = requireNotNull(connection) { "Reconnect your watch before installing." }
        val marker = "__T1ARC_${java.util.UUID.randomUUID().toString().replace("-", "")}__"
        return client.open("shell:$command; printf '\\n$marker\\n'").use { stream ->
            stream.readUntilMarker(marker, 512 * 1024)
        }
    }

    private fun progress(phase: String, percent: Int) { sendEvent("progress", mapOf("phase" to phase, "percent" to percent)) }

    @Suppress("DEPRECATION")
    private fun install(token: Int): Map<String, Any> {
        progress("checking", 0)
        val metadata = context.assets.open("watch-installer/manifest.json").bufferedReader().use { JSONObject(it.readText()) }
        val packageName = metadata.getString("packageName")
        check(packageName == context.packageName && packageName.matches(Regex("[a-zA-Z0-9_.]+"))) { "The bundled companion belongs to a different phone installation." }
        val file = File(context.cacheDir, "verified-watch-companion.apk")
        try {
            context.assets.open("watch-installer/companion.apk").use { input -> file.outputStream().use { input.copyTo(it) } }
            val hash = file.inputStream().use { input ->
                val digest = MessageDigest.getInstance("SHA-256")
                val buffer = ByteArray(65536)
                while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
                digest.digest().hex()
            }
            check(hash == metadata.getString("sha256")) { "The bundled companion could not be verified. Reinstall this phone update." }
            val pm = context.packageManager
            val signingFlags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
            val apk = requireNotNull(pm.getPackageArchiveInfo(file.path, signingFlags))
            val phone = pm.getPackageInfo(context.packageName, signingFlags)
            val phoneCerts = phone.signerDigests()
            val apkCerts = apk.signerDigests()
            val versionCode = if (Build.VERSION.SDK_INT >= 28) apk.longVersionCode else apk.versionCode.toLong()
            check(apk.packageName == packageName && versionCode == metadata.getLong("versionCode") &&
                apkCerts == phoneCerts && apkCerts == setOf(metadata.getString("certificateSha256"))) { "The phone and bundled companion signatures or versions do not match." }
            val installed = shell("dumpsys package $packageName")
            val version = Regex("\\bversionCode=(\\d+)").find(installed)?.groupValues?.get(1)?.toLongOrNull()
            val decision = installDecision(version, versionCode, version == versionCode && installedHash(packageName) == hash)
            check(decision != InstallDecision.NEWER_INSTALLED) { "Your watch has a newer companion. Update the phone app first." }
            if (decision == InstallDecision.ALREADY_INSTALLED) {
                return mapOf("version" to metadata.getString("versionName"), "alreadyInstalled" to true, "model" to model)
            }
            checkCurrent(token)
            val client = requireNotNull(connection)
            val marker = "__T1ARC_${java.util.UUID.randomUUID().toString().replace("-", "")}__"
            client.open("exec:cmd package install -r -S ${file.length()}; printf '\\n$marker\\n'").use { stream ->
                file.inputStream().use { input ->
                    val buffer = ByteArray(32 * 1024)
                    var sent = 0L
                    var lastPercent = -1
                    while (true) {
                        checkCurrent(token)
                        val count = input.read(buffer)
                        if (count < 0) break
                        stream.write(buffer, 0, count)
                        sent += count
                        val percent = (sent * 100 / file.length()).toInt()
                        if (percent != lastPercent) { progress("transferring", percent); lastPercent = percent }
                    }
                }
                stream.flush()
                progress("installing", 100)
                val result = stream.readUntilMarker(marker, 32768)
                if (installResponse(result) == InstallResponse.SIGNATURE_CONFLICT) {
                    throw CodedException("SIGNATURE_CONFLICT", "This watch companion was signed differently. Keep it installed; use the matching phone and watch release.", null)
                }
                if (installResponse(result) == InstallResponse.DOWNGRADE) throw CodedException("NEWER_INSTALLED", "Your watch has a newer companion. Update the phone app first.", null)
                if (installResponse(result) != InstallResponse.SUCCESS) throw CodedException("INSTALL_UNCONFIRMED", "Installation was not confirmed. Check free space on the watch, then reconnect and retry. Your existing app will be checked first.", null)
            }
            progress("verifying", 100)
            checkCurrent(token)
            check(installedHash(packageName) == hash) { "Installation could not be verified. Reconnect and check again." }
            shell("monkey -p $packageName -c android.intent.category.LAUNCHER 1")
            return mapOf("version" to metadata.getString("versionName"), "alreadyInstalled" to false, "model" to model)
        } finally { file.delete(); closeTransport() }
    }

    private fun installedHash(packageName: String): String? {
        val paths = shell("pm path $packageName").lineSequence().map { it.trim() }.filter { it.startsWith("package:") }.toList()
        if (paths.size != 1) return null
        val path = paths.single().removePrefix("package:")
        if (!path.matches(Regex("/data/app/[a-zA-Z0-9_./=+~-]+\\.apk"))) return null
        return Regex("^[a-fA-F0-9]{64}").find(shell("sha256sum $path").trim())?.value?.lowercase()
    }
}

private fun ByteArray.hex() = joinToString("") { "%02x".format(it) }

@Suppress("DEPRECATION")
private fun PackageInfo.signerDigests(): Set<String> {
    val signers = if (Build.VERSION.SDK_INT >= 28) signingInfo?.apkContentsSigners else signatures
    return requireNotNull(signers).map { MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).hex() }.toSet()
}
// libadb 3.1.1 can wait forever after a peer closes with queued data. A command
// completion marker avoids relying on EOF, and direct reads drain buffered bytes.
private fun AdbStream.readUntilMarker(marker: String, limit: Int): String {
    val output = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (true) {
        val count = read(buffer, 0, buffer.size)
        check(count > 0) { "The watch closed the connection before confirming the operation. Reconnect and retry." }
        check(output.size() + count <= limit) { "Unexpected response from watch." }
        output.write(buffer, 0, count)
        val result = output.toString(Charsets.UTF_8.name())
        val end = result.indexOf(marker)
        if (end >= 0) return result.substring(0, end).trim()
    }
}
