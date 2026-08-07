import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { connectLibreLinkUp } from '@/data/libreLinkUp/connectLibreLinkUp';
import { saveOnboardingComplete } from '@/data/libreLinkUp/secureStore';
import {
  LibreLinkUpError,
  LibreLinkUpSnapshot,
} from '@/data/libreLinkUp/types';
import { presentTrend } from '@/domain/trend';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';

type Stage = 'welcome' | 'connect' | 'ready';

interface Props {
  onComplete(destination?: 'Today' | 'Sources'): void;
}

const BENEFITS = [
  {
    icon: 'pulse-outline' as const,
    title: 'Glucose at a glance',
    detail: 'See the latest value, direction and freshness without hunting.',
  },
  {
    icon: 'layers-outline' as const,
    title: 'One private history',
    detail: 'Bring glucose, insulin and health context together on this phone.',
  },
  {
    icon: 'sparkles-outline' as const,
    title: 'Answers with evidence',
    detail: 'Every observation stays linked to the records behind it.',
  },
];

export function OnboardingScreen({ onComplete }: Props) {
  const { colors, radius, dark } = useAppTheme();
  const { activateLibreSnapshot, setDataMode } = useDataContext();
  const [stage, setStage] = useState<Stage>('welcome');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState<string>();
  const [snapshot, setSnapshot] = useState<LibreLinkUpSnapshot>();
  const passwordInputRef = useRef<TextInput | null>(null);

  const canConnect =
    email.trim().includes('@') && password.length > 0 && !connecting;

  async function continueWithoutGlucose() {
    if (skipping) return;
    setSkipping(true);
    setError(undefined);
    try {
      await setDataMode('live');
      await saveOnboardingComplete();
      onComplete();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'T1 Arc could not open your private workspace just now.',
      );
      setSkipping(false);
    }
  }

  async function chooseAnotherSource() {
    if (skipping) return;
    setSkipping(true);
    setError(undefined);
    try {
      await setDataMode('live');
      await saveOnboardingComplete();
      onComplete('Sources');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'T1 Arc could not open data sources just now.',
      );
      setSkipping(false);
    }
  }

  async function connect() {
    if (!canConnect) return;
    setConnecting(true);
    setError(undefined);
    try {
      const next = await connectLibreLinkUp({
        email: email.trim(),
        password,
        topLevelDomain: 'io',
      });
      await activateLibreSnapshot(next);
      setSnapshot(next);
      setPassword('');
      setStage('ready');
    } catch (cause) {
      setError(
        cause instanceof LibreLinkUpError || cause instanceof Error
          ? cause.message
          : 'The LibreLinkUp connection could not be verified.',
      );
    } finally {
      setConnecting(false);
    }
  }

  async function finish() {
    await saveOnboardingComplete();
    onComplete();
  }

  return (
    <LinearGradient
      colors={
        dark
          ? [colors.backgroundGlow, colors.background, colors.background]
          : [colors.backgroundGlow, colors.background, '#F7FBFC']
      }
      locations={[0, 0.42, 1]}
      style={styles.fill}
    >
      <SafeAreaView style={styles.fill}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.fill}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.brandRow}>
              <View
                style={[
                  styles.brandMark,
                  {
                    backgroundColor: `${colors.primary}18`,
                    borderColor: `${colors.primary}38`,
                    borderRadius: radius.md,
                  },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.primary}
                  name="pulse"
                  size={25}
                />
              </View>
              <Text style={[styles.brandName, { color: colors.text }]}>
                T1 Arc
              </Text>
              {stage !== 'welcome' ? (
                <View
                  style={[
                    styles.stepPill,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderRadius: radius.pill,
                    },
                  ]}
                >
                  <Text
                    style={[styles.stepText, { color: colors.textSecondary }]}
                  >
                    {stage === 'connect' ? '1 OF 2' : '2 OF 2'}
                  </Text>
                </View>
              ) : null}
            </View>

            {stage === 'welcome' ? (
              <WelcomeStep
                onConnect={() => {
                  setError(undefined);
                  setStage('connect');
                }}
                onAnotherSource={() => void chooseAnotherSource()}
                onContinue={() => void continueWithoutGlucose()}
                busy={skipping}
                error={error}
              />
            ) : null}

            {stage === 'connect' ? (
              <View style={styles.step}>
                <Pressable
                  accessibilityLabel="Back to welcome"
                  accessibilityRole="button"
                  onPress={() => {
                    setError(undefined);
                    setStage('welcome');
                  }}
                  style={({ pressed }) => [
                    styles.backButton,
                    { opacity: pressed ? 0.55 : 1 },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.textSecondary}
                    name="arrow-back"
                    size={20}
                  />
                  <Text
                    style={[styles.backText, { color: colors.textSecondary }]}
                  >
                    Back
                  </Text>
                </Pressable>

                <View style={styles.headingBlock}>
                  <Text style={[styles.eyebrow, { color: colors.accent }]}>
                    YOUR GLUCOSE
                  </Text>
                  <Text style={[styles.title, { color: colors.text }]}>
                    Connect once. Keep checking less.
                  </Text>
                  <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                    Use the LibreLinkUp follower account that already receives
                    your readings. UK accounts use the libreview.io service.
                  </Text>
                </View>

                <View
                  style={[
                    styles.formCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radius.xl,
                    },
                  ]}
                >
                  <FieldLabel text="LibreLinkUp email" />
                  <TextInput
                    accessibilityLabel="LibreLinkUp email"
                    autoCapitalize="none"
                    autoComplete="email"
                    autoCorrect={false}
                    keyboardType="email-address"
                    onChangeText={(value) => {
                      setEmail(value);
                      setError(undefined);
                    }}
                    onSubmitEditing={() => passwordInputRef.current?.focus()}
                    placeholder="you@example.com"
                    placeholderTextColor={colors.textTertiary}
                    returnKeyType="next"
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.surfaceMuted,
                        borderColor: error ? colors.danger : colors.border,
                        borderRadius: radius.md,
                        color: colors.text,
                      },
                    ]}
                    value={email}
                  />

                  <FieldLabel text="LibreLinkUp password" />
                  <View
                    style={[
                      styles.passwordRow,
                      {
                        backgroundColor: colors.surfaceMuted,
                        borderColor: error ? colors.danger : colors.border,
                        borderRadius: radius.md,
                      },
                    ]}
                  >
                    <TextInput
                      ref={passwordInputRef}
                      accessibilityLabel="LibreLinkUp password"
                      autoCapitalize="none"
                      autoComplete="current-password"
                      autoCorrect={false}
                      onChangeText={(value) => {
                        setPassword(value);
                        setError(undefined);
                      }}
                      onSubmitEditing={() => void connect()}
                      placeholder="Password"
                      placeholderTextColor={colors.textTertiary}
                      returnKeyType="done"
                      secureTextEntry={!passwordVisible}
                      style={[styles.passwordInput, { color: colors.text }]}
                      value={password}
                    />
                    <Pressable
                      accessibilityLabel={
                        passwordVisible ? 'Hide password' : 'Show password'
                      }
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={() => setPasswordVisible((value) => !value)}
                      style={styles.eyeButton}
                    >
                      <Ionicons
                        accessibilityElementsHidden
                        color={colors.textSecondary}
                        name={
                          passwordVisible ? 'eye-off-outline' : 'eye-outline'
                        }
                        size={22}
                      />
                    </Pressable>
                  </View>

                  {error ? <InlineError message={error} /> : null}

                  <Pressable
                    accessibilityRole="button"
                    disabled={!canConnect}
                    onPress={() => void connect()}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      {
                        backgroundColor: canConnect
                          ? colors.primary
                          : colors.surfaceMuted,
                        borderRadius: radius.md,
                        opacity: pressed && canConnect ? 0.76 : 1,
                      },
                    ]}
                  >
                    {connecting ? (
                      <ActivityIndicator color={colors.onPrimary} />
                    ) : (
                      <Ionicons
                        accessibilityElementsHidden
                        color={
                          canConnect ? colors.onPrimary : colors.textTertiary
                        }
                        name="shield-checkmark-outline"
                        size={21}
                      />
                    )}
                    <Text
                      style={[
                        styles.primaryText,
                        {
                          color: canConnect
                            ? colors.onPrimary
                            : colors.textTertiary,
                        },
                      ]}
                    >
                      {connecting ? 'Connecting securely…' : 'Connect glucose'}
                    </Text>
                  </Pressable>
                </View>

                <PrivacyNote />
                <AlternateSourceButton
                  disabled={skipping}
                  onPress={() => void chooseAnotherSource()}
                />
                <TextButton
                  disabled={skipping}
                  label={
                    skipping
                      ? 'Opening your workspace…'
                      : 'Continue without glucose'
                  }
                  onPress={() => void continueWithoutGlucose()}
                />
              </View>
            ) : null}

            {stage === 'ready' ? (
              <ReadyStep snapshot={snapshot} onFinish={() => void finish()} />
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

function WelcomeStep({
  onConnect,
  onAnotherSource,
  onContinue,
  busy,
  error,
}: {
  onConnect(): void;
  onAnotherSource(): void;
  onContinue(): void;
  busy: boolean;
  error?: string;
}) {
  const { colors, radius } = useAppTheme();
  return (
    <View style={styles.step}>
      <View style={styles.headingBlock}>
        <Text style={[styles.eyebrow, { color: colors.accent }]}>
          LESS CHECKING. MORE UNDERSTANDING.
        </Text>
        <Text style={[styles.welcomeTitle, { color: colors.text }]}>
          Your diabetes data, finally in one place.
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          T1 Arc turns scattered readings and events into a private history
          you can inspect and understand.
        </Text>
      </View>

      <View
        style={[
          styles.benefitCard,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radius.xl,
          },
        ]}
      >
        {BENEFITS.map((benefit, index) => (
          <View
            key={benefit.title}
            style={[
              styles.benefitRow,
              index > 0 && { borderTopColor: colors.divider, borderTopWidth: 1 },
            ]}
          >
            <View
              style={[
                styles.benefitIcon,
                {
                  backgroundColor: `${colors.primary}14`,
                  borderRadius: radius.md,
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={colors.primary}
                name={benefit.icon}
                size={21}
              />
            </View>
            <View style={styles.benefitCopy}>
              <Text style={[styles.benefitTitle, { color: colors.text }]}>
                {benefit.title}
              </Text>
              <Text
                style={[styles.benefitDetail, { color: colors.textSecondary }]}
              >
                {benefit.detail}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {error ? <InlineError message={error} /> : null}

      <Pressable
        accessibilityRole="button"
        onPress={onConnect}
        style={({ pressed }) => [
          styles.primaryButton,
          {
            backgroundColor: colors.primary,
            borderRadius: radius.md,
            opacity: pressed ? 0.76 : 1,
          },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={colors.onPrimary}
          name="pulse-outline"
          size={21}
        />
        <Text style={[styles.primaryText, { color: colors.onPrimary }]}>
          Set up my glucose
        </Text>
        <Ionicons
          accessibilityElementsHidden
          color={colors.onPrimary}
          name="arrow-forward"
          size={19}
        />
      </Pressable>
      <AlternateSourceButton disabled={busy} onPress={onAnotherSource} />
      <TextButton
        disabled={busy}
        label={
          busy ? 'Opening your workspace…' : 'Continue without glucose'
        }
        onPress={onContinue}
      />
      <Text style={[styles.safety, { color: colors.textTertiary }]}>
        For personal review only. T1 Arc never recommends insulin doses or
        pump-setting changes.
      </Text>
    </View>
  );
}

function ReadyStep({
  snapshot,
  onFinish,
}: {
  snapshot?: LibreLinkUpSnapshot;
  onFinish(): void;
}) {
  const { colors, radius } = useAppTheme();
  const latest = snapshot?.readings[snapshot.readings.length - 1];
  const trend = latest ? presentTrend(latest.trend) : undefined;
  return (
    <View style={styles.step}>
      <View
        style={[
          styles.successIcon,
          {
            backgroundColor: `${colors.accent}18`,
            borderColor: `${colors.accent}55`,
            borderRadius: radius.pill,
          },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={colors.accent}
          name="checkmark"
          size={34}
        />
      </View>
      <View style={styles.headingBlock}>
        <Text style={[styles.eyebrow, { color: colors.accent }]}>
          CONNECTION READY
        </Text>
        <Text style={[styles.title, { color: colors.text }]}>
          Your glucose is in T1 Arc.
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          The verified reading is already saved to encrypted history. T1 Arc
          will keep its age and source clear.
        </Text>
      </View>

      {latest ? (
        <View
          accessibilityLabel={`${latest.mmolL.toFixed(1)} millimoles per litre, ${trend?.label ?? 'trend unavailable'}`}
          style={[
            styles.readingCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radius.xl,
            },
          ]}
        >
          <Text style={[styles.readingLabel, { color: colors.textTertiary }]}>
            VERIFIED READING
          </Text>
          <View style={styles.readingRow}>
            <Text style={[styles.readingValue, { color: colors.text }]}>
              {latest.mmolL.toFixed(1)}
            </Text>
            <View>
              <Text style={[styles.readingArrow, { color: colors.glucose }]}>
                {trend?.arrow ?? '—'}
              </Text>
              <Text style={[styles.readingUnit, { color: colors.textSecondary }]}>
                mmol/L
              </Text>
            </View>
          </View>
          <Text style={[styles.readingTrend, { color: colors.textSecondary }]}>
            {trend?.label ?? 'Trend unavailable'}
          </Text>
        </View>
      ) : null}

      <View
        style={[
          styles.privateCallout,
          {
            backgroundColor: colors.surfaceMuted,
            borderRadius: radius.md,
          },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={colors.accent}
          name="lock-closed-outline"
          size={19}
        />
        <Text style={[styles.privateText, { color: colors.textSecondary }]}>
          Credentials and collected health history stay protected on this
          phone. You can remove the connection at any time.
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={onFinish}
        style={({ pressed }) => [
          styles.primaryButton,
          {
            backgroundColor: colors.primary,
            borderRadius: radius.md,
            opacity: pressed ? 0.76 : 1,
          },
        ]}
      >
        <Text style={[styles.primaryText, { color: colors.onPrimary }]}>
          Open T1 Arc
        </Text>
        <Ionicons
          accessibilityElementsHidden
          color={colors.onPrimary}
          name="arrow-forward"
          size={19}
        />
      </Pressable>
    </View>
  );
}

function AlternateSourceButton({
  onPress,
  disabled,
}: {
  onPress(): void;
  disabled?: boolean;
}) {
  const { colors, radius } = useAppTheme();
  return (
    <Pressable
      accessibilityHint="Opens personal mode and the full list of glucose and health data sources."
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.alternateSourceButton,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radius.md,
          opacity: disabled ? 0.5 : pressed ? 0.68 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.alternateSourceIcon,
          {
            backgroundColor: `${colors.primary}14`,
            borderRadius: radius.sm,
          },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={colors.primary}
          name="git-network-outline"
          size={20}
        />
      </View>
      <View style={styles.alternateSourceCopy}>
        <Text style={[styles.alternateSourceTitle, { color: colors.text }]}>
          Use another source
        </Text>
        <Text
          style={[
            styles.alternateSourceDetail,
            { color: colors.textSecondary },
          ]}
        >
          Nightscout, xDrip, phone notifications, or connect later
        </Text>
      </View>
      <Ionicons
        accessibilityElementsHidden
        color={colors.textTertiary}
        name="chevron-forward"
        size={18}
      />
    </Pressable>
  );
}

function FieldLabel({ text }: { text: string }) {
  const { colors } = useAppTheme();
  return <Text style={[styles.fieldLabel, { color: colors.text }]}>{text}</Text>;
}

function PrivacyNote() {
  const { colors, radius } = useAppTheme();
  return (
    <View
      style={[
        styles.privateCallout,
        {
          backgroundColor: colors.surfaceMuted,
          borderRadius: radius.md,
        },
      ]}
    >
      <Ionicons
        accessibilityElementsHidden
        color={colors.accent}
        name="lock-closed-outline"
        size={19}
      />
      <Text style={[styles.privateText, { color: colors.textSecondary }]}>
        Your sign-in is stored in Android secure storage on this phone. T1 Arc
        does not send it to a T1 Arc server or accept account terms for you.
      </Text>
    </View>
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
          borderColor: `${colors.danger}55`,
          borderRadius: radius.md,
        },
      ]}
    >
      <Ionicons
        accessibilityElementsHidden
        color={colors.danger}
        name="alert-circle-outline"
        size={19}
      />
      <Text style={[styles.errorText, { color: colors.textSecondary }]}>
        {message}
      </Text>
    </View>
  );
}

function TextButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.textButton,
        { opacity: disabled ? 0.5 : pressed ? 0.58 : 1 },
      ]}
    >
      <Text style={[styles.textButtonLabel, { color: colors.primary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 28,
  },
  brandRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 34,
  },
  brandMark: {
    width: 44,
    height: 44,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    marginLeft: 11,
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '900',
    letterSpacing: -0.35,
  },
  stepPill: {
    marginLeft: 'auto',
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  stepText: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  step: {
    flex: 1,
  },
  backButton: {
    minHeight: 44,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 11,
  },
  backText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  headingBlock: {
    marginBottom: 25,
  },
  eyebrow: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    letterSpacing: 1.35,
    marginBottom: 10,
  },
  welcomeTitle: {
    fontSize: 38,
    lineHeight: 43,
    fontWeight: '900',
    letterSpacing: -1.25,
    maxWidth: 550,
  },
  title: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '900',
    letterSpacing: -0.95,
    maxWidth: 560,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 23,
    marginTop: 14,
    maxWidth: 590,
  },
  benefitCard: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 17,
    marginBottom: 22,
  },
  benefitRow: {
    minHeight: 91,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 15,
  },
  benefitIcon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitCopy: {
    flex: 1,
  },
  benefitTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  benefitDetail: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  primaryButton: {
    minHeight: 58,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  primaryText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  textButton: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textButtonLabel: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  alternateSourceButton: {
    minHeight: 66,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginTop: 10,
  },
  alternateSourceIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alternateSourceCopy: {
    flex: 1,
  },
  alternateSourceTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  alternateSourceDetail: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 1,
  },
  safety: {
    textAlign: 'center',
    fontSize: 10,
    lineHeight: 16,
    marginTop: 5,
    paddingHorizontal: 14,
  },
  formCard: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    marginBottom: 15,
  },
  fieldLabel: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    marginBottom: 8,
  },
  input: {
    minHeight: 54,
    borderWidth: 1,
    paddingHorizontal: 15,
    fontSize: 15,
    marginBottom: 17,
  },
  passwordRow: {
    minHeight: 54,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 17,
  },
  passwordInput: {
    flex: 1,
    minHeight: 52,
    paddingHorizontal: 15,
    fontSize: 15,
  },
  eyeButton: {
    width: 54,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  privateCallout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    marginBottom: 5,
  },
  privateText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 17,
  },
  error: {
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 12,
    marginBottom: 14,
  },
  errorText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 17,
  },
  successIcon: {
    width: 66,
    height: 66,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  readingCard: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
    marginBottom: 17,
  },
  readingLabel: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  readingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
    marginTop: 5,
  },
  readingValue: {
    fontSize: 64,
    lineHeight: 72,
    fontWeight: '800',
    letterSpacing: -2,
  },
  readingArrow: {
    fontSize: 29,
    lineHeight: 32,
    fontWeight: '700',
  },
  readingUnit: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  readingTrend: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
});
