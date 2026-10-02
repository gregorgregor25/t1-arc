import Ionicons from "@expo/vector-icons/Ionicons";
import { ActivityIndicator, Linking, Pressable, Text, View } from "react-native";
import type { ChatGptConnectionState } from "@/data/tarvis/chatGptConnection";
import { useAppTheme } from "@/theme/theme";

const USAGE_URL = "https://chatgpt.com/settings/usage";

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
  onRefreshModels(): void;
  onUse(): void;
  onSignOut(): void;
  onLinkError(): void;
}

export function ChatGptConnectionCard({
  state, active, working, signingIn, notice, onSignIn, onStartFreshSignIn, onCancelSignIn, onSelectAccount, onSelectModel,
  onRefreshModels, onUse, onSignOut, onLinkError,
}: Props) {
  const { colors, radius } = useAppTheme();
  const account = state.accounts.find((item) => item.id === state.activeAccountId);
  const selectedModel = state.models.find((item) => item.slug === state.selectedModel);
  const disabled = working || !state.available;
  const option = (title: string, onPress: () => void, selected = false, subtitle?: string) => (
    <Pressable
      key={title}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1,
        borderColor: selected ? colors.primary : colors.border,
        borderRadius: radius.md,
        backgroundColor: selected ? `${colors.primary}10` : colors.surfaceMuted,
        opacity: pressed ? 0.72 : 1,
      })}
    >
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: selected ? "700" : "500" }}>{title}</Text>
      {subtitle ? <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>{subtitle}</Text> : null}
    </Pressable>
  );
  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Ionicons name="chatbubble-ellipses-outline" size={21} color={colors.primary} />
        <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 17, fontWeight: "800" }}>
          ChatGPT plan
        </Text>
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19 }}>
        Connect an eligible ChatGPT Plus or Pro plan for Tarv1s answers. Your ChatGPT plan usage is managed in ChatGPT. This connection cannot read your existing ChatGPT chats. Your selected evidence and recent shared conversation are sent only when you tap Send.
      </Text>
      {!state.available ? (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19 }}>
          ChatGPT sign-in is unavailable in this app build. API key options above remain available.
        </Text>
      ) : null}
      {state.hasPendingRegistration ? (
        <View style={{ padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, gap: 8 }}>
          <Text accessibilityLiveRegion="polite" style={{ color: colors.text, fontSize: 13, lineHeight: 19 }}>
            A previous sign-in has not finished. Continue with ChatGPT to retry it.
          </Text>
          <Pressable accessibilityRole="button" disabled={disabled} onPress={onStartFreshSignIn} style={{ paddingVertical: 7, alignSelf: "flex-start" }}>
            <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "700" }}>Start a new sign-in</Text>
          </Pressable>
        </View>
      ) : null}
      {state.accounts.length ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: "700" }}>Account</Text>
          <View accessibilityRole="radiogroup" style={{ gap: 7 }}>
            {state.accounts.map((item) => option(item.label, () => item.hasSession ? onSelectAccount(item.id) : onSignIn(item.id), item.id === state.activeAccountId, item.connected ? "Connected" : item.hasSession ? "Signed in · plan access disabled" : "Tap to reconnect"))}
          </View>
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
        {working ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="log-in-outline" size={19} color={colors.primary} />}
        <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 14 }}>
          Continue with ChatGPT
        </Text>
      </Pressable>
      {signingIn ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel ChatGPT sign-in"
          onPress={onCancelSignIn}
          style={({ pressed }) => ({
            minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.md,
            borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: "700" }}>Cancel sign-in</Text>
        </Pressable>
      ) : null}
      {account && !state.hasPendingRegistration ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Reconnect the selected account, or add another account below.</Text>
          <Pressable accessibilityRole="button" disabled={disabled} onPress={() => onSignIn()} style={{ paddingVertical: 10 }}>
            <Text style={{ color: colors.primary, fontSize: 13 }}>Add another ChatGPT account</Text>
          </Pressable>
        </View>
      ) : null}
      {account && !state.connected ? (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19 }}>
          This account is signed in, but ChatGPT plan access has not been granted. Check your plan and connected-app permissions in ChatGPT settings, or choose another connection.
        </Text>
      ) : null}
      {account?.connected ? (
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: "700" }}>Model</Text>
            <Pressable accessibilityRole="button" disabled={disabled} onPress={onRefreshModels} style={{ padding: 6 }}>
              <Text style={{ color: colors.primary, fontSize: 12 }}>Refresh list</Text>
            </Pressable>
          </View>
          {state.models.length ? (
            <View accessibilityRole="radiogroup" style={{ gap: 7 }}>
              {state.models.map((model) => option(model.displayName, () => onSelectModel(model.slug), model.slug === state.selectedModel, model.slug))}
            </View>
          ) : (
            <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary, fontSize: 13 }}>
              No models are available for this account yet. Refresh the list or reconnect.
            </Text>
          )}
          {state.selectedModel && !selectedModel ? (
            <Text accessibilityLiveRegion="polite" style={{ color: colors.danger, fontSize: 12 }}>
              Your saved model is no longer available. Choose another model before sending.
            </Text>
          ) : null}
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
            <Ionicons name="checkmark-circle-outline" size={19} color={selectedModel ? colors.onPrimary : colors.textTertiary} />
            <Text style={{ color: selectedModel ? colors.onPrimary : colors.textTertiary, fontWeight: "800", fontSize: 14 }}>
              {active ? "ChatGPT is active" : "Use ChatGPT for AI answers"}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {account ? (
        <Pressable accessibilityRole="button" disabled={working} onPress={onSignOut} style={{ paddingVertical: 12, alignSelf: "flex-start" }}>
          <Text style={{ color: colors.danger, fontSize: 13, fontWeight: "700" }}>Sign out of this ChatGPT connection</Text>
        </Pressable>
      ) : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={{ color: colors.text, fontSize: 13 }}>{notice}</Text> : null}
      <Pressable
        accessibilityRole="link"
        onPress={() => void Linking.openURL(USAGE_URL).catch(onLinkError)}
        style={{ paddingVertical: 8, alignSelf: "flex-start" }}
      >
        <Text style={{ color: colors.primary, fontSize: 13 }}>Manage usage in ChatGPT ↗</Text>
      </Pressable>
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL("https://openai.com/policies/privacy-policy/").catch(onLinkError)} style={{ paddingVertical: 8, alignSelf: "flex-start" }}>
        <Text style={{ color: colors.primary, fontSize: 13 }}>OpenAI privacy terms ↗</Text>
      </Pressable>
    </View>
  );
}
