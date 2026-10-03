package io.github.gregorgregor25.t1arc.chatgpt

import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatGptCallbackHttpTest {
  @Test fun returnButtonPinsTheRunningPackageAndCarriesNoOAuthValues() {
    val release = ChatGptCallbackHttp.successPage("io.github.gregorgregor25.t1arc")
    val development = ChatGptCallbackHttp.successPage("io.github.gregorgregor25.t1arc.dev")
    assertTrue(release.contains("href=\"intent://insights#Intent;scheme=t1arc;package=io.github.gregorgregor25.t1arc;end\""))
    assertTrue(development.contains("package=io.github.gregorgregor25.t1arc.dev;end"))
    assertFalse(release.contains("t1arc://insights"))
    assertFalse(release.contains("client_id="))
    assertFalse(release.contains("access_token"))
    assertFalse(release.contains("state="))
    assertTrue(release.contains("recent apps"))
    try { ChatGptCallbackHttp.successPage("io.example.app\" onclick=\"bad") ; throw AssertionError("Expected invalid package") }
    catch (_: IllegalArgumentException) {}
  }

  @Test fun loopbackSocketAcceptsBrowserRequestAndReturnsPrivatePage() {
    val loopback = InetAddress.getByName("127.0.0.1")
    ServerSocket(0, 1, loopback).use { listener ->
      listener.soTimeout = 3000
      val workers = Executors.newSingleThreadExecutor()
      try {
        val server = workers.submit<String> {
          listener.accept().use { peer ->
            peer.soTimeout = 3000
            val target = ChatGptCallbackHttp.readTarget(peer, listener.localPort)
            val callback = ChatGptProtocol.callback(target, "private-state", "dynamic_agent_client")
            assertEquals("secret-auth-code", callback.code)
            ChatGptCallbackHttp.sendPage(peer, 200, ChatGptCallbackHttp.successPage("io.example.app.dev"))
            target
          }
        }
        val response = Socket(loopback, listener.localPort).use { browser ->
          browser.soTimeout = 3000
          browser.getOutputStream().write((
            "GET /auth/callback?code=secret-auth-code&state=private-state&client_id=oaiapp_123 HTTP/1.1\r\n" +
              "Host: 127.0.0.1:${listener.localPort}\r\nConnection: close\r\n\r\n"
            ).toByteArray(StandardCharsets.US_ASCII))
          browser.getInputStream().readBytes().toString(StandardCharsets.UTF_8)
        }
        assertTrue(server.get(3, TimeUnit.SECONDS).startsWith("/auth/callback?"))
        assertTrue(response.startsWith("HTTP/1.1 200 OK\r\n"))
        assertTrue(response.contains("Return to T1 Arc"))
        assertTrue(response.contains("package=io.example.app.dev;end"))
        assertFalse(response.contains("secret-auth-code"))
        assertFalse(response.contains("private-state"))
        assertTrue(response.contains("Cache-Control: no-store"))
      } finally {
        workers.shutdownNow()
      }
    }
  }

  @Test fun loopbackSocketRejectsWrongHostBeforeParsingCode() {
    val loopback = InetAddress.getByName("127.0.0.1")
    ServerSocket(0, 1, loopback).use { listener ->
      listener.soTimeout = 3000
      val workers = Executors.newSingleThreadExecutor()
      try {
        val server = workers.submit<Boolean> {
          listener.accept().use { peer ->
            peer.soTimeout = 3000
            try { ChatGptCallbackHttp.readTarget(peer, listener.localPort); false }
            catch (_: IllegalArgumentException) { true }
          }
        }
        Socket(loopback, listener.localPort).use { browser ->
          browser.getOutputStream().write((
            "GET /auth/callback?code=secret HTTP/1.1\r\nHost: attacker.example\r\n\r\n"
            ).toByteArray(StandardCharsets.US_ASCII))
        }
        assertTrue(server.get(3, TimeUnit.SECONDS))
      } finally {
        workers.shutdownNow()
      }
    }
  }
}
