import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { Component, ErrorInfo, Fragment, PropsWithChildren } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  APP_RECOVERY_COPY,
  AppRecoveryState,
  initialAppRecoveryState,
  markAppRecoveryNeeded,
  reloadAppInterface,
} from "@/domain/appRecovery";
import { useAppTheme } from "@/theme/theme";

type AppErrorBoundaryProps = PropsWithChildren;

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppRecoveryState
> {
  state = initialAppRecoveryState();

  static getDerivedStateFromError(): Partial<AppRecoveryState> {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    // Privacy by design: do not emit the error, stack, or component tree to an
    // external service. React Native may still show local development tooling.
    this.setState((state) => markAppRecoveryNeeded(state));
  }

  private reload = () => {
    this.setState((state) => reloadAppInterface(state));
  };

  render() {
    if (this.state.hasError) {
      return <AppRecoveryScreen onReload={this.reload} />;
    }

    return (
      <Fragment key={this.state.reloadKey}>{this.props.children}</Fragment>
    );
  }
}

function AppRecoveryScreen({ onReload }: { onReload(): void }) {
  const { colors, dark, radius, spacing } = useAppTheme();

  return (
    <LinearGradient
      colors={[colors.backgroundGlow, colors.background, colors.background]}
      locations={[0, 0.44, 1]}
      style={styles.fill}
    >
      <StatusBar style={dark ? "light" : "dark"} />
      <SafeAreaView style={styles.fill}>
        <ScrollView
          alwaysBounceVertical={false}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brandRow}>
            <View
              accessibilityElementsHidden
              style={[
                styles.brandMark,
                {
                  backgroundColor: colors.primary,
                  borderColor: colors.primaryStrong,
                },
              ]}
            >
              <View
                style={[
                  styles.brandPulse,
                  { backgroundColor: colors.onPrimary },
                ]}
              />
            </View>
            <Text style={[styles.brand, { color: colors.text }]}>T1 ARC</Text>
          </View>

          <View
            accessibilityLiveRegion="assertive"
            accessibilityRole="alert"
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: colors.surfaceBorder,
                borderRadius: radius.xl,
                shadowColor: colors.surfaceShadow,
              },
            ]}
          >
            <View
              accessibilityElementsHidden
              style={[
                styles.iconHalo,
                { backgroundColor: colors.surfaceMuted },
              ]}
            >
              <Ionicons
                name="refresh-circle-outline"
                size={34}
                color={colors.primary}
              />
            </View>

            <Text style={[styles.eyebrow, { color: colors.primaryStrong }]}>
              {APP_RECOVERY_COPY.eyebrow}
            </Text>
            <Text style={[styles.title, { color: colors.text }]}>
              {APP_RECOVERY_COPY.title}
            </Text>
            <Text style={[styles.detail, { color: colors.textSecondary }]}>
              {APP_RECOVERY_COPY.detail}
            </Text>

            <View
              style={[
                styles.privacyCard,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderColor: colors.border,
                  borderRadius: radius.lg,
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                name="shield-checkmark-outline"
                size={22}
                color={colors.accent}
              />
              <View style={styles.privacyCopy}>
                <Text style={[styles.privacyTitle, { color: colors.text }]}>
                  {APP_RECOVERY_COPY.privacyTitle}
                </Text>
                <Text
                  style={[
                    styles.privacyDetail,
                    { color: colors.textSecondary },
                  ]}
                >
                  {APP_RECOVERY_COPY.privacyDetail}
                </Text>
              </View>
            </View>

            <Pressable
              accessibilityHint="Reloads the app interface without changing saved personal data"
              accessibilityLabel={APP_RECOVERY_COPY.action}
              accessibilityRole="button"
              onPress={onReload}
              style={({ pressed }) => [
                styles.reloadButton,
                {
                  backgroundColor: colors.primary,
                  borderRadius: radius.pill,
                  marginTop: spacing.lg,
                  opacity: pressed ? 0.82 : 1,
                  transform: [{ scale: pressed ? 0.99 : 1 }],
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                name="refresh-outline"
                size={20}
                color={colors.onPrimary}
              />
              <Text style={[styles.reloadLabel, { color: colors.onPrimary }]}>
                {APP_RECOVERY_COPY.action}
              </Text>
            </Pressable>

            <Text style={[styles.note, { color: colors.textTertiary }]}>
              If the problem remains, this screen will return instead of hiding
              the issue.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 28,
  },
  brandRow: {
    alignItems: "center",
    alignSelf: "center",
    flexDirection: "row",
    gap: 9,
    marginBottom: 20,
  },
  brandMark: {
    alignItems: "center",
    borderRadius: 11,
    borderWidth: 1,
    height: 26,
    justifyContent: "center",
    transform: [{ rotate: "-8deg" }],
    width: 26,
  },
  brandPulse: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  brand: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 2.2,
  },
  card: {
    alignSelf: "center",
    borderWidth: 1,
    elevation: 6,
    maxWidth: 520,
    padding: 24,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    width: "100%",
  },
  iconHalo: {
    alignItems: "center",
    borderRadius: 28,
    height: 56,
    justifyContent: "center",
    marginBottom: 22,
    width: 56,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.5,
    marginBottom: 9,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.5,
    lineHeight: 34,
  },
  detail: {
    fontSize: 16,
    lineHeight: 24,
    marginTop: 10,
  },
  privacyCard: {
    alignItems: "flex-start",
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    marginTop: 22,
    padding: 16,
  },
  privacyCopy: {
    flex: 1,
  },
  privacyTitle: {
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
  },
  privacyDetail: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  reloadButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  reloadLabel: {
    fontSize: 16,
    fontWeight: "800",
  },
  note: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 13,
    textAlign: "center",
  },
});
