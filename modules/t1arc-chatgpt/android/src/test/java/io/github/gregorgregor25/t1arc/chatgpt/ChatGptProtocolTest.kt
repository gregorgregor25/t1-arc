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

  @Test fun completedItemSuppliesMissingTerminalOutputOnlyAfterCompletion() {
    val parser = CompletedResponseParser(headerless = true)
    parser.line("event: response.output_item.done")
    parser.line("""data: {"type":"response.output_item.done","output_index":1,"item":{"id":"msg_1","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"answer"}]}}""")
    parser.line("")
    parser.line("event: response.completed")
    parser.line("""data: {"type":"response.completed","response":{"status":"completed","output":[]}}""")
    val result = JSONObject(parser.line("")!!)
    assertEquals("answer", result.getJSONArray("output").getJSONObject(0)
      .getJSONArray("content").getJSONObject(0).getString("text"))
    assertEquals("output_item_done", parser.outputDiagnostic().selectedSource)
  }

  @Test fun completeTextPartMaySupplyMissingTerminalOutputButDeltasCannot() {
    val parser = CompletedResponseParser()
    parser.line("event: response.output_text.delta")
    parser.line("""data: {"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"content_index":0,"delta":"partial"}""")
    parser.line("")
    parser.line("event: response.output_text.done")
    parser.line("""data: {"type":"response.output_text.done","item_id":"msg_1","output_index":0,"content_index":0,"text":"complete"}""")
    parser.line("")
    parser.line("event: response.completed")
    parser.line("""data: {"type":"response.completed","response":{"status":"completed","output":[]}}""")
    val result = JSONObject(parser.line("")!!)
    assertEquals("complete", result.getJSONArray("output").getJSONObject(0)
      .getJSONArray("content").getJSONObject(0).getString("text"))
    assertEquals("output_text_done", parser.outputDiagnostic().selectedSource)

    val deltaOnly = CompletedResponseParser()
    deltaOnly.line("data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}")
    deltaOnly.line("")
    deltaOnly.line("data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[]}}")
    assertEquals(0, JSONObject(deltaOnly.line("")!!).getJSONArray("output").length())
  }

  @Test fun refusalDominatesEarlierTextInEventsAndTerminalOutput() {
    val parser = CompletedResponseParser()
    parser.line("""data: {"type":"response.output_text.done","item_id":"msg_1","output_index":0,"content_index":0,"text":"answer"}""")
    parser.line("")
    parser.line("""data: {"type":"response.refusal.done","item_id":"msg_1","output_index":0,"content_index":1}""")
    parser.line("")
    parser.line("""data: {"type":"response.completed","response":{"status":"completed","output":[]}}""")
    try { parser.line(""); throw AssertionError("Expected refusal") }
    catch (error: ChatGptFailure) { assertEquals("ERR_CHATGPT_STREAM_REJECTED", error.code) }

    val terminal = CompletedResponseParser()
    terminal.line("""data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"answer"},{"type":"refusal","refusal":"private"}]}]}}""")
    try { terminal.line(""); throw AssertionError("Expected terminal refusal") }
    catch (error: ChatGptFailure) { assertEquals("ERR_CHATGPT_STREAM_REJECTED", error.code) }
  }

  @Test fun conflictingOrUncorrelatedCompletedEventsDoNotReconstructAnswer() {
    val mismatch = CompletedResponseParser()
    mismatch.line("""data: {"type":"response.output_item.done","output_index":0,"item":{"id":"msg_1","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"one"}]}}""")
    mismatch.line("")
    mismatch.line("""data: {"type":"response.output_text.done","item_id":"msg_2","output_index":0,"content_index":0,"text":"two"}""")
    mismatch.line("")
    mismatch.line("""data: {"type":"response.completed","response":{"status":"completed","output":[]}}""")
    assertEquals(0, JSONObject(mismatch.line("")!!).getJSONArray("output").length())

    val duplicate = CompletedResponseParser()
    duplicate.line("""data: {"type":"response.output_text.done","item_id":"msg_1","output_index":0,"content_index":0,"text":"one"}""")
    duplicate.line("")
    duplicate.line("""data: {"type":"response.output_text.done","item_id":"msg_1","output_index":0,"content_index":0,"text":"two"}""")
    duplicate.line("")
    duplicate.line("""data: {"type":"response.completed","response":{"status":"completed","output":[]}}""")
    assertEquals(0, JSONObject(duplicate.line("")!!).getJSONArray("output").length())
  }

  @Test fun terminalErrorCannotReturnOtherwiseCompletedText() {
    val parser = CompletedResponseParser()
    parser.line("""data: {"type":"response.completed","response":{"status":"completed","error":{"code":"private"},"output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"answer"}]}]}}""")
    try { parser.line(""); throw AssertionError("Expected terminal error") }
    catch (error: ChatGptFailure) { assertEquals("ERR_CHATGPT_STREAM_REJECTED", error.code) }

    val incomplete = CompletedResponseParser()
    incomplete.line("""data: {"type":"response.completed","response":{"status":"completed","incomplete_details":"unexpected","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"answer"}]}]}}""")
    try { incomplete.line(""); throw AssertionError("Expected incomplete details rejection") }
    catch (error: ChatGptFailure) { assertEquals("ERR_CHATGPT_INCOMPLETE", error.code) }

    val partial = CompletedResponseParser()
    partial.line("""data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","role":"assistant","status":"incomplete","content":[{"type":"output_text","text":"partial"}]}]}}""")
    try { partial.line(""); throw AssertionError("Expected incomplete item rejection") }
    catch (error: ChatGptFailure) { assertEquals("ERR_CHATGPT_INCOMPLETE", error.code) }
  }

  @Test fun outOfOrderContentPartAndItemMustAgreeBeforeReconstruction() {
    val parser = CompletedResponseParser()
    parser.line("""data: {"type":"response.content_part.done","item_id":"msg_1","output_index":0,"content_index":0,"part":{"type":"output_text","text":"complete"}}""")
    parser.line("")
    parser.line("""data: {"type":"response.output_item.done","output_index":0,"item":{"id":"msg_1","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"complete"}]}}""")
    parser.line("")
    parser.line("""data: {"type":"response.completed","response":{"status":"completed","output":[]}}""")
    assertEquals("complete", JSONObject(parser.line("")!!).getJSONArray("output").getJSONObject(0)
      .getJSONArray("content").getJSONObject(0).getString("text"))
    assertEquals("output_item_done", parser.outputDiagnostic().selectedSource)
  }

  @Test fun completedItemCombinesItsTextPartsInsteadOfReturningOnlyTheFirst() {
    val parser = CompletedResponseParser()
    parser.line("""data: {"type":"response.output_item.done","output_index":0,"item":{"id":"msg_1","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"first"},{"type":"output_text","text":"second"}]}}""")
    parser.line("")
    parser.line("""data: {"type":"response.completed","response":{"status":"completed","output":[]}}""")
    val output = JSONObject(parser.line("")!!).getJSONArray("output").getJSONObject(0)
    assertEquals("firstsecond", output.getJSONArray("content").getJSONObject(0).getString("text"))
    assertEquals(1, output.getJSONArray("content").length())
  }

  @Test fun completedItemCannotAppendPastBlankTerminalMessage() {
    val parser = CompletedResponseParser()
    parser.line("""data: {"type":"response.output_item.done","output_index":2,"item":{"id":"msg_B","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"wrong slot"}]}}""")
    parser.line("")
    parser.line("""data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"reasoning"},{"id":"msg_A","type":"message","role":"assistant","status":"completed","content":[]}]}}""")
    val output = JSONObject(parser.line("")!!).getJSONArray("output")
    assertEquals(2, output.length())
    assertEquals(0, output.getJSONObject(1).getJSONArray("content").length())
    assertTrue(parser.outputDiagnostic().conflict)
  }

  @Test fun incompleteOrNonAssistantDoneItemCannotBecomeCompletedText() {
    val incomplete = CompletedResponseParser()
    incomplete.line("""data: {"type":"response.output_text.done","item_id":"msg_1","output_index":0,"content_index":0,"text":"partial"}""")
    incomplete.line("")
    incomplete.line("""data: {"type":"response.output_item.done","output_index":0,"item":{"id":"msg_1","type":"message","role":"assistant","status":"incomplete","content":[{"type":"output_text","text":"partial"}]}}""")
    incomplete.line("")
    incomplete.line("""data: {"type":"response.completed","response":{"status":"completed","output":[]}}""")
    try { incomplete.line(""); throw AssertionError("Expected incomplete assistant rejection") }
    catch (error: ChatGptFailure) { assertEquals("ERR_CHATGPT_INCOMPLETE", error.code) }

    val reasoning = CompletedResponseParser()
    reasoning.line("""data: {"type":"response.output_item.done","output_index":0,"item":{"id":"rs_1","type":"reasoning","status":"completed"}}""")
    reasoning.line("")
    reasoning.line("""data: {"type":"response.output_text.done","item_id":"rs_1","output_index":0,"content_index":0,"text":"not an answer"}""")
    reasoning.line("")
    reasoning.line("""data: {"type":"response.completed","response":{"status":"completed","output":[]}}""")
    assertEquals(0, JSONObject(reasoning.line("")!!).getJSONArray("output").length())
    assertTrue(reasoning.outputDiagnostic().conflict)
  }

  @Test fun headerlessResponseAcceptsOnlyFramedCompletedEvents() {
    val completed = CompletedResponseParser(headerless = true)
    assertEquals(null, completed.line("event: response.output_text.delta"))
    assertEquals(null, completed.line("data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}"))
    assertEquals(null, completed.line(""))
    assertEquals(null, completed.line("event: response.completed"))
    assertEquals(null, completed.line("data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[]}}"))
    assertTrue(completed.line("")!!.contains("\"status\":\"completed\""))

    val dataOnly = CompletedResponseParser(headerless = true)
    dataOnly.line("data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[]}}")
    assertTrue(dataOnly.line("")!!.contains("\"status\":\"completed\""))

    for (bodyLine in listOf("{\"status\":\"completed\",\"output\":[]}", "<html>error</html>")) {
      val notSse = CompletedResponseParser(headerless = true)
      try { notSse.line(bodyLine); throw AssertionError("Expected non-SSE rejection") }
      catch (error: ChatGptFailure) { assertEquals("ERR_CHATGPT_STREAM_FRAMING", error.code) }
    }
    val partial = CompletedResponseParser(headerless = true)
    partial.line("data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}")
    partial.line("")
    try { partial.finish() }
    catch (error: ChatGptFailure) { assertEquals("ERR_CHATGPT_INCOMPLETE", error.code) }
    try { CompletedResponseParser(headerless = true).finish() }
    catch (error: ChatGptFailure) { assertEquals("ERR_CHATGPT_STREAM_EMPTY", error.code) }
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
    catch (error: ChatGptFailure) { assertEquals("ERR_CHATGPT_STREAM_EVENT_JSON", error.code) }

    val missingResponse = CompletedResponseParser()
    missingResponse.line("event: response.completed")
    missingResponse.line("data: {\"type\":\"response.completed\",\"response\":null}")
    try { missingResponse.line(""); throw AssertionError("Expected missing completion response") }
    catch (error: ChatGptFailure) { assertEquals("ERR_CHATGPT_STREAM_COMPLETION_SHAPE", error.code) }
  }

  @Test fun mimeClassificationIsCaseInsensitiveAndNeverReflectsHeaderText() {
    assertEquals("event_stream", ChatGptProtocol.streamMimeClass("text/event-stream; charset=utf-8"))
    assertEquals("event_stream", ChatGptProtocol.streamMimeClass("Text/Event-Stream"))
    assertEquals("json", ChatGptProtocol.streamMimeClass("application/json; charset=UTF-8"))
    assertEquals("html", ChatGptProtocol.streamMimeClass("text/html"))
    assertEquals("plain_text", ChatGptProtocol.streamMimeClass("text/plain"))
    assertEquals("missing", ChatGptProtocol.streamMimeClass(null))
    assertEquals("other", ChatGptProtocol.streamMimeClass("private health text"))
  }

  @Test fun nonStreamBodyDiagnosticsExposeOnlyFixedShapesAndAllowlistedFields() {
    val completed = ChatGptProtocol.responseDiagnostic(JSONObject()
      .put("status", "completed").put("output", JSONArray()))
    assertEquals("completed_response", completed.shape)
    val rejected = ChatGptProtocol.responseDiagnostic(JSONObject().put("error", JSONObject()
      .put("code", "invalid_request_error").put("param", "text.format.schema")
      .put("message", "private health text")))
    assertEquals("error_object", rejected.shape)
    assertEquals("invalid_request_error", rejected.service)
    assertEquals("text", rejected.parameter)
    val unknown = ChatGptProtocol.responseDiagnostic(JSONObject().put("error", JSONObject()
      .put("code", "private health text").put("param", "private health text")))
    assertEquals("other_or_missing", unknown.service)
    assertEquals("other_or_missing", unknown.parameter)
    assertEquals("detail", ChatGptProtocol.responseDiagnostic(JSONObject()
      .put("detail", "private health text")).shape)
    assertEquals("other_json", ChatGptProtocol.responseDiagnostic(JSONObject().put("foo", "private health text")).shape)
    assertEquals("non_json_or_empty", ChatGptProtocol.responseDiagnostic(null).shape)
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
