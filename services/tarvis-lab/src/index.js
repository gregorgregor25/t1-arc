import {
  modelProvider,
  readConfig,
  resolveServerLfmPhoneKey,
  resolveServerOpenAiKey,
} from "./config.js";
import { ApiKeyStore } from "./apiKeyStore.js";
import { HttpError } from "./errors.js";
import { createLfmAnswerer } from "./lfm.js";
import { createOpenAiAnswerer } from "./openai.js";
import { openRawDataset } from "./rawDataset.js";
import { ResultJournal } from "./resultJournal.js";
import { createTarvisLabServer } from "./server.js";

async function main() {
  const config = readConfig();
  const serverOpenAiKey = await resolveServerOpenAiKey(config);
  const lfmPhoneApiKey = await resolveServerLfmPhoneKey(config);
  const apiKeyStore = await ApiKeyStore.open({
    filePath: config.rememberedOpenAiKeyFile,
    initialKey: serverOpenAiKey,
  });
  const openAiAnswerQuestion = createOpenAiAnswerer();
  const lfmAnswerQuestion = config.lfmPhoneEndpoint && lfmPhoneApiKey
    ? createLfmAnswerer({ endpoint: config.lfmPhoneEndpoint })
    : null;
  const answerQuestion = (request) => {
    if (modelProvider(request.model) !== "phone") {
      return openAiAnswerQuestion(request);
    }
    if (!lfmAnswerQuestion || !lfmPhoneApiKey) {
      throw new HttpError(
        503,
        "local_model_not_configured",
        "The phone-hosted TARV1S model is not configured.",
      );
    }
    return lfmAnswerQuestion({
      ...request,
      apiKey: lfmPhoneApiKey,
      timeoutMs: config.lfmPhoneTimeoutMs,
    });
  };
  const browserDataset = config.rawSqlitePath
    ? openRawDataset(config.rawSqlitePath)
    : null;
  const resultJournal = config.resultJournalPath
    ? new ResultJournal({ filePath: config.resultJournalPath })
    : null;
  const { server } = createTarvisLabServer({
    config,
    apiKeyStore,
    answerQuestion,
    browserDataset,
    resultJournal,
    localModelConfigured: Boolean(lfmAnswerQuestion && lfmPhoneApiKey),
  });

  server.listen(config.port, config.host, () => {
    process.stdout.write(`TARV1S lab listening on http://${config.host}:${config.port}\n`);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch(() => {
  process.stderr.write("TARV1S lab failed to start. Check its configuration.\n");
  process.exitCode = 1;
});
