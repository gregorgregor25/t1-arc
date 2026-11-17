import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  TARVIS_SHORT_LIST_VISIBLE,
  type TarvisShortAnswer,
} from "@/data/tarvis/shortAnswer";
import { glucoseTone } from "@/domain/glucoseAppearance";
import { useGlucoseAppearance } from "@/providers/GlucoseAppearanceProvider";
import { useAppTheme } from "@/theme/theme";

interface Props {
  model: TarvisShortAnswer;
  /** Evidence and guidance links shown inside Details. */
  details?: ReactNode;
  /** Small icon buttons on the card footer. */
  footer?: ReactNode;
}

/**
 * One Tarv1s answer, short answer first: label, the answer, one context
 * line, an extra line only when it changes the meaning, then a collapsed
 * Details section. Safety text is always shown in full.
 */
const SPOKEN_UNITS: Readonly<Record<string, string>> = {
  "%": "percent",
  "mmol/L": "millimoles per litre",
  "mg/dL": "milligrams per decilitre",
  U: "units",
  g: "grams",
};

/** The value alone; the label above it is read separately, so it is not repeated. */
function spokenValue(text: string, unit: string | undefined) {
  return unit ? `${text} ${SPOKEN_UNITS[unit] ?? unit}` : text;
}

export function TarvisShortAnswerCard({ model, details, footer }: Props) {
  const { colors, radius, dark } = useAppTheme();
  const { settings: appearance } = useGlucoseAppearance();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const value = model.value;
  const valueColor = !value
    ? colors.text
    : value.tone === "glucose" && value.mmolL !== undefined
      ? glucoseTone(value.mmolL, "current", appearance, dark)
      : value.tone === "target"
        ? glucoseTone((appearance.targetMin + appearance.targetMax) / 2, "current", appearance, dark)
        : colors.text;
  const shownItems = listOpen ? model.listItems : model.listItems.slice(0, TARVIS_SHORT_LIST_VISIBLE);
  const hiddenItems = model.listItems.length - shownItems.length;
  // Alert styling only for urgent advice in a safety box; a large label only for the
  // phone's own urgent safety answers, never for a label an AI connection wrote.
  const urgent = Boolean(model.urgent && model.safety);
  const urgentLabel = urgent && model.urgentLabel === true;
  const hasDetails = Boolean(
    model.exactPeriod || model.detailText.length || model.limitations.length || details || model.source,
  );

  return (
    <View style={styles.card}>
      {urgentLabel ? (
        // Large, but not a second alert: the safety box is the card's only assertive region.
        <Text accessibilityRole="header" style={[styles.urgentLabel, { color: colors.text }]}>
          {model.label}
        </Text>
      ) : (
        <Text style={[styles.label, { color: colors.textSecondary }]}>{model.label}</Text>
      )}
      {value ? (
        <View
          accessible
          accessibilityLabel={spokenValue(value.text, value.unit)}
          style={styles.valueRow}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.value, { color: valueColor }]}>
            {value.text}
          </Text>
          {value.unit ? (
            <Text style={[styles.unit, { color: colors.textSecondary }]}>{value.unit}</Text>
          ) : null}
        </View>
      ) : model.headline ? (
        <Text style={[styles.headline, { color: colors.text }]}>{model.headline}</Text>
      ) : null}

      {/* Warnings and urgent advice sit above any list, so they are never behind "Show all". */}
      {model.safety ? (
        <View
          {...(urgent ? { accessibilityRole: "alert" as const, accessibilityLiveRegion: "assertive" as const } : {})}
          style={[
            styles.safety,
            { backgroundColor: colors.surfaceMuted, borderColor: colors.warning, borderRadius: radius.md },
          ]}
        >
          <Ionicons accessibilityElementsHidden color={colors.warning} name="medical-outline" size={17} />
          <View style={styles.safetyBody}>
            <Text style={[urgent ? styles.urgentSafetyText : styles.safetyText, { color: colors.text }]}>
              {model.safety}
            </Text>
            {model.safetyNotes?.map((note, index) => (
              <Text key={`${index}:${note.slice(0, 24)}`} style={[styles.safetyNote, { color: colors.textSecondary }]}>
                {note}
              </Text>
            ))}
          </View>
        </View>
      ) : null}

      {shownItems.length ? (
        <View style={styles.list}>
          {shownItems.map((item, index) => (
            <View key={`${item}:${index}`} style={styles.listItem}>
              <View style={[styles.bullet, { backgroundColor: colors.accent }]} />
              <Text style={[styles.listText, { color: colors.text }]}>{item}</Text>
            </View>
          ))}
          {hiddenItems > 0 || listOpen ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: listOpen }}
              onPress={() => setListOpen((open) => !open)}
              style={({ pressed }) => [styles.inlineAction, { opacity: pressed ? 0.65 : 1 }]}
            >
              <Text style={[styles.inlineActionText, { color: colors.primary }]}>
                {listOpen ? "Show fewer" : `Show all ${model.listItems.length}`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {model.context ? (
        <View accessible accessibilityLabel={model.context} style={styles.contextRow}>
          <Ionicons accessibilityElementsHidden color={colors.textTertiary} name="analytics-outline" size={14} />
          <Text style={[styles.context, { color: colors.textTertiary }]}>{model.context}</Text>
        </View>
      ) : null}

      {model.meaning ? (
        <View style={styles.meaningRow}>
          <Ionicons accessibilityElementsHidden color={colors.warning} name="information-circle-outline" size={15} />
          <Text style={[styles.meaning, { color: colors.textSecondary }]}>{model.meaning}</Text>
        </View>
      ) : null}

      {hasDetails ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Details"
          accessibilityState={{ expanded: detailsOpen }}
          onPress={() => setDetailsOpen((open) => !open)}
          style={({ pressed }) => [styles.detailsToggle, { borderColor: colors.divider, opacity: pressed ? 0.65 : 1 }]}
        >
          <Text style={[styles.detailsToggleText, { color: colors.primary }]}>Details</Text>
          <Ionicons
            accessibilityElementsHidden
            color={colors.primary}
            name={detailsOpen ? "chevron-up" : "chevron-down"}
            size={17}
          />
        </Pressable>
      ) : null}

      {detailsOpen ? (
        <View style={styles.details}>
          {model.exactPeriod ? (
            <Text style={[styles.detailMeta, { color: colors.textSecondary }]}>{model.exactPeriod}</Text>
          ) : null}
          {model.detailText.map((paragraph, index) => (
            <Text key={`${index}:${paragraph.slice(0, 24)}`} style={[styles.detailText, { color: colors.textSecondary }]}>
              {paragraph}
            </Text>
          ))}
          {details}
          {model.limitations.length ? (
            <View style={[styles.limitations, { borderColor: colors.divider }]}>
              <Text style={[styles.limitationsTitle, { color: colors.textSecondary }]}>Worth keeping in mind</Text>
              {model.limitations.map((item, index) => (
                <Text key={`${index}:${item.slice(0, 24)}`} style={[styles.limitation, { color: colors.textTertiary }]}>
                  • {item}
                </Text>
              ))}
            </View>
          ) : null}
          <Text style={[styles.source, { color: colors.textTertiary }]}>{model.source}</Text>
        </View>
      ) : null}

      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 6 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
  urgentLabel: { fontSize: 20, lineHeight: 26, fontWeight: "800" },
  valueRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  value: { fontSize: 40, lineHeight: 46, fontWeight: "800", fontVariant: ["tabular-nums"] },
  unit: { fontSize: 16, lineHeight: 22, fontWeight: "600" },
  headline: { fontSize: 17, lineHeight: 24, fontWeight: "700" },
  list: { gap: 6, marginTop: 2 },
  listItem: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 8 },
  listText: { flex: 1, fontSize: 15, lineHeight: 21 },
  inlineAction: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  inlineActionText: { fontSize: 14, fontWeight: "700" },
  safety: { flexDirection: "row", alignItems: "flex-start", gap: 9, padding: 12, borderWidth: 1 },
  safetyBody: { flex: 1, gap: 6 },
  safetyText: { fontSize: 15, lineHeight: 22 },
  urgentSafetyText: { fontSize: 17, lineHeight: 24, fontWeight: "700" },
  safetyNote: { fontSize: 13, lineHeight: 19 },
  contextRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  context: { flex: 1, fontSize: 13, lineHeight: 18 },
  meaningRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  meaning: { flex: 1, fontSize: 13, lineHeight: 18 },
  detailsToggle: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  detailsToggleText: { fontSize: 14, fontWeight: "700" },
  details: { gap: 9 },
  detailMeta: { fontSize: 13, lineHeight: 18 },
  detailText: { fontSize: 14, lineHeight: 21 },
  limitations: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 9, gap: 4 },
  limitationsTitle: { fontSize: 13, fontWeight: "700" },
  limitation: { fontSize: 13, lineHeight: 19 },
  source: { fontSize: 12, lineHeight: 17 },
  footer: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 4 },
});
