import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import type { ComponentProps } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";

import type { OnboardingTourStepId } from "@/screens/onboarding/tourModel";
import { useAppTheme } from "@/theme/theme";
import { useRegionalProfile } from "@/providers/RegionalProfileProvider";
import { formatGlucose } from "@/domain/regionalFormat";

const TOUR_ARTWORK_MAX_FONT_SIZE_MULTIPLIER = 1;

function ArtworkText(props: ComponentProps<typeof Text>) {
  return (
    <Text
      {...props}
      maxFontSizeMultiplier={TOUR_ARTWORK_MAX_FONT_SIZE_MULTIPLIER}
    />
  );
}

export function TourArtwork({ step }: { step: OnboardingTourStepId }) {
  const { colors, radius } = useAppTheme();
  return (
    <LinearGradient
      accessible
      accessibilityLabel={artworkAccessibilityLabel(step)}
      accessibilityRole="image"
      colors={[
        colors.surfaceGradientStart,
        colors.surfaceGradientMiddle,
        colors.surfaceGradientEnd,
      ]}
      style={[
        styles.frame,
        {
          borderColor: colors.surfaceBorder,
          borderRadius: radius.xl,
          shadowColor: colors.surfaceShadow,
        },
      ]}
    >
      <View importantForAccessibility="no-hide-descendants" style={styles.fill}>
        <View
          style={[
            styles.examplePill,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
              borderRadius: radius.pill,
            },
          ]}
        >
          <View
            style={[styles.exampleDot, { backgroundColor: colors.accent }]}
          />
          <ArtworkText
            style={[styles.exampleText, { color: colors.textSecondary }]}
          >
            EXAMPLE
          </ArtworkText>
        </View>
        {step === "today" ? <TodayArtwork /> : null}
        {step === "log" ? <LogArtwork /> : null}
        {step === "context" ? <ContextArtwork /> : null}
        {step === "tarvis" ? <TarvisArtwork /> : null}
        {step === "control" ? <ControlArtwork /> : null}
      </View>
    </LinearGradient>
  );
}

function artworkAccessibilityLabel(step: OnboardingTourStepId) {
  switch (step) {
    case "today":
      return "Example Today card showing a current glucose value, trend and freshness.";
    case "log":
      return "Example quick-add sheet with food, insulin and health context choices.";
    case "context":
      return "Example health cards and timeline aligning glucose, insulin, a meal and a walk.";
    case "tarvis":
      return "Example Tarv1s answer comparing glucose timing, a walk, lunch, active insulin and activity mode, with a link to supporting records.";
    case "control":
      return "Example private phone connected to optional glucose, health and workout sources.";
  }
}

function TodayArtwork() {
  const { defaults: regional } = useRegionalProfile();
  const demoGlucose = formatGlucose(6.8, regional);
  const { colors, radius } = useAppTheme();
  return (
    <View style={styles.artworkBody}>
      <View style={styles.miniHeader}>
        <View>
          <ArtworkText
            style={[styles.miniEyebrow, { color: colors.textTertiary }]}
          >
            TODAY
          </ArtworkText>
          <ArtworkText style={[styles.miniTitle, { color: colors.text }]}>
            Good morning.
          </ArtworkText>
        </View>
        <View
          style={[
            styles.roundIcon,
            { backgroundColor: colors.surfaceMuted, borderRadius: radius.pill },
          ]}
        >
          <Ionicons color={colors.textSecondary} name="menu" size={18} />
        </View>
      </View>
      <View
        style={[
          styles.glucoseCard,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radius.lg,
          },
        ]}
      >
        <View style={styles.glucoseCopy}>
          <ArtworkText
            style={[styles.glucoseLabel, { color: colors.textSecondary }]}
          >
            GLUCOSE
          </ArtworkText>
          <View style={styles.glucoseValueRow}>
            <ArtworkText style={[styles.glucoseValue, { color: colors.text }]}>
              {demoGlucose.split(" ")[0]}
            </ArtworkText>
            <ArtworkText
              style={[styles.glucoseArrow, { color: colors.glucose }]}
            >
              →
            </ArtworkText>
          </View>
          <ArtworkText
            style={[styles.glucoseUnit, { color: colors.textSecondary }]}
          >
            {demoGlucose.split(" ").slice(1).join(" ")} · 2 min ago
          </ArtworkText>
        </View>
        <Svg height="92" viewBox="0 0 145 92" width="47%">
          <Line
            stroke={colors.grid}
            strokeDasharray="3 5"
            strokeWidth="1"
            x1="0"
            x2="145"
            y1="52"
            y2="52"
          />
          <Path
            d="M 2 66 C 18 60, 25 38, 42 44 S 69 64, 84 49 S 108 32, 143 39"
            fill="none"
            stroke={colors.glucose}
            strokeLinecap="round"
            strokeWidth="4"
          />
          <Circle cx="143" cy="39" fill={colors.glucose} r="5" />
        </Svg>
        <View
          style={[
            styles.statusPill,
            {
              backgroundColor: `${colors.accent}18`,
              borderRadius: radius.pill,
            },
          ]}
        >
          <ArtworkText style={[styles.statusText, { color: colors.accent }]}>
            STEADY · IN RANGE
          </ArtworkText>
        </View>
      </View>
      <View
        style={[
          styles.floatingAdd,
          { backgroundColor: colors.primary, borderRadius: radius.pill },
        ]}
      >
        <Ionicons color={colors.onPrimary} name="add" size={26} />
      </View>
    </View>
  );
}

function LogArtwork() {
  const { colors, radius } = useAppTheme();
  const rows = [
    { icon: "restaurant-outline" as const, label: "Food", tone: colors.accent },
    { icon: "water-outline" as const, label: "Insulin", tone: colors.insulin },
    {
      icon: "walk-outline" as const,
      label: "Health context",
      tone: colors.glucose,
    },
  ];
  return (
    <View style={[styles.artworkBody, styles.logBody]}>
      <View
        style={[
          styles.logBackdropCard,
          { backgroundColor: colors.surfaceMuted, borderRadius: radius.lg },
        ]}
      >
        <View style={styles.logBackdropRow}>
          <View
            style={[styles.logTick, { backgroundColor: `${colors.accent}22` }]}
          >
            <Ionicons color={colors.accent} name="checkmark" size={15} />
          </View>
          <View>
            <ArtworkText
              style={[styles.logBackdropTitle, { color: colors.text }]}
            >
              Lunch recorded
            </ArtworkText>
            <ArtworkText
              style={[styles.logBackdropMeta, { color: colors.textSecondary }]}
            >
              12:40 · 42 g carbs
            </ArtworkText>
          </View>
        </View>
      </View>
      <View
        style={[
          styles.logSheet,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radius.xl,
          },
        ]}
      >
        <View
          style={[styles.sheetHandle, { backgroundColor: colors.divider }]}
        />
        <ArtworkText style={[styles.sheetTitle, { color: colors.text }]}>
          What would you like to log?
        </ArtworkText>
        {rows.map((row) => (
          <View key={row.label} style={styles.logOption}>
            <View
              style={[
                styles.logOptionIcon,
                { backgroundColor: `${row.tone}18`, borderRadius: radius.md },
              ]}
            >
              <Ionicons color={row.tone} name={row.icon} size={19} />
            </View>
            <ArtworkText
              style={[styles.logOptionLabel, { color: colors.text }]}
            >
              {row.label}
            </ArtworkText>
            <Ionicons
              color={colors.textTertiary}
              name="chevron-forward"
              size={17}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

function ContextArtwork() {
  const { colors, radius } = useAppTheme();
  return (
    <View style={styles.artworkBody}>
      <View style={styles.healthRow}>
        <MiniMetric
          icon="walk-outline"
          label="Steps"
          tone={colors.glucose}
          value="6,420"
        />
        <MiniMetric
          icon="moon-outline"
          label="Sleep"
          tone={colors.insulin}
          value="7h 12m"
        />
      </View>
      <View
        style={[
          styles.timelineCard,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radius.lg,
          },
        ]}
      >
        <View style={styles.timelineHeading}>
          <ArtworkText style={[styles.timelineTitle, { color: colors.text }]}>
            A day in context
          </ArtworkText>
          <ArtworkText
            style={[styles.timelineMeta, { color: colors.textSecondary }]}
          >
            Tap to inspect
          </ArtworkText>
        </View>
        <Svg height="88" viewBox="0 0 300 88" width="100%">
          <Line
            stroke={colors.grid}
            strokeWidth="1"
            x1="4"
            x2="296"
            y1="49"
            y2="49"
          />
          <Path
            d="M 4 48 C 31 42, 39 24, 69 33 S 111 65, 140 52 S 182 23, 211 37 S 255 59, 296 31"
            fill="none"
            stroke={colors.glucose}
            strokeLinecap="round"
            strokeWidth="3.5"
          />
          <Line
            stroke={colors.insulin}
            strokeWidth="5"
            x1="89"
            x2="89"
            y1="61"
            y2="80"
          />
          <Line
            stroke={colors.insulin}
            strokeWidth="5"
            x1="203"
            x2="203"
            y1="57"
            y2="80"
          />
          <Circle cx="126" cy="73" fill={colors.accent} r="7" />
          <Circle cx="246" cy="73" fill={colors.warning} r="7" />
        </Svg>
        <View style={styles.timelineLegend}>
          <LegendDot color={colors.glucose} label="Glucose" />
          <LegendDot color={colors.insulin} label="Insulin" />
          <LegendDot color={colors.accent} label="Meal" />
          <LegendDot color={colors.warning} label="Walk" />
        </View>
      </View>
    </View>
  );
}

function MiniMetric({
  icon,
  label,
  tone,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tone: string;
  value: string;
}) {
  const { colors, radius } = useAppTheme();
  return (
    <View
      style={[
        styles.miniMetric,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radius.lg,
        },
      ]}
    >
      <View style={styles.miniMetricTop}>
        <Ionicons color={tone} name={icon} size={17} />
        <ArtworkText
          style={[styles.miniMetricLabel, { color: colors.textSecondary }]}
        >
          {label}
        </ArtworkText>
      </View>
      <ArtworkText style={[styles.miniMetricValue, { color: colors.text }]}>
        {value}
      </ArtworkText>
      <ArtworkText
        style={[styles.miniMetricMeta, { color: colors.textTertiary }]}
      >
        Recorded today
      </ArtworkText>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <ArtworkText style={[styles.legendText, { color: colors.textSecondary }]}>
        {label}
      </ArtworkText>
    </View>
  );
}

function TarvisArtwork() {
  const { colors, radius } = useAppTheme();
  return (
    <View style={[styles.artworkBody, styles.tarvisBody]}>
      <View
        style={[
          styles.questionBubble,
          { backgroundColor: colors.surfaceMuted, borderRadius: radius.lg },
        ]}
      >
        <ArtworkText style={[styles.questionText, { color: colors.text }]}>
          Why did I go low after my walk?
        </ArtworkText>
      </View>
      <View
        style={[
          styles.answerCard,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radius.xl,
          },
        ]}
      >
        <View style={styles.answerHeader}>
          <View
            style={[
              styles.answerIcon,
              {
                backgroundColor: `${colors.accent}18`,
                borderRadius: radius.pill,
              },
            ]}
          >
            <Ionicons color={colors.accent} name="compass-outline" size={19} />
          </View>
          <View>
            <ArtworkText style={[styles.answerName, { color: colors.text }]}>
              Tarv1s
            </ArtworkText>
            <ArtworkText
              style={[styles.answerMeta, { color: colors.textTertiary }]}
            >
              Personal review
            </ArtworkText>
          </View>
        </View>
        <ArtworkText
          style={[styles.answerText, { color: colors.textSecondary }]}
        >
          Glucose began falling 24 minutes into the walk. Lunch was 2 hours
          earlier, 1.8 U was still active, and activity mode was off. The timing
          suggests the walk and remaining insulin may both have contributed.
        </ArtworkText>
        <View
          style={[
            styles.evidenceButton,
            {
              backgroundColor: `${colors.primary}12`,
              borderColor: `${colors.primary}38`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons color={colors.primary} name="documents-outline" size={17} />
          <ArtworkText style={[styles.evidenceText, { color: colors.primary }]}>
            Inspect 6 supporting records
          </ArtworkText>
          <Ionicons color={colors.primary} name="arrow-forward" size={15} />
        </View>
      </View>
    </View>
  );
}

function ControlArtwork() {
  const { colors, radius } = useAppTheme();
  const connections = [
    { icon: "pulse-outline" as const, label: "Glucose", side: "left", y: 56 },
    { icon: "fitness-outline" as const, label: "Health", side: "right", y: 38 },
    {
      icon: "barbell-outline" as const,
      label: "Workout",
      side: "right",
      y: 166,
    },
  ];
  return (
    <View style={[styles.artworkBody, styles.controlBody]}>
      {connections.map((item) => (
        <View
          key={item.label}
          style={[
            styles.connectionNode,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radius.md,
              left: item.side === "left" ? 0 : undefined,
              right: item.side === "right" ? 0 : undefined,
              top: item.y,
            },
          ]}
        >
          <Ionicons color={colors.primary} name={item.icon} size={18} />
          <ArtworkText
            style={[styles.connectionLabel, { color: colors.textSecondary }]}
          >
            {item.label}
          </ArtworkText>
        </View>
      ))}
      <View
        style={[
          styles.phone,
          {
            backgroundColor: colors.surfaceElevated,
            borderColor: colors.textTertiary,
            borderRadius: 28,
          },
        ]}
      >
        <View
          style={[styles.phoneSpeaker, { backgroundColor: colors.divider }]}
        />
        <View
          style={[
            styles.lockCircle,
            {
              backgroundColor: `${colors.accent}18`,
              borderRadius: radius.pill,
            },
          ]}
        >
          <Ionicons color={colors.accent} name="lock-closed" size={27} />
        </View>
        <ArtworkText style={[styles.phoneTitle, { color: colors.text }]}>
          On this phone
        </ArtworkText>
        <ArtworkText
          style={[styles.phoneDetail, { color: colors.textSecondary }]}
        >
          Encrypted local history
        </ArtworkText>
      </View>
      <View
        style={[
          styles.backupPill,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radius.pill,
          },
        ]}
      >
        <Ionicons
          color={colors.accent}
          name="shield-checkmark-outline"
          size={16}
        />
        <ArtworkText
          style={[styles.backupText, { color: colors.textSecondary }]}
        >
          Optional encrypted backup
        </ArtworkText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  frame: {
    minHeight: 306,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 15,
    overflow: "hidden",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.09,
    shadowRadius: 24,
    elevation: 3,
  },
  examplePill: {
    alignSelf: "flex-start",
    minHeight: 27,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    zIndex: 5,
  },
  exampleDot: { width: 6, height: 6, borderRadius: 3 },
  exampleText: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },
  artworkBody: { flex: 1, paddingTop: 14 },
  miniHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  miniEyebrow: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  miniTitle: {
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "900",
    letterSpacing: -0.5,
    marginTop: 2,
  },
  roundIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  glucoseCard: {
    flex: 1,
    minHeight: 155,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 12,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
  },
  glucoseCopy: { flex: 1, zIndex: 2 },
  glucoseLabel: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },
  glucoseValueRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  glucoseValue: {
    fontSize: 45,
    lineHeight: 53,
    fontWeight: "800",
    letterSpacing: -1.7,
  },
  glucoseArrow: { fontSize: 27, lineHeight: 32, fontWeight: "700" },
  glucoseUnit: { fontSize: 11, lineHeight: 15, fontWeight: "600" },
  statusPill: {
    position: "absolute",
    left: 16,
    bottom: 14,
    minHeight: 25,
    paddingHorizontal: 9,
    justifyContent: "center",
  },
  statusText: {
    fontSize: 8,
    lineHeight: 11,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  floatingAdd: {
    position: "absolute",
    width: 50,
    height: 50,
    right: 10,
    bottom: -2,
    alignItems: "center",
    justifyContent: "center",
    elevation: 5,
  },
  logBody: { justifyContent: "flex-end" },
  logBackdropCard: {
    position: "absolute",
    left: 6,
    right: 6,
    top: 27,
    padding: 15,
    opacity: 0.72,
  },
  logBackdropRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  logTick: {
    width: 31,
    height: 31,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  logBackdropTitle: { fontSize: 12, lineHeight: 16, fontWeight: "800" },
  logBackdropMeta: { fontSize: 10, lineHeight: 14, marginTop: 1 },
  logSheet: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 17,
    paddingTop: 9,
    paddingBottom: 11,
    elevation: 4,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 9,
  },
  sheetTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
    marginBottom: 6,
  },
  logOption: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  logOptionIcon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  logOptionLabel: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: "800" },
  healthRow: { flexDirection: "row", gap: 10 },
  miniMetric: {
    flex: 1,
    minHeight: 83,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 11,
  },
  miniMetricTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  miniMetricLabel: { fontSize: 10, lineHeight: 14, fontWeight: "700" },
  miniMetricValue: {
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "900",
    marginTop: 7,
  },
  miniMetricMeta: { fontSize: 9, lineHeight: 12, marginTop: 1 },
  timelineCard: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 10,
    padding: 12,
  },
  timelineHeading: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  timelineTitle: { fontSize: 12, lineHeight: 16, fontWeight: "900" },
  timelineMeta: { fontSize: 9, lineHeight: 12 },
  timelineLegend: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 7,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { fontSize: 8, lineHeight: 11, fontWeight: "700" },
  tarvisBody: { justifyContent: "center" },
  questionBubble: {
    alignSelf: "flex-end",
    maxWidth: "82%",
    paddingHorizontal: 15,
    paddingVertical: 11,
    marginBottom: 10,
  },
  questionText: { fontSize: 12, lineHeight: 17, fontWeight: "700" },
  answerCard: { borderWidth: StyleSheet.hairlineWidth, padding: 15 },
  answerHeader: { flexDirection: "row", alignItems: "center", gap: 9 },
  answerIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  answerName: { fontSize: 13, lineHeight: 17, fontWeight: "900" },
  answerMeta: { fontSize: 9, lineHeight: 12, marginTop: 1 },
  answerText: { fontSize: 11, lineHeight: 17, marginTop: 12 },
  evidenceButton: {
    minHeight: 42,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 12,
    paddingHorizontal: 10,
  },
  evidenceText: { fontSize: 10, lineHeight: 14, fontWeight: "800" },
  controlBody: { minHeight: 233 },
  connectionNode: {
    position: "absolute",
    minWidth: 76,
    minHeight: 47,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    zIndex: 2,
  },
  connectionLabel: { fontSize: 9, lineHeight: 12, fontWeight: "700" },
  phone: {
    position: "absolute",
    width: 118,
    height: 190,
    alignSelf: "center",
    top: 12,
    borderWidth: 2,
    alignItems: "center",
    paddingTop: 14,
    zIndex: 3,
  },
  phoneSpeaker: { width: 35, height: 4, borderRadius: 2 },
  lockCircle: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 29,
  },
  phoneTitle: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "900",
    marginTop: 13,
  },
  phoneDetail: {
    fontSize: 9,
    lineHeight: 13,
    textAlign: "center",
    paddingHorizontal: 10,
    marginTop: 3,
  },
  backupPill: {
    position: "absolute",
    alignSelf: "center",
    bottom: -2,
    minHeight: 35,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    zIndex: 5,
  },
  backupText: { fontSize: 9, lineHeight: 12, fontWeight: "700" },
});
