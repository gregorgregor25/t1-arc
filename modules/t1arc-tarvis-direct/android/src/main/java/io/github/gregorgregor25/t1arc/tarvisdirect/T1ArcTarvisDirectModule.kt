package io.github.gregorgregor25.t1arc.tarvisdirect

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class T1ArcTarvisDirectModule : Module() {
  private val client: TarvisDirectClient by lazy {
    TarvisDirectClient(requireNotNull(appContext.reactContext))
  }

  override fun definition() = ModuleDefinition {
    Name("T1ArcTarvisDirect")

    AsyncFunction("getStatusAsync") Coroutine { ->
      withContext(Dispatchers.IO) {
        client.status(BuildConfig.TARVIS_MTLS_POC_ENABLED)
      }
    }

    AsyncFunction("enrollAsync") Coroutine { baseUrl: String, bearer: String ->
      requireEnabled()
      withContext(Dispatchers.IO) { client.enroll(baseUrl, bearer) }
    }

    AsyncFunction("exchangeOpenAiTokenAsync") Coroutine {
        identityProviderId: String,
        serviceAccountId: String,
      ->
      requireEnabled()
      withContext(Dispatchers.IO) {
        client.exchangeToken(identityProviderId, serviceAccountId)
      }
    }

    AsyncFunction("createResponseAsync") Coroutine { request: Map<String, Any?> ->
      requireEnabled()
      val model = request["model"] as? String
        ?: throw IllegalArgumentException("A model is required.")
      val inputJson = request["inputJson"] as? String
        ?: throw IllegalArgumentException("Model input is required.")
      val toolsJson = request["toolsJson"] as? String
        ?: throw IllegalArgumentException("A local tool list is required.")
      val textFormatJson = request["textFormatJson"] as? String
        ?: throw IllegalArgumentException("A structured answer format is required.")
      val maxOutputTokens = (request["maxOutputTokens"] as? Number)?.toInt()
        ?: throw IllegalArgumentException("A model output limit is required.")
      val reasoningEffort = (request["reasoningEffort"] as? String) ?: "low"
      val toolChoice = (request["toolChoice"] as? String) ?: "auto"
      withContext(Dispatchers.IO) {
        client.createResponse(
          model,
          inputJson,
          toolsJson,
          textFormatJson,
          maxOutputTokens,
          reasoningEffort,
          toolChoice,
        )
      }
    }

    AsyncFunction("clearAsync") Coroutine { ->
      withContext(Dispatchers.IO) {
        client.clear()
        true
      }
    }
  }

  private fun requireEnabled() {
    check(BuildConfig.TARVIS_MTLS_POC_ENABLED) {
      "The isolated TARV1S direct-mTLS proof of concept is disabled in this build."
    }
  }
}
