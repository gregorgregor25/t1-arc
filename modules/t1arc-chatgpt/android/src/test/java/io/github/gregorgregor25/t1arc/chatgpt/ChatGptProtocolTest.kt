package io.github.gregorgregor25.t1arc.chatgpt

import java.math.BigInteger
import java.nio.charset.StandardCharsets
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.interfaces.RSAPublicKey
import java.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatGptProtocolTest {
  @Test fun callbackRequiresMatchingStateAndIssuedClient() {
    val callback = ChatGptProtocol.callback(
      "/auth/callback?code=abc&state=random&client_id=oaiapp_123",
      "random", "dynamic_agent_client",
    )
    assertEquals("abc", callback.code)
    assertEquals("oaiapp_123", callback.clientId)
    assertFails { ChatGptProtocol.callback("/auth/callback?code=abc&state=wrong&client_id=oaiapp_123", "random", "dynamic_agent_client") }
    assertFails { ChatGptProtocol.callback("/auth/callback?code=abc&state=random", "random", "dynamic_agent_client") }
    assertFails { ChatGptProtocol.callback("/auth/callback?code=abc&state=random&client_id=other", "random", "oaiapp_123") }
    assertFails { ChatGptProtocol.callback("/auth/callback?code=abc&state=random&state=random&client_id=oaiapp_123", "random", "dynamic_agent_client") }
    assertFails { ChatGptProtocol.callback("/callback?code=abc&state=random&client_id=oaiapp_123", "random", "dynamic_agent_client") }
  }

  @Test fun cancellationNeedsStateButDoesNotNeedIssuedClient() {
    assertEquals("access_denied", ChatGptProtocol.callback(
      "/auth/callback?error=access_denied&state=random", "random", "dynamic_agent_client",
    ).error)
  }

  @Test fun endpointsRemainOnPinnedAuthority() {
    assertEquals("https://auth.openai.com/.well-known/jwks.json",
      ChatGptProtocol.pinnedOpenAiUri("https://auth.openai.com/.well-known/jwks.json"))
    assertFails { ChatGptProtocol.pinnedOpenAiUri("https://auth.openai.com.evil.test/keys") }
    assertFails { ChatGptProtocol.pinnedOpenAiUri("https://auth.openai.com@evil.test/keys") }
    assertFails { ChatGptProtocol.pinnedOpenAiUri("http://auth.openai.com/keys") }
  }

  @Test fun pkceMatchesRfc7636Example() {
    assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", ChatGptProtocol.pkceChallenge(
      "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    ))
  }

  @Test fun identitySignatureAudienceNonceAndSubjectMustMatch() {
    val pair = KeyPairGenerator.getInstance("RSA").also { it.initialize(2048) }.generateKeyPair()
    val public = pair.public as RSAPublicKey
    fun b64(number: BigInteger) = ChatGptProtocol.base64Url(number.toByteArray().let {
      if (it.first() == 0.toByte()) it.copyOfRange(1, it.size) else it
    })
    val jwks = JSONObject().put("keys", JSONArray().put(JSONObject()
      .put("kid", "key1").put("kty", "RSA").put("use", "sig")
      .put("n", b64(public.modulus)).put("e", b64(public.publicExponent))))
    val now = 1_800_000_000L
    fun signed(claims: JSONObject): String {
      val header = ChatGptProtocol.base64Url("{\"alg\":\"RS256\",\"kid\":\"key1\"}".toByteArray())
      val payload = ChatGptProtocol.base64Url(claims.toString().toByteArray(StandardCharsets.UTF_8))
      val text = "$header.$payload"
      val signature = Signature.getInstance("SHA256withRSA")
      signature.initSign(pair.private)
      signature.update(text.toByteArray(StandardCharsets.US_ASCII))
      return "$text.${ChatGptProtocol.base64Url(signature.sign())}"
    }
    val claims = JSONObject().put("iss", ISSUER).put("aud", "oaiapp_123")
      .put("exp", now + 3600).put("iat", now).put("nonce", "nonce")
      .put("sub", "user123").put("email", "user@example.com")
    val valid = signed(claims)
    assertEquals("user123", ChatGptProtocol.verifyIdToken(valid, jwks, "oaiapp_123", "nonce", "user123", now).subject)
    assertFails { ChatGptProtocol.verifyIdToken(valid, jwks, "other", "nonce", "user123", now) }
    assertFails { ChatGptProtocol.verifyIdToken(valid, jwks, "oaiapp_123", "other", "user123", now) }
    assertFails { ChatGptProtocol.verifyIdToken(valid, jwks, "oaiapp_123", "nonce", "other", now) }
    assertFails { ChatGptProtocol.verifyIdToken(signed(JSONObject(claims.toString()).put("exp", now - 100)), jwks, "oaiapp_123", "nonce", "user123", now) }
    val signaturePart = valid.substringAfterLast('.')
    val tampered = valid.substringBeforeLast('.') + "." +
      (if (signaturePart.first() == 'A') 'B' else 'A') + signaturePart.drop(1)
    assertFails { ChatGptProtocol.verifyIdToken(tampered, jwks, "oaiapp_123", "nonce", "user123", now) }
  }

  @Test fun streamRequiresTerminalCompletedEvent() {
    val parser = CompletedResponseParser()
    assertEquals(null, parser.line("event: response.output_text.delta"))
    assertEquals(null, parser.line("data: {\"type\":\"response.output_text.delta\",\"delta\":\"hi\"}"))
    assertEquals(null, parser.line(""))
    assertEquals(null, parser.line("event: response.completed"))
    assertEquals(null, parser.line("data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[]}}"))
    assertTrue(parser.line("")!!.contains("\"status\":\"completed\""))
  }

  @Test fun streamedQuotaFailureIsDistinct() {
    val parser = CompletedResponseParser()
    parser.line("event: response.failed")
    parser.line("data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"subscription_sharing_usage_limit_exceeded\"}}}")
    try { parser.line(""); throw AssertionError("Expected quota error") }
    catch (error: ChatGptFailure) { assertEquals("ERR_CHATGPT_QUOTA", error.code) }
  }

  @Test fun admissionFailureCodesDoNotLoopThroughSignIn() {
    assertEquals("ERR_CHATGPT_RESTRICTED", ChatGptProtocol.classifyHttpError(
      403, "subscription_sharing_user_not_eligible", "response"))
    assertEquals("ERR_CHATGPT_RETRY", ChatGptProtocol.classifyHttpError(
      503, "subscription_sharing_usage_unavailable", "response"))
    assertEquals("ERR_CHATGPT_INVALID_GRANT", ChatGptProtocol.classifyHttpError(
      400, "invalid_grant", "session"))
    assertEquals("ERR_CHATGPT_AUTH", ChatGptProtocol.classifyHttpError(401, null, "response"))
    assertEquals("ERR_CHATGPT_UNSUPPORTED", ChatGptProtocol.classifyHttpError(
      400, "subscription_sharing_unsupported_capability", "response"))
    assertEquals("ERR_CHATGPT_ROUTE", ChatGptProtocol.classifyHttpError(
      403, "subscription_sharing_route_not_supported", "response"))
  }

  @Test fun rejectedInferenceUsesOnlyFixedSafeDiagnosticCodes() {
    assertEquals("ERR_CHATGPT_REQUEST_FORMAT", ChatGptProtocol.classifyHttpError(
      400, "invalid_request_error", "response", "text.format.schema"))
    assertEquals("ERR_CHATGPT_REQUEST_FORMAT", ChatGptProtocol.classifyHttpError(
      400, "invalid_json_schema", "response", "some arbitrary provider string"))
    assertEquals("ERR_CHATGPT_REQUEST_MODEL", ChatGptProtocol.classifyHttpError(
      400, "invalid_request_error", "response", "model"))
    assertEquals("ERR_CHATGPT_REQUEST_INPUT", ChatGptProtocol.classifyHttpError(
      400, "invalid_request_error", "response", "input[0].content"))
    assertEquals("ERR_CHATGPT_REQUEST_REASONING", ChatGptProtocol.classifyHttpError(
      400, "invalid_request_error", "response", "reasoning.effort"))
    assertEquals("ERR_CHATGPT_REQUEST_OTHER", ChatGptProtocol.classifyHttpError(
      400, null, "response", "private health text"))
    assertEquals("ERR_CHATGPT_REQUEST_HTTP_OTHER", ChatGptProtocol.classifyHttpError(
      422, null, "response", "private health text"))
    assertEquals("ERR_CHATGPT_RETRY", ChatGptProtocol.classifyHttpError(502, null, "response"))
  }

  @Test fun malformedStreamCannotBeAcceptedAsCompleted() {
    val parser = CompletedResponseParser()
    parser.line("event: response.completed")
    parser.line("data: private health text")
    try { parser.line(""); throw AssertionError("Expected stream-format error") }
    catch (error: ChatGptFailure) { assertEquals("ERR_CHATGPT_STREAM_FORMAT", error.code) }
  }

  @Test fun unknownTerminalFailureIsDistinctFromIncompleteGeneration() {
    val failed = CompletedResponseParser()
    failed.line("event: response.failed")
    failed.line("data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"unknown_provider_code\"}}}")
    try { failed.line(""); throw AssertionError("Expected failed response") }
    catch (error: ChatGptFailure) { assertEquals("ERR_CHATGPT_STREAM_REJECTED", error.code) }

    val incomplete = CompletedResponseParser()
    incomplete.line("event: response.incomplete")
    incomplete.line("data: {\"type\":\"response.incomplete\",\"response\":{\"status\":\"incomplete\"}}")
    try { incomplete.line(""); throw AssertionError("Expected incomplete response") }
    catch (error: ChatGptFailure) { assertEquals("ERR_CHATGPT_INCOMPLETE", error.code) }

    val done = CompletedResponseParser()
    done.line("data: [DONE]")
    try { done.line(""); throw AssertionError("Expected premature end marker") }
    catch (error: ChatGptFailure) { assertEquals("ERR_CHATGPT_INCOMPLETE", error.code) }
  }

  @Test fun explicitEmptyScopeClearsPriorPlanPermission() {
    val previous = listOf("openid", PLAN_SCOPE)
    assertEquals(previous, ChatGptProtocol.grantedScopes(JSONObject(), previous))
    assertEquals(emptyList<String>(), ChatGptProtocol.grantedScopes(
      JSONObject().put("scope", ""), previous))
    assertEquals(listOf("openid"), ChatGptProtocol.grantedScopes(
      JSONObject().put("scope", "openid"), previous))
    assertFails { ChatGptProtocol.grantedScopes(JSONObject().put("scope", 42), previous) }
  }

  @Test fun topLevelStreamErrorRejectsPartialOutputWithSpecificCode() {
    val parser = CompletedResponseParser()
    parser.line("event: response.output_text.delta")
    parser.line("data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}")
    parser.line("")
    parser.line("event: error")
    parser.line("data: {\"type\":\"error\",\"error\":{\"code\":\"subscription_sharing_usage_limit_exceeded\"}}")
    try { parser.line(""); throw AssertionError("Expected stream failure") }
    catch (error: ChatGptFailure) { assertEquals("ERR_CHATGPT_QUOTA", error.code) }
  }

  private fun assertFails(block: () -> Unit) {
    try { block(); throw AssertionError("Expected rejection") } catch (_: IllegalArgumentException) {}
  }
}
