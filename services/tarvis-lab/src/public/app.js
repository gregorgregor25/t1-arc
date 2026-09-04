const elements = {
  clearButton: document.querySelector("#clear-button"),
  composerForm: document.querySelector("#composer-form"),
  composerInput: document.querySelector("#composer-input"),
  connectButton: document.querySelector("#connect-button"),
  connectionSettings: document.querySelector("#connection-settings"),
  connectionStatus: document.querySelector("#connection-status"),
  conversation: document.querySelector("#conversation"),
  elapsedStatus: document.querySelector("#elapsed-status"),
  messages: document.querySelector("#messages"),
  modelSelect: document.querySelector("#model-select"),
  openAiKey: document.querySelector("#openai-key"),
  promptButtons: [...document.querySelectorAll("[data-question]")],
  sendButton: document.querySelector("#send-button"),
  serviceToken: document.querySelector("#service-token"),
  snapshotCard: document.querySelector("#snapshot-card"),
  snapshotSummary: document.querySelector("#snapshot-summary"),
  welcome: document.querySelector("#welcome"),
};

const state = {
  bootstrap: null,
  busy: false,
  history: [],
  openAiKey: "",
  serviceToken: "",
};

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function credentialsHeaders() {
  const headers = {};
  if (state.serviceToken) {
    headers.authorization = `Bearer ${state.serviceToken}`;
  }
  if (state.openAiKey) {
    headers["x-openai-api-key"] = state.openAiKey;
  }
  return headers;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...credentialsHeaders(),
      ...options.headers,
    },
  });
  let body = null;
  if (response.status !== 204) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    const error = new Error(
      body?.error?.message || `The lab returned HTTP ${response.status}.`,
    );
    error.status = response.status;
    error.code = body?.error?.code || "request_failed";
    throw error;
  }
  return body;
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-GB").format(value);
}

function formatDate(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds)) {
    return "-";
  }
  if (milliseconds < 1_000) {
    return `${Math.round(milliseconds)} ms`;
  }
  return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
}

function snapshotLabel(snapshot) {
  if (!snapshot) {
    return "No server snapshot is loaded";
  }
  const parts = [];
  if (Number.isFinite(snapshot.rowCount)) {
    parts.push(`${formatInteger(snapshot.rowCount)} rows`);
  }
  if (Number.isFinite(snapshot.tableCount)) {
    parts.push(`${formatInteger(snapshot.tableCount)} tables`);
  }
  const start = formatDate(snapshot.range?.startMs);
  const end = formatDate(snapshot.range?.endMs);
  if (start && end) {
    parts.push(`${start} to ${end}`);
  }
  return parts.length > 0 ? `Private snapshot ready · ${parts.join(" · ")}` : "Private snapshot ready";
}

function selectedModel() {
  return state.bootstrap?.models.find((model) => model.id === elements.modelSelect.value) ?? null;
}

function requiresClientKey() {
  const model = selectedModel();
  return Boolean(model?.acceptsClientKey && !model.configured && !state.openAiKey);
}

function canAsk() {
  const model = selectedModel();
  const modelReady = Boolean(
    model?.configured || (model?.acceptsClientKey && state.openAiKey),
  );
  return Boolean(
    state.bootstrap?.snapshot &&
      modelReady &&
      !requiresClientKey() &&
      !state.busy,
  );
}

function updateControls() {
  const enabled = canAsk();
  const canChooseModel = Boolean(
    state.bootstrap?.snapshot &&
      state.bootstrap.models.some((model) => model.available) &&
      !state.busy,
  );
  elements.composerInput.disabled = !enabled;
  elements.modelSelect.disabled = !canChooseModel;
  elements.sendButton.disabled = !enabled || elements.composerInput.value.trim().length === 0;
  elements.clearButton.disabled = state.busy || elements.messages.childElementCount === 0;
  elements.promptButtons.forEach((button) => {
    button.disabled = !enabled;
  });
}

function populateModels(bootstrap) {
  const previous = elements.modelSelect.value;
  elements.modelSelect.replaceChildren();
  bootstrap.models.forEach((model) => {
    const option = element("option", "", model.label);
    option.value = model.id;
    option.title = model.description;
    option.disabled = !model.available;
    elements.modelSelect.append(option);
  });
  const validPrevious = bootstrap.models.some(
    (model) => model.id === previous && model.available,
  );
  const defaultAvailable = bootstrap.models.some(
    (model) => model.id === bootstrap.defaultModel && model.available,
  );
  elements.modelSelect.value = validPrevious
    ? previous
    : defaultAvailable
      ? bootstrap.defaultModel
      : bootstrap.models.find((model) => model.available)?.id || bootstrap.defaultModel;
}

function setConnectionFailure(error) {
  state.bootstrap = null;
  elements.snapshotCard.dataset.state = "error";
  if (error.status === 401) {
    elements.snapshotSummary.textContent = "This private lab needs its service token";
    elements.connectionStatus.textContent = "Locked · enter the service token in Connection";
    elements.connectionSettings.open = true;
  } else {
    elements.snapshotSummary.textContent = "The lab could not be reached";
    elements.connectionStatus.textContent = error.message;
  }
  updateControls();
}

async function loadBootstrap() {
  elements.connectButton.disabled = true;
  elements.connectionStatus.textContent = "Connecting...";
  elements.snapshotSummary.textContent = "Connecting to the private lab...";
  elements.snapshotCard.dataset.state = "";
  try {
    const bootstrap = await apiRequest("/dev/v1/browser/bootstrap");
    state.bootstrap = bootstrap;
    if (bootstrap.serverModelConfigured) {
      state.openAiKey = "";
      elements.openAiKey.value = "";
    }
    state.serviceToken = "";
    elements.serviceToken.value = "";
    populateModels(bootstrap);
    elements.snapshotSummary.textContent = snapshotLabel(bootstrap.snapshot);
    elements.snapshotCard.dataset.state = bootstrap.snapshot ? "ready" : "error";

    if (!bootstrap.snapshot) {
      elements.connectionStatus.textContent = "Snapshot unavailable · configure the server dataset";
    } else if (!bootstrap.modelConfigured) {
      elements.connectionStatus.textContent = "Model connection is not configured on the server";
    } else if (requiresClientKey()) {
      elements.connectionStatus.textContent = "Enter an OpenAI API key in Connection";
      elements.connectionSettings.open = true;
    } else {
      elements.connectionStatus.textContent = "Private snapshot connected · nothing is uploaded by this page";
      elements.connectionSettings.open = false;
    }
  } catch (error) {
    setConnectionFailure(error);
  } finally {
    elements.connectButton.disabled = false;
    updateControls();
  }
}

function scrollToLatest() {
  requestAnimationFrame(() => {
    elements.conversation.scrollTo({
      top: elements.conversation.scrollHeight,
      behavior: "smooth",
    });
  });
}

function appendUserMessage(question) {
  const wrapper = element("article", "message message-user");
  wrapper.setAttribute("aria-label", "You");
  wrapper.append(element("div", "message-card", question));
  elements.messages.append(wrapper);
}

function assistantShell(extraClass = "") {
  const wrapper = element("article", `message message-assistant ${extraClass}`.trim());
  wrapper.setAttribute("aria-label", "TARV1S");
  wrapper.append(element("div", "assistant-mark", "T1"));
  const card = element("div", "message-card");
  wrapper.append(card);
  return { wrapper, card };
}

function appendLoading(modelLabel) {
  const { wrapper, card } = assistantShell("message-loading");
  card.classList.add("loading-card");
  const title = element("div", "loading-title");
  title.append(element("span", "", `Analysing with ${modelLabel}`));
  const dots = element("span", "loading-dots");
  dots.setAttribute("aria-hidden", "true");
  dots.append(element("span"), element("span"), element("span"));
  title.append(dots);
  const time = element("div", "loading-time", "Checking the snapshot · 0.0 s");
  card.append(title, time);
  elements.messages.append(wrapper);
  return { wrapper, time };
}

function appendLimitations(card, limitations) {
  const block = element("div", `limitations${limitations.length === 0 ? " limitations-clear" : ""}`);
  block.append(element("strong", "", "Limitations"));
  if (limitations.length === 0) {
    block.append(element("p", "", "No additional limitations were reported for this answer."));
  } else {
    const list = element("ul");
    limitations.forEach((limitation) => list.append(element("li", "", limitation)));
    block.append(list);
  }
  card.append(block);
}

function formatCell(value) {
  if (value === null) {
    return "null";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function evidenceDetails(evidence) {
  const details = element("details", "answer-details");
  details.append(element("summary", "", `Evidence & SQL · ${evidence.length}`));
  const body = element("div", "detail-body");

  evidence.forEach((item) => {
    const article = element("article", "evidence-item");
    const title = element("div", "evidence-title");
    title.append(
      element("strong", "", item.purpose || "Dataset query"),
      element("span", "", `${item.id || "query"} · ${formatInteger(item.rowCount || 0)} row${item.rowCount === 1 ? "" : "s"}${item.truncated ? " · capped" : ""}`),
    );
    article.append(title, element("div", "sql-label", "SQL"));
    const sql = element("pre");
    const code = element("code", "", item.sql || "");
    sql.append(code);
    article.append(sql);

    const columns = Array.isArray(item.columns) ? item.columns : [];
    const rows = Array.isArray(item.preview) ? item.preview : [];
    if (columns.length > 0 && rows.length > 0) {
      const tableWrap = element("div", "table-wrap");
      const table = element("table");
      const thead = element("thead");
      const headRow = element("tr");
      columns.forEach((column) => headRow.append(element("th", "", column)));
      thead.append(headRow);
      const tbody = element("tbody");
      rows.forEach((row) => {
        const tableRow = element("tr");
        columns.forEach((column) => tableRow.append(element("td", "", formatCell(row?.[column]))));
        tbody.append(tableRow);
      });
      table.append(thead, tbody);
      tableWrap.append(table);
      article.append(tableWrap);
    }
    body.append(article);
  });
  details.append(body);
  return details;
}

function metric(body, label, value) {
  const item = element("div", "metric");
  item.append(element("span", "", label), element("strong", "", value));
  body.append(item);
}

function metricsDetails(metrics) {
  const details = element("details", "answer-details");
  details.append(element("summary", "", "Run metrics"));
  const body = element("div", "detail-body metrics-grid");
  const model = state.bootstrap?.models.find((item) => item.id === metrics.model);
  metric(body, "Model", model?.label || metrics.model || "Unknown");
  metric(body, "Total time", formatDuration(metrics.totalMs));
  metric(body, "Model time", formatDuration(metrics.modelMs));
  metric(body, "SQL time", formatDuration(metrics.sqlMs));
  metric(body, "Model rounds", formatInteger(metrics.modelRounds || 0));
  metric(body, "SQL queries", formatInteger(metrics.sqlCalls || 0));
  metric(body, "Total tokens", formatInteger(metrics.totalTokens || 0));
  metric(body, "Input tokens", formatInteger(metrics.inputTokens || 0));
  metric(body, "Output tokens", formatInteger(metrics.outputTokens || 0));
  if (metrics.phoneInference) {
    metric(
      body,
      "Phone decode speed",
      `${Number(metrics.phoneInference.decodeTokensPerSecond || 0).toFixed(1)} tok/s`,
    );
    metric(
      body,
      "Phone-generated tokens",
      formatInteger(metrics.phoneInference.generatedTokens || 0),
    );
  }
  details.append(body);
  return details;
}

function appendAssistantMessage(result) {
  const answer = result.answer || {};
  const evidence = Array.isArray(result.evidence) ? result.evidence : [];
  const limitations = Array.isArray(answer.limitations) ? answer.limitations : [];
  const confidence = ["high", "moderate", "limited"].includes(answer.confidence)
    ? answer.confidence
    : "limited";
  const { wrapper, card } = assistantShell();
  const heading = element("div", "answer-heading");
  heading.append(
    element("h2", "", answer.headline || "TARV1S answer"),
    element("span", `confidence confidence-${confidence}`, `${confidence} confidence`),
  );
  card.append(heading, element("p", "answer-body", answer.answer || "No answer was returned."));
  appendLimitations(card, limitations);
  card.append(evidenceDetails(evidence), metricsDetails(result.metrics || {}));
  elements.messages.append(wrapper);
}

function appendErrorMessage(error) {
  const { wrapper, card } = assistantShell("message-error");
  const errorCard = element("div", "error-card");
  errorCard.append(
    element("strong", "", "That analysis did not finish"),
    element("p", "", error.message),
  );
  card.append(errorCard);
  elements.messages.append(wrapper);
}

function modelLabel(modelId) {
  return state.bootstrap?.models.find((model) => model.id === modelId)?.label || modelId;
}

function historyAnswer(answer) {
  return `${answer?.headline || "TARV1S answer"}\n\n${answer?.answer || ""}`.slice(0, 2_000);
}

async function askQuestion(question) {
  const model = elements.modelSelect.value;
  const priorHistory = state.history.slice(-12);
  state.busy = true;
  elements.welcome.hidden = true;
  appendUserMessage(question);
  const loading = appendLoading(modelLabel(model));
  const startedAt = performance.now();
  const updateElapsed = () => {
    const elapsed = (performance.now() - startedAt) / 1_000;
    const label = `${elapsed.toFixed(1)} s`;
    loading.time.textContent = `Checking the snapshot · ${label}`;
    elements.elapsedStatus.textContent = `Analysing · ${label}`;
  };
  const timer = window.setInterval(updateElapsed, 100);
  elements.composerInput.value = "";
  resizeComposer();
  updateControls();
  scrollToLatest();

  try {
    const result = await apiRequest("/dev/v1/browser/questions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question,
        history: priorHistory,
        asOfMs: Date.now(),
        turnId: globalThis.crypto?.randomUUID?.() || `${Date.now()}`,
        model,
      }),
    });
    loading.wrapper.remove();
    appendAssistantMessage(result);
    state.history.push(
      { role: "user", content: question },
      { role: "assistant", content: historyAnswer(result.answer) },
    );
    state.history = state.history.slice(-12);
    elements.connectionStatus.textContent = result.journal?.recorded
      ? `Answered with ${modelLabel(model)} · full run saved`
      : `Answered with ${modelLabel(model)} · private snapshot remains on the server`;
  } catch (error) {
    loading.wrapper.remove();
    appendErrorMessage(error);
    elements.connectionStatus.textContent = error.message;
    if (error.status === 401) {
      elements.connectionSettings.open = true;
    }
  } finally {
    window.clearInterval(timer);
    elements.elapsedStatus.textContent = "";
    state.busy = false;
    updateControls();
    scrollToLatest();
    elements.composerInput.focus();
  }
}

function resizeComposer() {
  elements.composerInput.style.height = "auto";
  elements.composerInput.style.height = `${Math.min(elements.composerInput.scrollHeight, 160)}px`;
}

function clearConversation() {
  if (state.busy) {
    return;
  }
  state.history = [];
  elements.messages.replaceChildren();
  elements.welcome.hidden = false;
  elements.connectionStatus.textContent = "Conversation cleared · private snapshot still connected";
  updateControls();
  elements.composerInput.focus();
}

elements.composerInput.addEventListener("input", () => {
  resizeComposer();
  updateControls();
});

elements.composerInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    elements.composerForm.requestSubmit();
  }
});

elements.composerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const question = elements.composerInput.value.trim();
  if (!question || !canAsk()) {
    return;
  }
  void askQuestion(question);
});

elements.clearButton.addEventListener("click", clearConversation);

elements.modelSelect.addEventListener("change", () => {
  const model = selectedModel();
  if (model?.provider === "phone") {
    elements.connectionStatus.textContent = "Selected model runs on this phone · snapshot tools remain on the private lab host";
  } else if (model?.available) {
    elements.connectionStatus.textContent = "Private snapshot connected · selected model uses the configured provider";
  }
  updateControls();
});

elements.connectButton.addEventListener("click", () => {
  state.serviceToken = elements.serviceToken.value.trim();
  state.openAiKey = elements.openAiKey.value.trim();
  void loadBootstrap();
});

elements.promptButtons.forEach((button) => {
  button.addEventListener("click", () => {
    elements.composerInput.value = button.dataset.question || "";
    resizeComposer();
    elements.composerForm.requestSubmit();
  });
});

void loadBootstrap();
