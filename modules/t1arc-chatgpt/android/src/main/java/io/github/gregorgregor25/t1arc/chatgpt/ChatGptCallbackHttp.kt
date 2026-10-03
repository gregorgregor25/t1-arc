package io.github.gregorgregor25.t1arc.chatgpt

import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.net.Socket
import java.nio.charset.StandardCharsets

/** The callback response contains no authorization code, state, token, or account data. */
internal object ChatGptCallbackHttp {
  private val packageNamePattern = Regex("[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)+")

  fun successPage(packageName: String): String {
    require(packageNamePattern.matches(packageName)) { "Invalid application package." }
    // Android's intent URI pins the launch to this installed package. A generic
    // t1arc:// link could choose another installed build with the same scheme.
    val returnLink = "intent://insights#Intent;scheme=t1arc;package=$packageName;end"
    return page(
      "Authorization received",
      "Return to T1 Arc to finish connecting your ChatGPT account.",
      "<a class=button href=\"$returnLink\">Return to T1 Arc</a>" +
        "<p class=hint>If the button does not open the app, switch to T1 Arc from your recent apps.</p>",
    )
  }

  fun cancelledPage(): String = page(
    "Authorization cancelled",
    "No ChatGPT connection was changed. Return to T1 Arc when you are ready.",
    "<p class=hint>Switch to T1 Arc from your recent apps.</p>",
  )

  fun invalidPage(): String = page(
    "Invalid callback",
    "This sign-in page could not be verified. Return to T1 Arc and try again.",
    "<p class=hint>Switch to T1 Arc from your recent apps.</p>",
  )

  private fun page(title: String, message: String, action: String): String =
    """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>T1 Arc · $title</title><style>
      *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d16;color:#f4f5f8;font:16px/1.5 system-ui,sans-serif;padding:24px}
      main{width:min(100%,420px);padding:28px;border:1px solid #303847;border-radius:20px;background:#171b26}
      h1{font-size:23px;line-height:1.2;margin:0 0 12px}p{margin:0 0 20px;color:#cbd1dc}.button{display:block;text-align:center;padding:14px 18px;border-radius:12px;background:#72dbcf;color:#10202a;font-weight:700;text-decoration:none}.hint{font-size:14px;margin:20px 0 0}
      </style></head><body><main><h1>$title</h1><p>$message</p>$action</main></body></html>"""

  fun readTarget(socket: Socket, port: Int): String {
    val input = BufferedInputStream(socket.getInputStream())
    val first = readLine(input, 8192)
    val parts = first.split(' ')
    require(parts.size == 3 && parts[0] == "GET" &&
      (parts[2] == "HTTP/1.1" || parts[2] == "HTTP/1.0")) { "Invalid callback." }
    var host: String? = null
    var headerBytes = 0
    while (true) {
      val line = readLine(input, 8192)
      headerBytes += line.length
      require(headerBytes <= 16_384) { "Invalid callback." }
      if (line.isEmpty()) break
      if (line.startsWith("Host:", ignoreCase = true)) {
        require(host == null) { "Invalid callback." }
        host = line.substringAfter(':').trim()
      }
    }
    require(host == "127.0.0.1:$port") { "Invalid callback." }
    return parts[1]
  }

  private fun readLine(input: BufferedInputStream, max: Int): String {
    val bytes = ByteArrayOutputStream()
    while (bytes.size() < max) {
      val next = input.read()
      require(next >= 0) { "Invalid callback." }
      if (next == 10) return String(bytes.toByteArray(), StandardCharsets.US_ASCII).trimEnd('\r')
      bytes.write(next)
    }
    throw IllegalArgumentException("Invalid callback.")
  }

  fun sendPage(socket: Socket, status: Int, body: String) {
    try {
      val bytes = body.toByteArray(StandardCharsets.UTF_8)
      val statusText = if (status == 200) "OK" else "Bad Request"
      val headers = "HTTP/1.1 $status $statusText\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\r\nConnection: close\r\n\r\n"
      socket.getOutputStream().write(headers.toByteArray(StandardCharsets.US_ASCII))
      socket.getOutputStream().write(bytes)
      socket.getOutputStream().flush()
    } catch (_: Exception) {
      // The validated callback still belongs to the native authorization attempt
      // even if the browser closes before rendering its confirmation page.
    }
  }
}
