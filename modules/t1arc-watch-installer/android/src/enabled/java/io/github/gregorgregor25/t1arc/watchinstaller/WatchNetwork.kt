package io.github.gregorgregor25.t1arc.watchinstaller

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import java.io.Closeable
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

internal fun wifiNetwork(context: Context): Network {
    val manager = context.getSystemService(ConnectivityManager::class.java)
    return manager.allNetworks.firstOrNull { manager.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true }
        ?: throw IllegalStateException("Connect this phone and your watch to the same Wi-Fi, then try again.")
}

internal fun localAddress(host: String): InetAddress {
    require(host.matches(Regex("[0-9a-fA-F:.%a-zA-Z_-]{2,100}")) && (host.contains(':') || host.matches(Regex("[0-9.]+")))) {
        "Enter the watch's local IP address."
    }
    val address = InetAddress.getByName(host)
    val uniqueLocal = address.address.size == 16 && (address.address[0].toInt() and 0xfe) == 0xfc
    require(!address.isLoopbackAddress && !address.isMulticastAddress &&
        (address.isSiteLocalAddress || address.isLinkLocalAddress || uniqueLocal)) { "Use the watch's local Wi-Fi address." }
    return address
}

/** Bounds socket connection/handshake time and allows cancellation even inside libadb. */
internal class WatchTunnel(network: Network, host: String, remotePort: Int) : Closeable {
    private val closed = AtomicBoolean(false)
    private val remote = Socket()
    private val server = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
    @Volatile private var client: Socket? = null
    val port: Int get() = server.localPort

    init {
        try {
            require(remotePort in 1..65535) { "Enter the port shown on your watch." }
            network.bindSocket(remote)
            remote.connect(InetSocketAddress(localAddress(host), remotePort), 8_000)
            remote.soTimeout = 120_000
            remote.tcpNoDelay = true
            thread(name = "watch-adb-relay", isDaemon = true) {
                try {
                    val socket = server.accept()
                    client = socket
                    socket.soTimeout = 120_000
                    socket.tcpNoDelay = true
                    thread(name = "watch-adb-send", isDaemon = true) {
                        try { socket.getInputStream().copyTo(remote.getOutputStream()) } catch (_: Exception) { } finally { close() }
                    }
                    remote.getInputStream().copyTo(socket.getOutputStream())
                } catch (_: Exception) { } finally { close() }
            }
        } catch (error: Exception) { close(); throw error }
    }

    override fun close() {
        if (closed.compareAndSet(false, true)) {
            runCatching { server.close() }; runCatching { remote.close() }; runCatching { client?.close() }
        }
    }
}

internal fun discoverWatches(context: Context, cancelled: () -> Boolean): List<Map<String, Any>> {
    val network = wifiNetwork(context)
    val connectivity = context.getSystemService(ConnectivityManager::class.java)
    val ownAddresses = connectivity.getLinkProperties(network)?.linkAddresses?.map { it.address.hostAddress }?.toSet() ?: emptySet()
    val manager = context.getSystemService(NsdManager::class.java)
    val services = CopyOnWriteArrayList<NsdServiceInfo>()
    val lock = context.applicationContext.getSystemService(WifiManager::class.java).createMulticastLock("t1arc-watch-setup").apply {
        setReferenceCounted(false); acquire()
    }
    val listeners = mutableListOf<NsdManager.DiscoveryListener>()
    try {
        for (type in listOf("_adb-tls-pairing._tcp.", "_adb-tls-connect._tcp.", "_adb._tcp.")) {
            val listener = object : NsdManager.DiscoveryListener {
                override fun onDiscoveryStarted(type: String) {}
                override fun onDiscoveryStopped(type: String) {}
                override fun onStartDiscoveryFailed(type: String, error: Int) {}
                override fun onStopDiscoveryFailed(type: String, error: Int) {}
                override fun onServiceFound(info: NsdServiceInfo) { services.addIfAbsent(info) }
                override fun onServiceLost(info: NsdServiceInfo) { services.removeAll { it.serviceName == info.serviceName } }
            }
            listeners.add(listener)
            manager.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, listener)
        }
        repeat(30) { if (cancelled()) return emptyList(); Thread.sleep(200) }
        val results = linkedMapOf<String, MutableMap<String, Any>>()
        for (service in services.take(16)) {
            if (cancelled()) break
            val latch = CountDownLatch(1)
            @Suppress("DEPRECATION")
            manager.resolveService(service, object : NsdManager.ResolveListener {
                override fun onResolveFailed(info: NsdServiceInfo, error: Int) { latch.countDown() }
                override fun onServiceResolved(info: NsdServiceInfo) {
                    val host = info.host?.hostAddress
                    if (host != null && host !in ownAddresses && runCatching { localAddress(host) }.isSuccess) synchronized(results) {
                        val result = results.getOrPut(host) { mutableMapOf("id" to host, "host" to host, "name" to info.serviceName, "legacy" to false) }
                        if (info.serviceType.contains("pairing")) result["pairingPort"] = info.port
                        else { result["connectionPort"] = info.port; result["legacy"] = !info.serviceType.contains("tls") }
                    }
                    latch.countDown()
                }
            })
            // Stop resolving after a timeout: older Android permits only one outstanding resolve.
            if (!latch.await(2, TimeUnit.SECONDS)) break
        }
        return synchronized(results) { results.values.map { it.toMap() } }
    } finally {
        listeners.forEach { runCatching { manager.stopServiceDiscovery(it) } }
        lock.release()
    }
}
