import Ionicons from "@expo/vector-icons/Ionicons";
import { useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from "react-native";

import type { ChatGptConnectionState } from "@/data/tarvis/chatGptConnection";
import { useAppTheme } from "@/theme/theme";

const USAGE_URL = "https://chatgpt.com/settings/usage";
const PRIVACY_URL = "https://openai.com/policies/privacy-policy/";

interface Props {
  state: ChatGptConnectionState;
  active: boolean;
  working: boolean;
  signingIn: boolean;
  notice?: string;
  onSignIn(accountId?: string): void;
  onStartFreshSignIn(): void;
  onCancelSignIn(): void;
  onSelectAccount(accountId: string): void;
  onSelectModel(slug: string): void;
  onRefreshModels(): Promise<void>;
  onRefreshModelsIfStale(): Promise<void>;
  onUse(): void;
  onSignOut(): void;
  onLinkError(): void;
}

export function ChatGptConnectionCard({
  state, active, working, signingIn, notice, onSignIn, onStartFreshSignIn,
  onCancelSignIn, onSelectAccount, onSelectModel, onRefreshModels,
  onRefreshModelsIfStale, onUse, onSignOut, onLinkError,
}: Props) {
  const { colors, radius } = useAppTheme();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const refreshInFlight = useRef(false);
  const account = state.accounts.find((item) => item.id === state.activeAccountId);
  const selectedModel = state.models.find((item) => item.slug === state.selectedModel);
  const disabled = working || !state.available;

  async function refreshModels(ifStale: boolean) {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshingModels(true);
    try {
      if (ifStale) await onRefreshModelsIfStale();
      else await onRefreshModels();
    } finally {
      refreshInFlight.current = false;
      setRefreshingModels(false);
    }
  }

  function openModelMenu() {
    const opening = !modelMenuOpen;
    setModelMenuOpen(opening);
    if (opening && account?.id) {
      void refreshModels(true).catch(() => undefined);
    }
  }

  const selectStyle = {
    minHeight: 50,
    paddingHorizontal: 13,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 9,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated,
  };

  return (
    <View style={{ gap: 14 }}>
      <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19 }}>
        Use an eligible ChatGPT Plus or Pro plan. This connection cannot read your existing ChatGPT chats. Your question and selected context go to OpenAI only when you tap Send.
      </Text>
      {!state.available ? (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19 }}>
          ChatGPT sign-in is unavailable in this app build. API key options remain available.
        </Text>
      ) : null}
      {state.hasPendingRegistration ? (
        <View style={{ padding: 13, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceElevated, gap: 7 }}>
          <Text accessibilityLiveRegion="polite" style={{ color: colors.text, fontSize: 13, lineHeight: 19 }}>
            A previous sign-in has not finished. Continue with ChatGPT to retry it.
          </Text>
          <Pressable accessibilityRole="button" disabled={disabled} onPress={onStartFreshSignIn} style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}>
            <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "700" }}>Start a new sign-in</Text>
          </Pressable>
        </View>
      ) : null}
      {state.accounts.length ? (
        <View style={{ gap: 7 }}>
          <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 }}>ACCOUNT</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose ChatGPT account"
            accessibilityValue={{ text: account?.label ?? "No account selected" }}
            accessibilityState={{ expanded: accountMenuOpen, disabled }}
            disabled={disabled}
            onPress={() => setAccountMenuOpen((open) => !open)}
            style={({ pressed }) => [selectStyle, { opacity: pressed ? 0.72 : 1 }]}
          >
            <Ionicons accessibilityElementsHidden name="person-circle-outline" size={20} color={colors.textSecondary} />
            <Text style={{ flex: 1, color: colors.text, fontSize: 13, fontWeight: "700" }} numberOfLines={1}>{account?.label ?? "Choose an account"}</Text>
            <Ionicons accessibilityElementsHidden name={accountMenuOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
          </Pressable>
          {accountMenuOpen ? (
            <ScrollView nestedScrollEnabled style={{ maxHeight: 210, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceElevated }}>
              <View accessibilityRole="radiogroup">
                {state.accounts.map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: item.id === state.activeAccountId, disabled }}
                    disabled={disabled}
                    onPress={() => {
                      setAccountMenuOpen(false);
                      setModelMenuOpen(false);
                      if (item.hasSession) onSelectAccount(item.id);
                      else onSignIn(item.id);
                    }}
                    style={{ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 12, paddingVertical: 8 }}
                  >
                    <Text style={{ flex: 1, color: colors.text, fontSize: 13 }} numberOfLines={2}>{item.label}{item.connected ? " · Connected" : item.hasSession ? " · Plan access unavailable" : " · Reconnect"}</Text>
                    {item.id === state.activeAccountId ? <Ionicons accessibilityElementsHidden name="checkmark" size={18} color={colors.primary} /> : null}
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          ) : null}
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => onSignIn(state.hasPendingRegistration ? undefined : account?.id)}
        style={({ pressed }) => ({
          minHeight: 50, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
          borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary,
          backgroundColor: colors.surfaceElevated, opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
        })}
      >
        {signingIn ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons accessibilityElementsHidden name="log-in-outline" size={19} color={colors.primary} />}
        <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 14 }}>Continue with ChatGPT</Text>
      </Pressable>
      {signingIn ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel ChatGPT sign-in" onPress={onCancelSignIn} style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: "700" }}>Cancel sign-in</Text>
        </Pressable>
      ) : null}
      {account && !state.hasPendingRegistration ? (
        <Pressable accessibilityRole="button" disabled={disabled} onPress={() => onSignIn()} style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}>
          <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "700" }}>Add another ChatGPT account</Text>
        </Pressable>
      ) : null}
      {account && !state.connected ? (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19 }}>
          This account is signed in, but ChatGPT plan access has not been granted. Check your plan and connected-app permissions, or choose another connection.
        </Text>
      ) : null}
      {account?.connected ? (
        <View style={{ gap: 9 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 }}>MODEL</Text>
            <Pressable accessibilityRole="button" disabled={disabled || refreshingModels} onPress={() => { void refreshModels(false).catch(() => undefined); }} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 5 }}>
              {refreshingModels ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons accessibilityElementsHidden name="refresh" size={15} color={colors.primary} />}
              <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "700" }}>Refresh models</Text>
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose ChatGPT model"
            accessibilityValue={{ text: selectedModel?.displayName ?? "No model selected" }}
            accessibilityState={{ expanded: modelMenuOpen, disabled }}
            disabled={disabled}
            onPress={openModelMenu}
            style={({ pressed }) => [selectStyle, { opacity: pressed ? 0.72 : 1 }]}
          >
            <Ionicons accessibilityElementsHidden name="sparkles-outline" size={18} color={colors.textSecondary} />
            <Text style={{ flex: 1, color: colors.text, fontSize: 13, fontWeight: "700" }} numberOfLines={1}>{selectedModel?.displayName ?? "Choose a model"}</Text>
            <Ionicons accessibilityElementsHidden name={modelMenuOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
          </Pressable>
          {modelMenuOpen ? (
            <ScrollView nestedScrollEnabled style={{ maxHeight: 220, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceElevated }}>
              <View accessibilityRole="radiogroup">
                {state.models.map((model) => (
                  <Pressable
                    key={model.slug}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: model.slug === state.selectedModel, disabled }}
                    disabled={disabled}
                    onPress={() => { setModelMenuOpen(false); onSelectModel(model.slug); }}
                    style={{ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 12, paddingVertical: 8 }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: "700" }} numberOfLines={1}>{model.displayName}</Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 11 }} numberOfLines={1}>{model.slug}</Text>
                    </View>
                    {model.slug === state.selectedModel ? <Ionicons accessibilityElementsHidden name="checkmark" size={18} color={colors.primary} /> : null}
                  </Pressable>
                ))}
                {!state.models.length ? <Text style={{ padding: 13, color: colors.textSecondary, fontSize: 12 }}>No models available. Refresh or reconnect.</Text> : null}
              </View>
            </ScrollView>
          ) : null}
          {state.selectedModel && !selectedModel ? (
            <Text accessibilityLiveRegion="polite" style={{ color: colors.danger, fontSize: 12 }}>Your saved model is no longer available. Choose another before sending.</Text>
          ) : null}
          {!active ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: disabled || !selectedModel }}
              disabled={disabled || !selectedModel}
              onPress={onUse}
              style={({ pressed }) => ({
                minHeight: 50, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
                borderRadius: radius.md, backgroundColor: selectedModel ? colors.primary : colors.border,
                opacity: disabled || !selectedModel ? 0.55 : pressed ? 0.72 : 1,
              })}
            >
              <Ionicons accessibilityElementsHidden name="checkmark-circle-outline" size={19} color={selectedModel ? colors.onPrimary : colors.textTertiary} />
              <Text style={{ color: selectedModel ? colors.onPrimary : colors.textTertiary, fontWeight: "800", fontSize: 14 }}>Use ChatGPT for AI answers</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={{ color: colors.text, fontSize: 12, lineHeight: 18 }}>{notice}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 16 }}>
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(USAGE_URL).catch(onLinkError)} style={{ minHeight: 44, justifyContent: "center" }}>
          <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "700" }}>Manage usage ↗</Text>
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(PRIVACY_URL).catch(onLinkError)} style={{ minHeight: 44, justifyContent: "center" }}>
          <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "700" }}>Privacy terms ↗</Text>
        </Pressable>
        {account ? (
          <Pressable accessibilityRole="button" disabled={working} onPress={onSignOut} style={{ minHeight: 44, justifyContent: "center" }}>
            <Text style={{ color: colors.danger, fontSize: 12, fontWeight: "700" }}>Sign out of this ChatGPT connection</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
