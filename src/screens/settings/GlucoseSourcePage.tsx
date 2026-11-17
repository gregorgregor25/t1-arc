import { Pressable, StyleSheet, Text, View } from "react-native";

import { AutomationStatusCard } from "@/components/AutomationStatusCard";
import { SectionCard } from "@/components/SectionCard";
import { SourceHealthCard } from "@/components/SourceHealthCard";
import { ListGroup, ListRow, StatusLine } from "@/components/ui";
import { useLatestData } from "@/hooks/useTimeline";
import {
  NOT_TESTED_WITH_REAL_ACCOUNT_LABEL,
  SOURCE_CHOOSER_ANSWERS,
  SOURCE_MENU_SECTIONS,
  settingsMenuItem,
  type SourceJump,
} from "@/navigation/sourceNavigation";
import { useDataContext } from "@/providers/DataProvider";
import { useAppTheme } from "@/theme/theme";

import { SettingsDisclosure } from "./SettingsDisclosure";
import type { SettingsPageProps } from "./settingsPageTypes";
import { glucoseSourceSummary } from "./settingsStatus";

/**
 * Glucose source: the source in use with its health on top, every source
 * grouped by "on this phone" and "online account", then "Which source do I
 * need?". Each source keeps all of its own settings on its own page.
 */
export function GlucoseSourcePage({ expanded, toggle, openPage }: SettingsPageProps) {
  const { colors } = useAppTheme();
  const latest = useLatestData();
  const { now, refreshData, syncing } = useDataContext();
  const summary = glucoseSourceSummary({
    readingSourceId: latest.reading?.sourceId,
    readingTimestamp: latest.reading?.timestamp,
    sources: latest.sources,
    now,
  });
  const groups = SOURCE_MENU_SECTIONS.filter(
    (section) => section.id === "glucose-phone" || section.id === "glucose-online",
  );

  return (
    <View style={styles.sections}>
      <Text style={[styles.intro, { color: colors.textSecondary }]}>
        T1 Arc uses one source for your readings. You can change it any time.
      </Text>

      <ListGroup label="In use">
        <StatusLine
          action={
            summary.tone === "off"
              ? undefined
              : {
                  label: syncing ? "Checking…" : "Check now",
                  accessibilityHint: "Asks your sources for new readings now",
                  onPress: () => {
                    if (!syncing) void refreshData();
                  },
                }
          }
          detail={summary.detail}
          statusLabel={summary.statusLabel}
          title={summary.sourceLabel ?? (summary.tone === "off" ? summary.title : "Your glucose source")}
          tone={summary.tone}
        />
        {summary.page ? (
          <ListRow
            onPress={() => openPage(summary.page!)}
            title={`Settings for ${summary.sourceLabel ?? "this source"}`}
          />
        ) : null}
      </ListGroup>

      <SettingsDisclosure
        detail="When each connection last updated, its newest records and any gaps."
        expanded={expanded === "glucose-health"}
        icon="pulse-outline"
        onToggle={() => toggle("glucose-health")}
        title="Recent checks and history"
      >
        <SourceHealthCard />
      </SettingsDisclosure>
      <SettingsDisclosure
        detail="Runs quietly in the background. Open only if something needs attention."
        expanded={expanded === "glucose-automation"}
        icon="sync-outline"
        onToggle={() => toggle("glucose-automation")}
        title="Automatic updates"
      >
        <AutomationStatusCard />
      </SettingsDisclosure>

      <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
        {summary.page ? "Use a different source" : "Choose a source"}
      </Text>
      {groups.map((section) => (
        <ListGroup key={section.id} label={section.title}>
          {section.items.map((item) => {
            const inUse = item.source === summary.page;
            const untested = item.notTestedWithRealAccount
              ? ` · ${NOT_TESTED_WITH_REAL_ACCOUNT_LABEL.toLowerCase()}`
              : "";
            return (
              <ListRow
                accessibilityHint={`Opens ${item.label} settings`}
                detail={`${item.detail}${untested}`}
                key={item.source}
                onPress={() => openPage(item.source)}
                title={item.label}
                value={inUse ? "In use" : undefined}
              />
            );
          })}
        </ListGroup>
      ))}

      <SettingsDisclosure
        detail="Answer one question to find the right connection."
        expanded={expanded === "glucose-chooser"}
        icon="help-circle-outline"
        onToggle={() => toggle("glucose-chooser")}
        title="Which source do I need?"
      >
        <SourceChooser onSelect={openPage} />
      </SettingsDisclosure>
    </View>
  );
}

function SourceChooser({ onSelect }: { onSelect(source: SourceJump): void }) {
  const { colors, radius } = useAppTheme();
  return (
    <SectionCard>
      {SOURCE_CHOOSER_ANSWERS.map((item, index) => {
        const label = settingsMenuItem(item.source).label;
        return (
          <View
            key={item.source}
            style={[
              styles.chooserRow,
              index > 0 && {
                borderTopColor: colors.divider,
                borderTopWidth: StyleSheet.hairlineWidth,
              },
            ]}
          >
            <Text style={[styles.chooserQuestion, { color: colors.text }]}>
              {item.question}
            </Text>
            <Text style={[styles.chooserAnswer, { color: colors.textSecondary }]}>
              {item.answer}
            </Text>
            <Pressable
              accessibilityHint={`Opens ${label} settings`}
              accessibilityRole="button"
              onPress={() => onSelect(item.source)}
              style={({ pressed }) => [
                styles.chooserButton,
                {
                  borderColor: colors.primary,
                  borderRadius: radius.pill,
                  opacity: pressed ? 0.68 : 1,
                },
              ]}
            >
              <Text style={[styles.chooserButtonText, { color: colors.primary }]}>
                Open {label}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  sections: {
    marginTop: 4,
    gap: 14,
  },
  intro: {
    fontSize: 15,
    lineHeight: 21,
  },
  heading: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "700",
    marginTop: 8,
  },
  chooserRow: {
    paddingVertical: 12,
    gap: 4,
  },
  chooserQuestion: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
  },
  chooserAnswer: {
    fontSize: 13,
    lineHeight: 19,
  },
  chooserButton: {
    alignSelf: "flex-start",
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    marginTop: 6,
    justifyContent: "center",
  },
  chooserButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
  },
});
