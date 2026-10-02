import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelChatGptSignIn,
  clearChatGptStoredData,
  discardPendingChatGptRegistration,
  getChatGptRequestSession,
  getChatGptState,
  hasChatGptStoredData,
  refreshChatGptModels,
  selectChatGptAccount,
  selectChatGptModel,
  signInChatGpt,
  signOutChatGpt,
} from "@/data/tarvis/chatGptConnection";
import { resetTarvisConnectionCoordinatorForTests } from "@/data/tarvis/connectionCoordinator";

const lease = { epoch: 7 };
const testState = vi.hoisted(() => ({
  epoch: 7,
  values: new Map<string, unknown>(),
  signIn: vi.fn(),
  complete: vi.fn(),
  refresh: vi.fn(),
  revoke: vi.fn(),
  cancel: vi.fn(),
  listModels: vi.fn(),
}));

vi.mock("expo-crypto", () => ({ randomUUID: () => "12345678-1234-4234-8234-123456789abc" }));
vi.mock("@/data/privacy/localDataWriteEpoch", () => ({
  acquireLocalDataWriteLease: async () => ({ epoch: testState.epoch }),
  assertLocalDataWriteLeaseCurrent: async (writeLease: { epoch: number }) => {
    if (writeLease.epoch !== testState.epoch) throw new Error("privacy erase superseded write");
  },
}));
vi.mock("@/data/privacy/localDataEpochSecureStore", () => ({
  loadEpochBoundSecureStoreValue: async (_key: string, writeLease: { epoch: number }, parse: (value: unknown) => unknown) => {
    if (writeLease.epoch !== testState.epoch) throw new Error("privacy erase superseded write");
    return parse(structuredClone(testState.values.get(_key)));
  },
  saveEpochBoundSecureStoreValue: async (key: string, value: unknown, writeLease: { epoch: number }) => {
    if (writeLease.epoch !== testState.epoch) throw new Error("privacy erase superseded write");
    testState.values.set(key, structuredClone(value));
  },
  forceClearEpochBoundSecureStoreValue: async (key: string) => { testState.values.delete(key); },
}));
vi.mock("../modules/t1arc-chatgpt", () => ({
  isAvailable: () => true,
  default: {
    signIn: testState.signIn,
    completeSignIn: testState.complete,
    refreshSession: testState.refresh,
    revokeSession: testState.revoke,
    cancelSignIn: testState.cancel,
    listModels: testState.listModels,
  },
}));

function credentials(clientId = "oaiapp_one", subject = "subject-one", email = "same@example.com", overrides = {}) {
  return {
    clientId,
    subject,
    email,
    accessToken: `access-${subject}`,
    refreshToken: `refresh-${subject}`,
    idToken: `id-${subject}`,
    expiresAt: Date.now() + 3_600_000,
    scopes: ["openid", "chatgpt.tokens.use.direct"],
    ...overrides,
  };
}

function catalog(...slugs: string[]) {
  return JSON.stringify({ models: slugs.map((slug) => ({ slug, display_name: slug.toUpperCase(), visibility: "list" })) });
}

function callback(clientId = "oaiapp_one") {
  return { transactionId: `transaction-${clientId}`, clientId };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe("ChatGPT account connection", () => {
  beforeEach(() => {
    resetTarvisConnectionCoordinatorForTests();
    testState.epoch = 7;
    testState.values.clear();
    vi.clearAllMocks();
    testState.signIn.mockResolvedValue(callback());
    testState.complete.mockResolvedValue(credentials());
    testState.refresh.mockImplementation(async (input) => input);
    testState.revoke.mockResolvedValue(true);
    testState.cancel.mockResolvedValue(undefined);
    testState.listModels.mockResolvedValue(catalog("gpt-first", "gpt-second"));
  });

  it("keeps a stable host ID, displays only listed models in server order, and requires explicit model choice", async () => {
    testState.listModels.mockResolvedValue(JSON.stringify({ models: [
      { slug: "hidden", display_name: "Hidden", visibility: "hidden" },
      { slug: "gpt-first", display_name: "First", visibility: "list" },
      { slug: "gpt-second", display_name: "Second", visibility: "list" },
    ] }));
    const first = await signInChatGpt(lease);
    expect(testState.signIn).toHaveBeenCalledWith(expect.objectContaining({ hostId: "urn:uuid:12345678-1234-4234-8234-123456789abc", requestConsent: false }));
    expect(first.connected).toBe(true);
    expect(first.models.map((model) => model.slug)).toEqual(["gpt-first", "gpt-second"]);
    expect(first.selectedModel).toBeUndefined();
    await expect(getChatGptRequestSession(lease)).rejects.toMatchObject({ name: "ChatGptModelUnavailableError" });

    await selectChatGptModel("gpt-second", lease);
    expect(await getChatGptRequestSession(lease)).toMatchObject({ model: "gpt-second", accessToken: "access-subject-one" });
    const state = await getChatGptState(lease);
    expect(JSON.stringify(state)).not.toContain("access-subject-one");
    expect(JSON.stringify(state)).not.toContain("refresh-subject-one");
    expect(await hasChatGptStoredData(lease)).toBe(true);
  });

  it("keeps registrations with matching email separate and validates returning identity", async () => {
    const first = await signInChatGpt(lease);
    testState.signIn.mockResolvedValueOnce(callback("oaiapp_two"));
    testState.complete.mockResolvedValueOnce(credentials("oaiapp_two", "subject-two"));
    const second = await signInChatGpt(lease);
    expect(second.accounts).toHaveLength(2);
    expect(second.accounts[0]?.label).not.toBe(second.accounts[1]?.label);
    await selectChatGptAccount(first.activeAccountId!, lease);
    expect(testState.listModels).toHaveBeenLastCalledWith("access-subject-one");
    testState.complete.mockResolvedValueOnce(credentials("oaiapp_one", "wrong-subject"));
    await expect(signInChatGpt(lease, first.activeAccountId)).rejects.toThrow("unexpected account");
    expect((await getChatGptState(lease)).accounts).toHaveLength(2);
    expect(testState.signIn).toHaveBeenLastCalledWith(expect.objectContaining({
      clientId: "oaiapp_one", expectedSubject: "subject-one",
      hostId: "urn:uuid:12345678-1234-4234-8234-123456789abc",
    }));
  });

  it("persists an issued client ID before code exchange and reuses it after invalid_grant", async () => {
    testState.complete.mockImplementationOnce(async () => {
      const raw = JSON.stringify([...testState.values.values()]);
      expect(raw).toContain('"pendingClientId":"oaiapp_one"');
      throw new Error("invalid_grant: secret-token-must-not-escape");
    });
    await expect(signInChatGpt(lease)).rejects.toThrow("ChatGPT sign-in did not finish");
    expect((await getChatGptState(lease)).hasPendingRegistration).toBe(true);
    expect((await getChatGptState(lease)).accounts).toHaveLength(0);
    await signInChatGpt(lease);
    expect(testState.signIn).toHaveBeenLastCalledWith(expect.objectContaining({
      clientId: "oaiapp_one", expectedSubject: undefined, requestConsent: false,
    }));
    expect((await getChatGptState(lease)).hasPendingRegistration).toBe(false);
  });

  it("can explicitly discard only an incomplete registration before starting a new one", async () => {
    testState.complete.mockRejectedValueOnce(new Error("invalid_grant"));
    await expect(signInChatGpt(lease)).rejects.toThrow();
    expect((await getChatGptState(lease)).hasPendingRegistration).toBe(true);
    await discardPendingChatGptRegistration(lease);
    expect((await getChatGptState(lease)).hasPendingRegistration).toBe(false);
    await signInChatGpt(lease);
    expect(testState.signIn).toHaveBeenLastCalledWith(expect.objectContaining({ clientId: undefined }));
  });

  it("discarding an incomplete second registration keeps the connected first account", async () => {
    const first = await signInChatGpt(lease);
    testState.signIn.mockResolvedValueOnce(callback("oaiapp_two"));
    testState.complete.mockRejectedValueOnce(new Error("invalid_grant"));
    await expect(signInChatGpt(lease)).rejects.toThrow();
    expect((await getChatGptState(lease)).hasPendingRegistration).toBe(true);
    await discardPendingChatGptRegistration(lease);
    const after = await getChatGptState(lease);
    expect(after.hasPendingRegistration).toBe(false);
    expect(after.activeAccountId).toBe(first.activeAccountId);
    expect(after.connected).toBe(true);
    expect(after.accounts).toHaveLength(1);
  });

  it("does not enable plan usage when the direct scope is missing", async () => {
    testState.complete.mockResolvedValueOnce(credentials("oaiapp_one", "subject-one", "same@example.com", { scopes: ["openid"] }));
    const state = await signInChatGpt(lease);
    expect(state.connected).toBe(false);
    expect(testState.listModels).not.toHaveBeenCalled();
    await expect(getChatGptRequestSession(lease)).rejects.toThrow("eligible ChatGPT account");
    await signInChatGpt(lease, state.activeAccountId);
    expect(testState.signIn).toHaveBeenLastCalledWith(expect.objectContaining({ requestConsent: true }));
  });

  it("selects an inactive disabled session for reauthorization or sign-out without touching another account", async () => {
    const first = await signInChatGpt(lease);
    testState.signIn.mockResolvedValueOnce(callback("oaiapp_two"));
    testState.complete.mockResolvedValueOnce(credentials("oaiapp_two", "subject-two", "same@example.com", { scopes: ["openid"] }));
    const second = await signInChatGpt(lease);
    expect(second.connected).toBe(false);
    expect(second.accounts.find((account) => account.id === second.activeAccountId)?.hasSession).toBe(true);
    await selectChatGptAccount(first.activeAccountId!, lease);
    const disabled = await selectChatGptAccount(second.activeAccountId!, lease);
    expect(disabled.activeAccountId).toBe(second.activeAccountId);
    expect(disabled.connected).toBe(false);
    expect(disabled.models).toEqual([]);
    await signOutChatGpt(lease);
    const after = await getChatGptState(lease);
    expect(after.accounts.find((account) => account.id === first.activeAccountId)?.hasSession).toBe(true);
    expect(after.accounts.find((account) => account.id === second.activeAccountId)?.hasSession).toBe(false);
  });

  it("never silently substitutes a model removed from the account catalog", async () => {
    await signInChatGpt(lease);
    await selectChatGptModel("gpt-second", lease);
    testState.listModels.mockResolvedValueOnce(catalog("gpt-first"));
    const state = await selectChatGptAccount((await getChatGptState(lease)).activeAccountId!, lease);
    expect(state.selectedModel).toBe("gpt-second");
    await expect(getChatGptRequestSession(lease)).rejects.toMatchObject({ name: "ChatGptModelUnavailableError" });
  });

  it("clears tokens after failed revocation while retaining the client mapping", async () => {
    const before = await signInChatGpt(lease);
    testState.revoke.mockRejectedValueOnce(new Error("Bearer secret leaked by remote"));
    expect(await signOutChatGpt(lease)).toEqual({ revoked: false });
    const after = await getChatGptState(lease);
    expect(after.connected).toBe(false);
    expect(after.accounts).toHaveLength(1);
    expect(after.accounts[0]?.connected).toBe(false);
    expect(after.activeAccountId).toBeUndefined();
    expect(JSON.stringify([...testState.values.values()])).not.toContain("access-subject-one");
    expect(JSON.stringify([...testState.values.values()])).not.toContain("refresh-subject-one");
    expect(before.accounts[0]?.id).toBe(after.accounts[0]?.id);
  });

  it("lets sign-out finish while browser authorization is still pending and rejects its late result", async () => {
    const gate = deferred<ReturnType<typeof callback>>();
    testState.signIn.mockReturnValueOnce(gate.promise);
    const attempt = signInChatGpt(lease);
    await vi.waitFor(() => expect(testState.signIn).toHaveBeenCalledTimes(1));
    await expect(signOutChatGpt(lease)).resolves.toEqual({ revoked: true });
    gate.resolve(callback());
    await expect(attempt).rejects.toMatchObject({ name: "TarvisConnectionSupersededError" });
    expect((await getChatGptState(lease)).connected).toBe(false);
  });

  it("cancels browser authorization without disconnecting the existing account", async () => {
    const initial = await signInChatGpt(lease);
    const gate = deferred<ReturnType<typeof callback>>();
    testState.signIn.mockReturnValueOnce(gate.promise);
    const attempt = signInChatGpt(lease);
    await vi.waitFor(() => expect(testState.signIn).toHaveBeenCalledTimes(2));
    await cancelChatGptSignIn();
    gate.resolve(callback("oaiapp_two"));
    await expect(attempt).rejects.toMatchObject({ name: "TarvisConnectionSupersededError" });
    const state = await getChatGptState(lease);
    expect(state.activeAccountId).toBe(initial.activeAccountId);
    expect(state.connected).toBe(true);
    expect(testState.cancel).toHaveBeenCalled();
  });

  it("serializes a rotating refresh with sign-out so credentials cannot reappear", async () => {
    testState.complete.mockResolvedValueOnce(credentials("oaiapp_one", "subject-one", "same@example.com", { expiresAt: Date.now() - 1 }));
    await signInChatGpt(lease);
    await selectChatGptModel("gpt-first", lease);
    const gate = deferred<ReturnType<typeof credentials>>();
    testState.refresh.mockReturnValueOnce(gate.promise);
    const request = getChatGptRequestSession(lease);
    await vi.waitFor(() => expect(testState.refresh).toHaveBeenCalledTimes(1));
    const logout = signOutChatGpt(lease);
    await expect(logout).resolves.toEqual({ revoked: true });
    gate.resolve(credentials("oaiapp_one", "subject-one", "same@example.com", { accessToken: "rotated-secret" }));
    await expect(request).rejects.toMatchObject({ name: "TarvisConnectionSupersededError" });
    await vi.waitFor(() => expect(testState.revoke).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "rotated-secret" })));
    expect(JSON.stringify([...testState.values.values()])).not.toContain("rotated-secret");
    await expect(getChatGptRequestSession(lease)).rejects.toThrow("eligible ChatGPT account");
  });

  it("persists a rotated token when renewal removes plan permission", async () => {
    testState.complete.mockResolvedValueOnce(credentials("oaiapp_one", "subject-one", "same@example.com", { expiresAt: Date.now() - 1 }));
    await signInChatGpt(lease);
    await selectChatGptModel("gpt-first", lease);
    testState.refresh.mockResolvedValueOnce(credentials("oaiapp_one", "subject-one", "same@example.com", {
      refreshToken: "rotated-disabled-token", scopes: ["openid"],
    }));
    await expect(getChatGptRequestSession(lease)).rejects.toThrow("plan use is not enabled");
    const state = await getChatGptState(lease);
    expect(state.connected).toBe(false);
    expect(state.accounts[0]?.hasSession).toBe(true);
    expect(JSON.stringify([...testState.values.values()])).toContain("rotated-disabled-token");
  });

  it("keeps credentials for transient renewal failures and clears them after terminal invalid_grant", async () => {
    testState.complete.mockResolvedValueOnce(credentials("oaiapp_one", "subject-one", "same@example.com", { expiresAt: Date.now() - 1 }));
    await signInChatGpt(lease);
    await selectChatGptModel("gpt-first", lease);
    testState.refresh.mockRejectedValueOnce({ code: "ERR_CHATGPT_UNAVAILABLE", message: "secret remote detail" });
    await expect(getChatGptRequestSession(lease)).rejects.toThrow("connection is saved; try again later");
    expect((await getChatGptState(lease)).accounts[0]?.hasSession).toBe(true);
    testState.refresh.mockRejectedValueOnce({ code: "ERR_CHATGPT_INVALID_GRANT", message: "secret remote detail" });
    await expect(getChatGptRequestSession(lease)).rejects.toThrow("session expired");
    const state = await getChatGptState(lease);
    expect(state.accounts).toHaveLength(1);
    expect(state.accounts[0]?.hasSession).toBe(false);
    expect(JSON.stringify([...testState.values.values()])).not.toContain("refresh-subject-one");
  });

  it("retains a rotated refresh token when a subsequent model catalog call fails", async () => {
    testState.complete.mockResolvedValueOnce(credentials("oaiapp_one", "subject-one", "same@example.com", { expiresAt: Date.now() - 1 }));
    const initial = await signInChatGpt(lease);
    testState.refresh.mockResolvedValueOnce(credentials("oaiapp_one", "subject-one", "same@example.com", {
      refreshToken: "rotated-refresh-token", accessToken: "rotated-access-token",
    }));
    testState.listModels.mockRejectedValueOnce(new Error("Authorization Bearer rotated-access-token"));
    await expect(selectChatGptAccount(initial.activeAccountId!, lease)).rejects.toThrow("Could not load models");
    const saved = JSON.stringify([...testState.values.values()]);
    expect(saved).toContain("rotated-refresh-token");
    expect(saved).not.toContain("refresh-subject-one");
    expect(saved).not.toContain("Authorization Bearer");

    testState.listModels.mockRejectedValueOnce(new Error("remote secret"));
    await expect(refreshChatGptModels(lease)).rejects.toThrow("Could not load models");
    expect(JSON.stringify([...testState.values.values()])).toContain("rotated-refresh-token");
  });

  it("lets sign-out finish while account-switch model discovery is hung", async () => {
    const initial = await signInChatGpt(lease);
    const gate = deferred<string>();
    testState.listModels.mockReturnValueOnce(gate.promise);
    const switching = selectChatGptAccount(initial.activeAccountId!, lease);
    await vi.waitFor(() => expect(testState.listModels).toHaveBeenCalledTimes(2));
    await expect(signOutChatGpt(lease)).resolves.toEqual({ revoked: true });
    gate.resolve(catalog("gpt-first"));
    await expect(switching).rejects.toMatchObject({ name: "TarvisConnectionSupersededError" });
    expect((await getChatGptState(lease)).connected).toBe(false);
  });

  it("lets privacy erase finish while a model catalog refresh is hung", async () => {
    await signInChatGpt(lease);
    const gate = deferred<string>();
    testState.listModels.mockReturnValueOnce(gate.promise);
    const refreshing = refreshChatGptModels(lease);
    await vi.waitFor(() => expect(testState.listModels).toHaveBeenCalledTimes(2));
    await clearChatGptStoredData();
    expect(testState.values.size).toBe(0);
    gate.resolve(catalog("gpt-first"));
    await expect(refreshing).rejects.toMatchObject({ name: "TarvisConnectionSupersededError" });
    expect(testState.values.size).toBe(0);
  });

  it("prevents a late OAuth result from being stored after privacy erase", async () => {
    const gate = deferred<ReturnType<typeof callback>>();
    testState.signIn.mockReturnValueOnce(gate.promise);
    const attempt = signInChatGpt(lease);
    await vi.waitFor(() => expect(testState.signIn).toHaveBeenCalledTimes(1));
    testState.epoch = 8;
    testState.values.clear();
    gate.resolve(callback());
    await expect(attempt).rejects.toThrow("privacy erase superseded write");
    expect(testState.values.size).toBe(0);
    await clearChatGptStoredData();
  });
});
