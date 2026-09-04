import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  BackHandler,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  createOnboardingWriteCoordinator,
  loadOnboardingState,
} from "@/data/onboarding/onboardingStore";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useDataContext } from "@/providers/DataProvider";
import { TourArtwork } from "@/screens/onboarding/TourArtwork";
import {
  LAST_ONBOARDING_TOUR_INDEX,
  ONBOARDING_TOUR_STEPS,
  ONBOARDING_WALKTHROUGH_VERSION,
  OnboardingFinishDestination,
  nextOnboardingTourIndex,
  onboardingDestinationDataMode,
  onboardingTourProgressLabel,
  onboardingTransitionDuration,
  previousOnboardingTourIndex,
} from "@/screens/onboarding/tourModel";
import { useAppTheme } from "@/theme/theme";

export type OnboardingMode = "first-run" | "replay";

interface Props {
  mode?: OnboardingMode;
  onComplete(destination?: OnboardingFinishDestination): void;
  onRequestClose?(): void;
}

export function OnboardingScreen(props: Props) {
  const mode = props.mode ?? "first-run";
  return <OnboardingScreenContent key={mode} {...props} mode={mode} />;
}

function OnboardingScreenContent({
  mode = "first-run",
  onComplete,
  onRequestClose,
}: Props) {
  const { colors, radius } = useAppTheme();
  const { setDataMode } = useDataContext();
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(mode === "replay");
  const [initialLoadFailed, setInitialLoadFailed] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string>();
  const finishingRef = useRef(false);
  const loadGeneration = useRef(0);
  const [writes] = useState(() => createOnboardingWriteCoordinator());
  const [transition] = useState(() => new Animated.Value(1));
  const scrollViewRef = useRef<ScrollView | null>(null);
  const step = ONBOARDING_TOUR_STEPS[index]!;
  const finalStep = index === LAST_ONBOARDING_TOUR_INDEX;
  const progressLabel = onboardingTourProgressLabel(index);

  const loadProgress = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setInitialLoadFailed(false);
    setError(undefined);
    try {
      const state = await loadOnboardingState();
      if (loadGeneration.current !== generation) return;
      if (
        state?.status === "in_progress" &&
        state.walkthroughVersion === ONBOARDING_WALKTHROUGH_VERSION
      ) {
        setIndex(state.lastStep);
      } else {
        setIndex(0);
      }
      setReady(true);
    } catch {
      if (loadGeneration.current === generation) setInitialLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    if (mode === "replay") return;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadProgress();
    });
    return () => {
      active = false;
      loadGeneration.current += 1;
    };
  }, [loadProgress, mode]);

  useEffect(() => {
    if (!ready) return;
    const duration = onboardingTransitionDuration(reduceMotion);
    transition.stopAnimation();
    if (duration === 0) {
      transition.setValue(1);
    } else {
      transition.setValue(0);
      Animated.timing(transition, {
        duration,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }).start();
    }
  }, [index, ready, reduceMotion, transition]);

  useEffect(() => {
    if (!ready) return;
    scrollViewRef.current?.scrollTo({ y: 0, animated: false });
    AccessibilityInfo.announceForAccessibility(
      `${progressLabel}. ${step.title}`,
    );
    if (mode === "first-run") {
      void writes.progress(index).catch(() => undefined);
    }
  }, [index, mode, progressLabel, ready, step.title, writes]);

  const closeReplay = useCallback(() => {
    if (onRequestClose) onRequestClose();
    else onComplete();
  }, [onComplete, onRequestClose]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (index > 0) {
          setIndex(previousOnboardingTourIndex(index));
          setError(undefined);
          return true;
        }
        if (mode === "replay") {
          closeReplay();
          return true;
        }
        return false;
      },
    );
    return () => subscription.remove();
  }, [closeReplay, index, mode]);

  function goForward() {
    setError(undefined);
    setIndex(nextOnboardingTourIndex(index));
  }

  function goBack() {
    setError(undefined);
    setIndex(previousOnboardingTourIndex(index));
  }

  async function finish(destination: OnboardingFinishDestination) {
    if (finishingRef.current) return;
    if (mode === "replay") {
      closeReplay();
      return;
    }
    finishingRef.current = true;
    setFinishing(true);
    setError(undefined);
    try {
      await setDataMode(onboardingDestinationDataMode(destination));
      await writes.complete();
      onComplete(destination);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "T1 Arc could not finish setup just now. Nothing was changed.",
      );
      finishingRef.current = false;
      setFinishing(false);
    }
  }

  if (!ready) {
    return (
      <LinearGradient
        colors={[colors.backgroundGlow, colors.background, colors.background]}
        locations={[0, 0.42, 1]}
        style={styles.fill}
      >
        <SafeAreaView style={styles.loadingSafeArea}>
          <BrandMark />
          {initialLoadFailed ? (
            <View
              accessibilityLiveRegion="polite"
              style={[
                styles.loadErrorCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radius.xl,
                },
              ]}
            >
              <Ionicons
                color={colors.warning}
                name="warning-outline"
                size={28}
              />
              <Text style={[styles.loadErrorTitle, { color: colors.text }]}>
                The tour could not open safely.
              </Text>
              <Text
                style={[styles.loadErrorBody, { color: colors.textSecondary }]}
              >
                Your data has not been changed. Try checking the saved tour
                state again.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void loadProgress()}
                style={({ pressed }) => [
                  styles.loadRetry,
                  {
                    backgroundColor: colors.primary,
                    borderRadius: radius.md,
                    opacity: pressed ? 0.72 : 1,
                  },
                ]}
              >
                <Text
                  style={[styles.primaryLabel, { color: colors.onPrimary }]}
                >
                  Try again
                </Text>
              </Pressable>
            </View>
          ) : (
            <ActivityIndicator
              accessibilityLabel="Opening the T1 Arc tour"
              color={colors.primary}
              size="large"
            />
          )}
        </SafeAreaView>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={[colors.backgroundGlow, colors.background, colors.background]}
      end={{ x: 0.82, y: 0.72 }}
      locations={[0, 0.42, 1]}
      start={{ x: 0.02, y: 0 }}
      style={styles.fill}
    >
      <SafeAreaView style={styles.fill}>
        <View style={styles.shell}>
          <View style={styles.header}>
            <BrandMark compact />
            {mode === "replay" ? (
              <HeaderAction
                icon="close"
                label="Close tour"
                onPress={closeReplay}
              />
            ) : finalStep ? (
              <View style={styles.headerActionPlaceholder} />
            ) : (
              <HeaderAction
                label="Skip tour"
                onPress={() => {
                  setError(undefined);
                  setIndex(LAST_ONBOARDING_TOUR_INDEX);
                }}
              />
            )}
          </View>

          <View
            accessibilityLabel={progressLabel}
            accessibilityRole="progressbar"
            accessibilityValue={{
              max: ONBOARDING_TOUR_STEPS.length,
              min: 1,
              now: index + 1,
              text: progressLabel,
            }}
            style={styles.progressRow}
          >
            {ONBOARDING_TOUR_STEPS.map((item, itemIndex) => (
              <View
                key={item.id}
                style={[
                  styles.progressSegment,
                  {
                    backgroundColor:
                      itemIndex <= index ? colors.primary : colors.divider,
                  },
                ]}
              />
            ))}
          </View>

          <Animated.View
            style={[
              styles.animatedBody,
              {
                opacity: transition,
                transform: [
                  {
                    translateY: transition.interpolate({
                      inputRange: [0, 1],
                      outputRange: [10, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <ScrollView
              ref={scrollViewRef}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              <TourArtwork step={step.id} />
              <View style={styles.copyBlock}>
                <Text style={[styles.eyebrow, { color: colors.accent }]}>
                  {step.eyebrow}
                </Text>
                <Text
                  accessibilityRole="header"
                  style={[styles.title, { color: colors.text }]}
                >
                  {step.title}
                </Text>
                <Text style={[styles.detail, { color: colors.textSecondary }]}>
                  {step.detail}
                </Text>
                <View
                  style={[
                    styles.tip,
                    {
                      backgroundColor: `${colors.primary}0D`,
                      borderColor: `${colors.primary}28`,
                      borderRadius: radius.md,
                    },
                  ]}
                >
                  <Ionicons
                    color={colors.primary}
                    name="information-circle-outline"
                    size={20}
                  />
                  <Text
                    style={[styles.tipText, { color: colors.textSecondary }]}
                  >
                    {step.tip}
                  </Text>
                </View>
                {step.id === "today" ? (
                  <Text
                    style={[styles.exampleNote, { color: colors.textTertiary }]}
                  >
                    The walkthrough uses illustrative example data, never your
                    health records.
                  </Text>
                ) : null}
                {error ? <InlineError message={error} /> : null}
              </View>
            </ScrollView>
          </Animated.View>

          <View style={[styles.footer, { borderTopColor: colors.divider }]}>
            {finalStep ? (
              mode === "replay" ? (
                <PrimaryButton
                  icon="checkmark"
                  label="Back to settings"
                  onPress={closeReplay}
                />
              ) : (
                <>
                  <PrimaryButton
                    busy={finishing}
                    icon="git-network-outline"
                    label={
                      finishing ? "Opening settings…" : "Choose my data sources"
                    }
                    onPress={() => void finish("Sources")}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{
                      busy: finishing,
                      disabled: finishing,
                    }}
                    disabled={finishing}
                    onPress={() => void finish("Today")}
                    style={({ pressed }) => [
                      styles.textAction,
                      { opacity: finishing ? 0.48 : pressed ? 0.58 : 1 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.textActionLabel,
                        { color: colors.primary },
                      ]}
                    >
                      Explore the demo first
                    </Text>
                  </Pressable>
                </>
              )
            ) : (
              <View style={styles.navigationRow}>
                {index > 0 ? (
                  <Pressable
                    accessibilityLabel="Previous tour step"
                    accessibilityRole="button"
                    onPress={goBack}
                    style={({ pressed }) => [
                      styles.backAction,
                      {
                        backgroundColor: colors.surfaceMuted,
                        borderColor: colors.border,
                        borderRadius: radius.md,
                        opacity: pressed ? 0.66 : 1,
                      },
                    ]}
                  >
                    <Ionicons
                      color={colors.primary}
                      name="arrow-back"
                      size={20}
                    />
                    <Text
                      style={[
                        styles.backActionLabel,
                        { color: colors.primary },
                      ]}
                    >
                      Back
                    </Text>
                  </Pressable>
                ) : null}
                <View style={styles.nextAction}>
                  <PrimaryButton
                    icon="arrow-forward"
                    label={step.nextLabel}
                    onPress={goForward}
                  />
                </View>
              </View>
            )}
          </View>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  const { colors, radius } = useAppTheme();
  return (
    <View style={styles.brandRow}>
      <View
        style={[
          compact ? styles.brandIconCompact : styles.brandIcon,
          {
            backgroundColor: `${colors.primary}18`,
            borderColor: `${colors.primary}3D`,
            borderRadius: radius.md,
          },
        ]}
      >
        <Ionicons
          color={colors.primary}
          name="pulse"
          size={compact ? 21 : 27}
        />
      </View>
      <View>
        <Text
          style={[
            compact ? styles.brandNameCompact : styles.brandName,
            { color: colors.text },
          ]}
        >
          T1 Arc
        </Text>
        {!compact ? (
          <Text style={[styles.brandDetail, { color: colors.textSecondary }]}>
            Personal diabetes review
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function HeaderAction({
  icon,
  label,
  onPress,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress(): void;
}) {
  const { colors, radius } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.headerAction,
        {
          backgroundColor: colors.surfaceMuted,
          borderRadius: radius.pill,
          opacity: pressed ? 0.62 : 1,
        },
      ]}
    >
      {icon ? (
        <Ionicons color={colors.textSecondary} name={icon} size={18} />
      ) : null}
      <Text style={[styles.headerActionLabel, { color: colors.textSecondary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function PrimaryButton({
  busy = false,
  icon,
  label,
  onPress,
}: {
  busy?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress(): void;
}) {
  const { colors, radius } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryAction,
        {
          backgroundColor: colors.primary,
          borderRadius: radius.md,
          opacity: busy ? 0.72 : pressed ? 0.76 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.onPrimary} />
      ) : (
        <Ionicons color={colors.onPrimary} name={icon} size={20} />
      )}
      <Text style={[styles.primaryLabel, { color: colors.onPrimary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function InlineError({ message }: { message: string }) {
  const { colors, radius } = useAppTheme();
  return (
    <View
      accessibilityLiveRegion="assertive"
      style={[
        styles.error,
        {
          backgroundColor: `${colors.danger}10`,
          borderColor: `${colors.danger}45`,
          borderRadius: radius.md,
        },
      ]}
    >
      <Ionicons color={colors.danger} name="alert-circle-outline" size={20} />
      <Text style={[styles.errorText, { color: colors.danger }]}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  loadingSafeArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 28,
    paddingHorizontal: 24,
  },
  shell: { flex: 1, width: "100%", maxWidth: 760, alignSelf: "center" },
  header: {
    minHeight: 70,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandIcon: {
    width: 52,
    height: 52,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  brandIconCompact: {
    width: 40,
    height: 40,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  brandName: {
    fontSize: 22,
    lineHeight: 27,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  brandNameCompact: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "900",
    letterSpacing: -0.35,
  },
  brandDetail: { fontSize: 12, lineHeight: 16, marginTop: 1 },
  headerAction: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  headerActionPlaceholder: { width: 48, height: 48 },
  headerActionLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
  },
  progressRow: {
    flexDirection: "row",
    gap: 7,
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 10,
  },
  progressSegment: { flex: 1, height: 4, borderRadius: 2 },
  animatedBody: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 7,
    paddingBottom: 22,
  },
  copyBlock: { paddingHorizontal: 2, paddingTop: 24 },
  eyebrow: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
    letterSpacing: 1.35,
  },
  title: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "900",
    letterSpacing: -1.05,
    marginTop: 9,
    maxWidth: 620,
  },
  detail: {
    fontSize: 15,
    lineHeight: 23,
    marginTop: 13,
    maxWidth: 640,
  },
  tip: {
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    padding: 13,
    marginTop: 17,
  },
  tipText: { flex: 1, fontSize: 12, lineHeight: 18 },
  exampleNote: {
    fontSize: 11,
    lineHeight: 17,
    textAlign: "center",
    marginTop: 13,
    paddingHorizontal: 12,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 10,
  },
  navigationRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
  },
  backAction: {
    minWidth: 104,
    minHeight: 54,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  backActionLabel: { fontSize: 14, lineHeight: 19, fontWeight: "900" },
  nextAction: { flex: 1 },
  primaryAction: {
    minHeight: 54,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  primaryLabel: { fontSize: 14, lineHeight: 19, fontWeight: "900" },
  textAction: { minHeight: 50, alignItems: "center", justifyContent: "center" },
  textActionLabel: { fontSize: 13, lineHeight: 18, fontWeight: "800" },
  error: {
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    padding: 12,
    marginTop: 14,
  },
  errorText: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: "600" },
  loadErrorCard: {
    width: "100%",
    maxWidth: 440,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    padding: 24,
  },
  loadErrorTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 13,
  },
  loadErrorBody: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 7,
  },
  loadRetry: {
    minHeight: 50,
    minWidth: 140,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 19,
  },
});
