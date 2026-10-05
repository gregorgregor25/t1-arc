import * as Crypto from "expo-crypto";

import {
  acquireLocalDataWriteLease,
  assertLocalDataWriteLeaseCurrent,
  type LocalDataWriteLease,
} from "@/data/privacy/localDataWriteEpoch";
import {
  forceClearEpochBoundSecureStoreValue,
  loadEpochBoundSecureStoreValue,
  saveEpochBoundSecureStoreValue,
} from "@/data/privacy/localDataEpochSecureStore";
import { runTarvisConnectionMutation, TarvisConnectionSupersededError } from "./connectionCoordinator";

const STORAGE_KEY = "t1arc.tarvis.chatgpt-connection.v1";
const DIRECT_SCOPE = "chatgpt.tokens.use.direct";
const REFRESH_MARGIN_MS = 2 * 60_000;
const MODEL_CATALOG_MAX_AGE_MS = 5 * 60_000;

export interface ChatGptCredentials {
  clientId: string;
  subject: string;
  email?: string;
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number;
  scopes: string[];
}

interface ChatGptNativeModule {
  signIn(options: {
    hostId: string;
    clientId?: string;
    idTokenHint?: string;
    expectedSubject?: string;
    requestConsent?: boolean;
  }): Promise<{ transactionId: string; clientId: string }>;
  completeSignIn(transactionId: string): Promise<ChatGptCredentials>;
  cancelSignIn(): Promise<void>;
  refreshSession(credentials: ChatGptCredentials): Promise<ChatGptCredentials>;
  revokeSession(credentials: ChatGptCredentials): Promise<boolean>;
  listModels(accessToken: string): Promise<string>;
}

export interface ChatGptModel {
  slug: string;
  displayName: string;
}

interface SavedAccount {
  id: string;
  clientId: string;
  subject: string;
  email?: string;
  credentials?: ChatGptCredentials;
  models: ChatGptModel[];
  modelsFetchedAt?: number;
  selectedModel?: string;
}

interface SavedConnection {
  hostId: string;
  accounts: SavedAccount[];
  activeAccountId?: string;
  /** Issued at callback, before the first code exchange can fail. */
  pendingClientId?: string;
}

export interface ChatGptConnectionState {
  available: boolean;
  hasPendingRegistration: boolean;
  accounts: {
    id: string;
    label: string;
    hasSession: boolean;
    connected: boolean;
    models: ChatGptModel[];
    selectedModel?: string;
  }[];
  activeAccountId?: string;
  connected: boolean;
  models: ChatGptModel[];
  selectedModel?: string;
}

export type ChatGptState = ChatGptConnectionState;

export class ChatGptModelUnavailableError extends Error {
  constructor() {
    super("The selected ChatGPT model is unavailable. Choose a model in Tarv1s settings.");
    this.name = "ChatGptModelUnavailableError";
  }
}

export class ChatGptConnectionError extends Error {
  constructor(message: string, readonly settingsRequired = true) {
    super(message);
    this.name = "ChatGptConnectionError";
  }
}

let stateWriteTail: Promise<void> = Promise.resolve();
let refreshTail: Promise<void> = Promise.resolve();
let connectionIntent = 0;
let activeBrowserIntent: number | undefined;
let nativeModulePromise: Promise<typeof import("../../../modules/t1arc-chatgpt")> | undefined;
let staleCatalogRefresh: { key: string; promise: Promise<ChatGptConnectionState> } | undefined;

function loadNativeModule() {
  nativeModulePromise ??= import("../../../modules/t1arc-chatgpt");
  return nativeModulePromise;
}

function assertIntentCurrent(intent: number) {
  if (intent !== connectionIntent) throw new TarvisConnectionSupersededError();
}

async function cancelPendingSignIn() {
  try { await (await getNative()).cancelSignIn(); } catch { /* No active browser or native module. */ }
}

function bestEffortRevoke(credentials: ChatGptCredentials) {
  void getNative().then((native) => native.revokeSession(credentials)).catch(() => undefined);
}

function nativeErrorCode(error: unknown) {
  return error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
}

async function withStateWriteLock<T>(task: () => Promise<T>): Promise<T> {
  const previous = stateWriteTail;
  let release!: () => void;
  stateWriteTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

async function withRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  const previous = refreshTail;
  let release!: () => void;
  refreshTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

async function getNative(): Promise<ChatGptNativeModule> {
  const module = await loadNativeModule();
  const native = module.default;
  if (!module.isAvailable() || !native) {
    throw new ChatGptConnectionError("ChatGPT sign-in is unavailable on this device build.");
  }
  return native;
}

async function nativeAvailable() {
  try {
    const module = await loadNativeModule();
    return module.isAvailable();
  } catch {
    return false;
  }
}

function validString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validCredentials(value: unknown): value is ChatGptCredentials {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<ChatGptCredentials>;
  return validString(entry.clientId) && entry.clientId !== "dynamic_agent_client"
    && validString(entry.subject) && validString(entry.accessToken)
    && validString(entry.refreshToken) && validString(entry.idToken)
    && Number.isFinite(entry.expiresAt) && Array.isArray(entry.scopes)
    && entry.scopes.every(validString)
    && (entry.email === undefined || typeof entry.email === "string");
}

function validModel(value: unknown): value is ChatGptModel {
  return !!value && typeof value === "object"
    && validString((value as ChatGptModel).slug)
    && validString((value as ChatGptModel).displayName);
}

function parseSavedConnection(value: unknown): SavedConnection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const saved = value as Partial<SavedConnection>;
  if (!validString(saved.hostId) || !saved.hostId.startsWith("urn:uuid:") || !Array.isArray(saved.accounts)) return undefined;
  const accounts: SavedAccount[] = [];
  for (const item of saved.accounts) {
    if (!item || typeof item !== "object") return undefined;
    const account = item as Partial<SavedAccount>;
    if (!validString(account.id) || !validString(account.clientId) || !validString(account.subject)
      || !Array.isArray(account.models) || !account.models.every(validModel)
      || (account.modelsFetchedAt !== undefined && (!Number.isFinite(account.modelsFetchedAt) || account.modelsFetchedAt < 0))
      || (account.email !== undefined && typeof account.email !== "string")
      || (account.credentials !== undefined && !validCredentials(account.credentials))
      || (account.selectedModel !== undefined && typeof account.selectedModel !== "string")) return undefined;
    if (account.credentials && (account.credentials.clientId !== account.clientId || account.credentials.subject !== account.subject)) return undefined;
    accounts.push(account as SavedAccount);
  }
  if (saved.activeAccountId !== undefined && typeof saved.activeAccountId !== "string") return undefined;
  if (saved.pendingClientId !== undefined && (!validString(saved.pendingClientId) || saved.pendingClientId === "dynamic_agent_client")) return undefined;
  return { hostId: saved.hostId, accounts, activeAccountId: saved.activeAccountId, pendingClientId: saved.pendingClientId };
}

async function loadSaved(lease: LocalDataWriteLease): Promise<SavedConnection | undefined> {
  return loadEpochBoundSecureStoreValue(STORAGE_KEY, lease, parseSavedConnection);
}

function accountId(credentials: Pick<ChatGptCredentials, "clientId" | "subject">) {
  return `${credentials.clientId}:${credentials.subject}`;
}

function hasDirectScope(credentials?: ChatGptCredentials) {
  return Boolean(credentials?.scopes.includes(DIRECT_SCOPE));
}

function publicState(saved: SavedConnection | undefined, available: boolean): ChatGptConnectionState {
  const active = saved?.accounts.find((account) => account.id === saved.activeAccountId);
  return {
    available,
    hasPendingRegistration: Boolean(saved?.pendingClientId),
    accounts: saved?.accounts.map((account) => ({
      id: account.id,
      label: `${account.email || "ChatGPT account"} · ${account.clientId.slice(-6)}`,
      hasSession: Boolean(account.credentials),
      connected: hasDirectScope(account.credentials),
      models: [...account.models],
      selectedModel: account.selectedModel,
    })) ?? [],
    activeAccountId: saved?.activeAccountId,
    connected: hasDirectScope(active?.credentials),
    models: [...(active?.models ?? [])],
    selectedModel: active?.selectedModel,
  };
}

async function fetchModels(token: string, lease: LocalDataWriteLease): Promise<ChatGptModel[]> {
  try {
    const native = await getNative();
    const raw = await native.listModels(token);
    await assertLocalDataWriteLeaseCurrent(lease);
    const body = JSON.parse(raw) as { models?: unknown };
    if (!Array.isArray(body.models)) throw new Error("model catalog unavailable");
    return body.models.flatMap((item: unknown) => {
      if (!item || typeof item !== "object") return [];
      const model = item as { slug?: unknown; display_name?: unknown; visibility?: unknown };
      return model.visibility === "list" && validString(model.slug) && validString(model.display_name)
        ? [{ slug: model.slug, displayName: model.display_name }]
        : [];
    });
  } catch (error) {
    await assertLocalDataWriteLeaseCurrent(lease);
    if (error instanceof ChatGptConnectionError) throw error;
    throw new ChatGptConnectionError("Could not load models for this ChatGPT account. Try again in Tarv1s settings.");
  }
}

export async function getChatGptState(lease?: LocalDataWriteLease): Promise<ChatGptConnectionState> {
  const writeLease = lease ?? await acquireLocalDataWriteLease();
  const saved = await loadSaved(writeLease);
  await assertLocalDataWriteLeaseCurrent(writeLease);
  const available = await nativeAvailable();
  await assertLocalDataWriteLeaseCurrent(writeLease);
  return publicState(saved, available);
}

export async function hasChatGptStoredData(lease: LocalDataWriteLease): Promise<boolean> {
  return (await loadSaved(lease)) !== undefined;
}

/** Dismisses a browser authorization without touching an existing connection. */
export async function cancelChatGptSignIn(): Promise<void> {
  ++connectionIntent;
  await cancelPendingSignIn();
}

/** Explicitly starts a fresh registration after an incomplete first attempt. */
export async function discardPendingChatGptRegistration(lease: LocalDataWriteLease): Promise<void> {
  const intent = ++connectionIntent;
  await cancelPendingSignIn();
  await runTarvisConnectionMutation(() => withStateWriteLock(async () => {
    assertIntentCurrent(intent);
    const saved = await loadSaved(lease);
    if (!saved?.pendingClientId) return;
    saved.pendingClientId = undefined;
    await saveEpochBoundSecureStoreValue(STORAGE_KEY, saved, lease);
  }));
}

export async function signInChatGpt(lease: LocalDataWriteLease, existingAccountId?: string): Promise<ChatGptConnectionState> {
  const intent = ++connectionIntent;
  const previousBrowser = activeBrowserIntent === undefined ? undefined : cancelPendingSignIn();
  // The stable host ID is committed before the browser opens, but the browser
  // does not hold the connection queue while the user is signing in.
  const setup = await runTarvisConnectionMutation(() => withStateWriteLock(async () => {
    assertIntentCurrent(intent);
    let saved = await loadSaved(lease);
    if (!saved) {
      saved = { hostId: `urn:uuid:${Crypto.randomUUID()}`, accounts: [] };
      await saveEpochBoundSecureStoreValue(STORAGE_KEY, saved, lease);
    }
    const prior = existingAccountId ? saved.accounts.find((account) => account.id === existingAccountId) : undefined;
    if (existingAccountId && !prior) throw new ChatGptConnectionError("Choose a saved ChatGPT account or add a new one.");
    return { hostId: saved.hostId, prior, pendingClientId: saved.pendingClientId };
  }));
  assertIntentCurrent(intent);
  await previousBrowser;
  const native = await getNative();
  assertIntentCurrent(intent);
  let credentials: ChatGptCredentials;
  let issuedClientId: string | undefined;
  try {
    activeBrowserIntent = intent;
    const callback = await native.signIn({
      hostId: setup.hostId,
      clientId: setup.prior?.clientId ?? setup.pendingClientId,
      idTokenHint: setup.prior?.credentials?.idToken,
      expectedSubject: setup.prior?.subject,
      requestConsent: Boolean(setup.prior?.credentials && !hasDirectScope(setup.prior.credentials)),
    });
    await assertLocalDataWriteLeaseCurrent(lease);
    assertIntentCurrent(intent);
    if (!validString(callback?.transactionId) || !validString(callback.clientId)
      || callback.clientId === "dynamic_agent_client"
      || (setup.prior && callback.clientId !== setup.prior.clientId)
      || (!setup.prior && setup.pendingClientId && callback.clientId !== setup.pendingClientId)) {
      throw new ChatGptConnectionError("ChatGPT returned an unexpected registration. No connection was changed.");
    }
    issuedClientId = callback.clientId;
    // This save must finish before code exchange; invalid_grant and process
    // interruption must not lose a newly issued registration.
    await runTarvisConnectionMutation(() => withStateWriteLock(async () => {
      assertIntentCurrent(intent);
      const current = await loadSaved(lease);
      if (!current || current.hostId !== setup.hostId) throw new TarvisConnectionSupersededError();
      if (!setup.prior) {
        current.pendingClientId = callback.clientId;
        await saveEpochBoundSecureStoreValue(STORAGE_KEY, current, lease);
      }
    }));
    credentials = await native.completeSignIn(callback.transactionId);
  } catch {
    if (activeBrowserIntent === intent) await cancelPendingSignIn();
    await assertLocalDataWriteLeaseCurrent(lease);
    assertIntentCurrent(intent);
    throw new ChatGptConnectionError("ChatGPT sign-in did not finish. Please try again.");
  } finally {
    if (activeBrowserIntent === intent) activeBrowserIntent = undefined;
  }
  try {
    await assertLocalDataWriteLeaseCurrent(lease);
    assertIntentCurrent(intent);
  } catch (error) {
    // OAuth may complete at the same instant the user cancels or erases data.
    // Do not publish its tokens; revoke the newly issued session best-effort.
    bestEffortRevoke(credentials);
    throw error;
  }
  if (!validCredentials(credentials) || credentials.clientId !== issuedClientId || (setup.prior &&
    (credentials.clientId !== setup.prior.clientId || credentials.subject !== setup.prior.subject))) {
    if (validCredentials(credentials)) bestEffortRevoke(credentials);
    throw new ChatGptConnectionError("ChatGPT returned an unexpected account. No connection was changed.");
  }
  const id = accountId(credentials);
  try {
    await runTarvisConnectionMutation(() => withStateWriteLock(async () => {
      assertIntentCurrent(intent);
      const saved = await loadSaved(lease);
      if (!saved || saved.hostId !== setup.hostId) throw new TarvisConnectionSupersededError();
      const old = saved.accounts.find((account) => account.id === id);
      const account: SavedAccount = {
        id, clientId: credentials.clientId, subject: credentials.subject,
        email: credentials.email, credentials, models: [], selectedModel: old?.selectedModel,
      };
      // Retain validated credentials if the model catalog is temporarily down.
      saved.accounts = [...saved.accounts.filter((item) => item.id !== id), account];
      saved.activeAccountId = id;
      if (saved.pendingClientId === credentials.clientId) saved.pendingClientId = undefined;
      await saveEpochBoundSecureStoreValue(STORAGE_KEY, saved, lease);
    }));
  } catch (error) {
    bestEffortRevoke(credentials);
    throw error;
  }
  if (hasDirectScope(credentials)) {
    const models = await fetchModels(credentials.accessToken, lease);
    await runTarvisConnectionMutation(() => withStateWriteLock(async () => {
      assertIntentCurrent(intent);
      const saved = await loadSaved(lease);
      const account = saved?.accounts.find((item) => item.id === id);
      if (!saved || !account?.credentials || account.credentials.accessToken !== credentials.accessToken) {
        throw new TarvisConnectionSupersededError();
      }
      account.models = models;
      account.modelsFetchedAt = Date.now();
      await saveEpochBoundSecureStoreValue(STORAGE_KEY, saved, lease);
    }));
  }
  assertIntentCurrent(intent);
  return getChatGptState(lease);
}

async function prepareAccountCredentials(
  id: string,
  lease: LocalDataWriteLease,
  intent: number,
  requireActive: boolean,
): Promise<ChatGptCredentials> {
  return withRefreshLock(async () => {
    assertIntentCurrent(intent);
    const saved = await loadSaved(lease);
    const account = saved?.accounts.find((item) => item.id === id);
    if (!saved || !account?.credentials || (requireActive && saved.activeAccountId !== id)) {
      throw new ChatGptConnectionError("Sign in to this ChatGPT account first.");
    }
    const original = account.credentials;
    const refreshed = await refreshIfNeeded(original, lease);
    let committed: ChatGptCredentials;
    try {
      committed = await withStateWriteLock(async () => {
        assertIntentCurrent(intent);
        const current = await loadSaved(lease);
        const currentAccount = current?.accounts.find((item) => item.id === id);
        if (!current || !currentAccount?.credentials
          || (requireActive && current.activeAccountId !== id)
          || currentAccount.credentials.refreshToken !== original.refreshToken) {
          throw new TarvisConnectionSupersededError();
        }
        if (refreshed !== original) {
          currentAccount.credentials = refreshed;
          // Save a rotated refresh token before the fallible catalog request.
          await saveEpochBoundSecureStoreValue(STORAGE_KEY, current, lease);
        }
        return refreshed;
      });
    } catch (error) {
      if (refreshed !== original && connectionIntent !== intent) bestEffortRevoke(refreshed);
      throw error;
    }
    if (!hasDirectScope(committed)) {
      throw new ChatGptConnectionError("ChatGPT plan use is not enabled for this account. Sign in again in Tarv1s settings.");
    }
    return committed;
  });
}

export async function selectChatGptAccount(id: string, lease: LocalDataWriteLease): Promise<ChatGptConnectionState> {
  const intent = ++connectionIntent;
  void cancelPendingSignIn();
  const initial = await loadSaved(lease);
  const candidate = initial?.accounts.find((item) => item.id === id);
  if (candidate?.credentials && !hasDirectScope(candidate.credentials)) {
    // A signed-in identity with no plan permission is still selectable so the
    // user can reauthorize or sign out that exact registration.
    return runTarvisConnectionMutation(() => withStateWriteLock(async () => {
      assertIntentCurrent(intent);
      const saved = await loadSaved(lease);
      const account = saved?.accounts.find((item) => item.id === id);
      if (!saved || !account?.credentials) throw new TarvisConnectionSupersededError();
      if (hasDirectScope(account.credentials)) throw new TarvisConnectionSupersededError();
      account.models = [];
      account.modelsFetchedAt = undefined;
      account.selectedModel = undefined;
      saved.activeAccountId = id;
      await saveEpochBoundSecureStoreValue(STORAGE_KEY, saved, lease);
      return publicState(saved, true);
    }));
  }
  // Abort the old provider's requests immediately, then release the connection
  // queue while native refresh/catalog network work is pending.
  await runTarvisConnectionMutation(async () => undefined);
  const credentials = await prepareAccountCredentials(id, lease, intent, false);
  assertIntentCurrent(intent);
  const models = await fetchModels(credentials.accessToken, lease);
  return runTarvisConnectionMutation(() => withStateWriteLock(async () => {
    assertIntentCurrent(intent);
    const saved = await loadSaved(lease);
    const account = saved?.accounts.find((item) => item.id === id);
    if (!saved || !account?.credentials || account.credentials.refreshToken !== credentials.refreshToken) {
      throw new TarvisConnectionSupersededError();
    }
    account.models = models;
    account.modelsFetchedAt = Date.now();
    saved.activeAccountId = id;
    await saveEpochBoundSecureStoreValue(STORAGE_KEY, saved, lease);
    return publicState(saved, true);
  }));
}

export async function selectChatGptModel(slug: string, lease: LocalDataWriteLease): Promise<ChatGptConnectionState> {
  const intent = ++connectionIntent;
  void cancelPendingSignIn();
  return runTarvisConnectionMutation(() => withStateWriteLock(async () => {
    assertIntentCurrent(intent);
    const saved = await loadSaved(lease);
    const account = saved?.accounts.find((item) => item.id === saved.activeAccountId);
    if (!saved || !account?.credentials || !hasDirectScope(account.credentials)) {
      throw new ChatGptConnectionError("Sign in to ChatGPT first.");
    }
    if (!account.models.some((model) => model.slug === slug)) throw new ChatGptModelUnavailableError();
    account.selectedModel = slug;
    await saveEpochBoundSecureStoreValue(STORAGE_KEY, saved, lease);
    return publicState(saved, true);
  }));
}

export async function refreshChatGptModels(lease: LocalDataWriteLease): Promise<ChatGptConnectionState> {
  const intent = connectionIntent;
  const initial = await loadSaved(lease);
  const id = initial?.activeAccountId;
  if (!id) throw new ChatGptConnectionError("Sign in to ChatGPT first.");
  const credentials = await prepareAccountCredentials(id, lease, intent, true);
  assertIntentCurrent(intent);
  const models = await fetchModels(credentials.accessToken, lease);
  return withStateWriteLock(async () => {
    assertIntentCurrent(intent);
    const saved = await loadSaved(lease);
    const account = saved?.accounts.find((item) => item.id === id);
    if (!saved || saved.activeAccountId !== id || !account?.credentials
      || account.credentials.refreshToken !== credentials.refreshToken) {
      throw new TarvisConnectionSupersededError();
    }
    account.models = models;
    account.modelsFetchedAt = Date.now();
    await saveEpochBoundSecureStoreValue(STORAGE_KEY, saved, lease);
    return publicState(saved, true);
  });
}

/** Refresh the visible account catalog on picker entry, without immediately
 * repeating the fetch already done at sign-in or account switch. */
export async function refreshChatGptModelsIfStale(lease: LocalDataWriteLease): Promise<ChatGptConnectionState> {
  const saved = await loadSaved(lease);
  await assertLocalDataWriteLeaseCurrent(lease);
  const account = saved?.accounts.find((item) => item.id === saved.activeAccountId);
  if (!account?.credentials || !hasDirectScope(account.credentials)) return getChatGptState(lease);
  const now = Date.now();
  if (account.modelsFetchedAt !== undefined && account.modelsFetchedAt <= now
    && now - account.modelsFetchedAt < MODEL_CATALOG_MAX_AGE_MS) return getChatGptState(lease);
  // A returning sign-in or account switch can reuse the same account ID while
  // superseding an older catalog request. Never join that older request.
  const key = `${lease.epoch}:${account.id}:${connectionIntent}`;
  if (staleCatalogRefresh?.key === key) return staleCatalogRefresh.promise;
  const promise = refreshChatGptModels(lease).finally(() => {
    if (staleCatalogRefresh?.promise === promise) staleCatalogRefresh = undefined;
  });
  staleCatalogRefresh = { key, promise };
  return promise;
}

async function refreshIfNeeded(credentials: ChatGptCredentials, lease: LocalDataWriteLease) {
  if (credentials.expiresAt - Date.now() > REFRESH_MARGIN_MS) return credentials;
  const native = await getNative();
  const intent = connectionIntent;
  try {
    const refreshed = await native.refreshSession(credentials);
    if (!validCredentials(refreshed) || refreshed.clientId !== credentials.clientId || refreshed.subject !== credentials.subject) {
      throw new Error("identity mismatch");
    }
    try {
      await assertLocalDataWriteLeaseCurrent(lease);
      assertIntentCurrent(intent);
    } catch (error) {
      bestEffortRevoke(refreshed);
      throw error;
    }
    return refreshed;
  } catch (error) {
    await assertLocalDataWriteLeaseCurrent(lease);
    if (error instanceof TarvisConnectionSupersededError) throw error;
    if (nativeErrorCode(error) === "ERR_CHATGPT_INVALID_GRANT") {
      await withStateWriteLock(async () => {
        const saved = await loadSaved(lease);
        const account = saved?.accounts.find((item) => item.clientId === credentials.clientId && item.subject === credentials.subject);
        if (!saved || !account?.credentials || account.credentials.refreshToken !== credentials.refreshToken) return;
        account.credentials = undefined;
        account.models = [];
        account.modelsFetchedAt = undefined;
        account.selectedModel = undefined;
        await saveEpochBoundSecureStoreValue(STORAGE_KEY, saved, lease);
      });
      throw new ChatGptConnectionError("Your ChatGPT session expired. Sign in again in Tarv1s settings.");
    }
    if (nativeErrorCode(error) === "ERR_CHATGPT_AUTH" || nativeErrorCode(error) === "ERR_CHATGPT_RESTRICTED") {
      throw new ChatGptConnectionError("Your ChatGPT account needs attention. Check your connection and plan access in Tarv1s settings.");
    }
    throw new ChatGptConnectionError("Could not renew ChatGPT right now. Your connection is saved; try again later.", false);
  }
}

export async function getChatGptRequestSession(lease: LocalDataWriteLease): Promise<{
  accessToken: string;
  accountId: string;
  model: string;
}> {
  return withRefreshLock(async () => {
    const intent = connectionIntent;
    const saved = await loadSaved(lease);
    const account = saved?.accounts.find((item) => item.id === saved.activeAccountId);
    if (!saved || !account?.credentials || !hasDirectScope(account.credentials)) {
      throw new ChatGptConnectionError("Connect an eligible ChatGPT account in Tarv1s settings.");
    }
    if (!account.selectedModel || !account.models.some((model) => model.slug === account.selectedModel)) {
      throw new ChatGptModelUnavailableError();
    }
    const original = account.credentials;
    const selectedModel = account.selectedModel;
    const refreshed = await refreshIfNeeded(original, lease);
    try {
      return await withStateWriteLock(async () => {
        assertIntentCurrent(intent);
        const current = await loadSaved(lease);
        const active = current?.accounts.find((item) => item.id === current.activeAccountId);
        if (!current || !active?.credentials || active.id !== account.id
          || active.selectedModel !== selectedModel
          || active.credentials.refreshToken !== original.refreshToken) {
          throw new TarvisConnectionSupersededError();
        }
        if (refreshed !== original) {
          active.credentials = refreshed;
          await saveEpochBoundSecureStoreValue(STORAGE_KEY, current, lease);
        }
        await assertLocalDataWriteLeaseCurrent(lease);
        assertIntentCurrent(intent);
        if (!hasDirectScope(refreshed)) {
          throw new ChatGptConnectionError("ChatGPT plan use is not enabled for this account. Sign in again in Tarv1s settings.");
        }
        return { accessToken: refreshed.accessToken, accountId: active.id, model: selectedModel };
      });
    } catch (error) {
      if (refreshed !== original && connectionIntent !== intent) bestEffortRevoke(refreshed);
      throw error;
    }
  });
}

export async function signOutChatGpt(lease: LocalDataWriteLease): Promise<{ revoked: boolean }> {
  ++connectionIntent;
  void cancelPendingSignIn();
  return runTarvisConnectionMutation(() => withStateWriteLock(async () => {
    const saved = await loadSaved(lease);
    const account = saved?.accounts.find((item) => item.id === saved.activeAccountId);
    if (!saved || !account) return { revoked: true };
    let revoked = !account.credentials;
    if (account.credentials) {
      try {
        const native = await getNative();
        revoked = await native.revokeSession(account.credentials);
      } catch {
        revoked = false;
      }
      await assertLocalDataWriteLeaseCurrent(lease);
    }
    account.credentials = undefined;
    account.models = [];
    account.modelsFetchedAt = undefined;
    account.selectedModel = undefined;
    saved.activeAccountId = undefined;
    await saveEpochBoundSecureStoreValue(STORAGE_KEY, saved, lease);
    return { revoked };
  }));
}

export async function clearChatGptStoredData(): Promise<void> {
  ++connectionIntent;
  void cancelPendingSignIn();
  // Caller owns runTarvisConnectionMutation; nesting it would deadlock its queue.
  await withStateWriteLock(async () => {
    await forceClearEpochBoundSecureStoreValue(STORAGE_KEY);
  });
}
