import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import {
  MANUAL_CONTEXT_SOURCE_ID,
  manualKetoneDraftFromEvent,
} from "@/data/manualContext";
import { formatManualKetoneTitle } from "@/data/manualKetones";
import {
  EvidenceReference,
  buildContextEventEvidence,
} from "@/domain/insights";
import { HealthContextEvent, TimelineData } from "@/domain/models";
import {
  contextNoteCategoryLabel,
  contextNoteDisplayTitle,
} from "@/domain/contextNotes";
import { mealNutritionSummary } from "@/domain/mealNutrition";
import { toDateKey } from "@/domain/time";
import { rangeSpansMultipleDates } from "@/domain/timelinePresentation";
import { formatRegionalNumber, formatWeight } from "@/domain/regionalFormat";
import { useAppTheme } from "@/theme/theme";
import { useRegionalProfile } from "@/providers/RegionalProfileProvider";

import { SectionCard } from "./SectionCard";
import { healthMetricIntervalPresentation } from "./healthMetrics/presentation";

function eventPresentation(
  event: HealthContextEvent,
  regional: Parameters<typeof formatWeight>[1],
) {
  const ketone = manualKetoneDraftFromEvent(event);
  if (ketone) {
    return {
      icon: "flask-outline" as const,
      detail:
        ketone.ketoneType === "blood"
          ? `${formatRegionalNumber(ketone.value, regional.locale)} mmol/L · manual blood reading`
          : `${ketone.value === "negative" ? "Negative" : ketone.value === "trace" ? "Trace" : ketone.value} · manual urine strip`,
    };
  }
  switch (event.kind) {
    case "meal":
      return {
        icon: "restaurant-outline" as const,
        detail: mealNutritionSummary(event, { includeItems: true }),
      };
    case "activity":
      return {
        icon: "walk-outline" as const,
        detail:
          event.intensity === "unspecified"
            ? `${formatRegionalNumber(event.durationMinutes, regional.locale, { maximumFractionDigits: 0 })} min`
            : `${formatRegionalNumber(event.durationMinutes, regional.locale, { maximumFractionDigits: 0 })} min · ${event.intensity}`,
      };
    case "sleep": {
      const hours = Math.floor(event.durationMinutes / 60);
      const minutes = event.durationMinutes % 60;
      return {
        icon: "moon-outline" as const,
        detail: `${formatRegionalNumber(hours, regional.locale, { maximumFractionDigits: 0 })}h ${formatRegionalNumber(minutes, regional.locale, { maximumFractionDigits: 0 })}m`,
      };
    }
    case "weight":
      return {
        icon: "scale-outline" as const,
        detail: formatWeight(event.kilograms, regional),
      };
    case "medication":
      return {
        icon: "medical-outline" as const,
        detail:
          event.amount !== undefined
            ? `${formatRegionalNumber(event.amount, regional.locale)}${event.unit ? ` ${event.unit}` : ""}`
            : "Recorded event",
      };
    case "note":
      return {
        icon:
          event.category === "pump"
            ? ("water-outline" as const)
            : event.category === "sensor"
              ? ("radio-outline" as const)
              : ("document-text-outline" as const),
        detail: event.detail
          ? `${contextNoteCategoryLabel(event.category)} · ${event.detail}`
          : contextNoteCategoryLabel(event.category),
      };
  }
}

function contextEventEnd(event: HealthContextEvent) {
  if (event.end !== undefined) return event.end;
  if (event.kind === "activity") {
    return event.start + event.durationMinutes * 60_000;
  }
  return undefined;
}

export function ContextEventList({
  events,
  limit = 8,
  onDeleteManualKetone,
  onEditManualContext,
  onInspect,
  timeline,
}: {
  events: HealthContextEvent[];
  limit?: number;
  onDeleteManualKetone?(id: string): Promise<boolean>;
  onEditManualContext?(event: HealthContextEvent): void;
  onInspect?(evidence: EvidenceReference): void;
  timeline?: TimelineData;
}) {
  const { colors } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const [deletingId, setDeletingId] = useState<string>();
  const [deletedIds, setDeletedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [expanded, setExpanded] = useState(false);
  const retainedEvents = events.filter((event) => !deletedIds.has(event.id));
  if (retainedEvents.length === 0) return null;
  const visible = [...retainedEvents]
    .sort((a, b) => b.start - a.start)
    .slice(0, expanded ? retainedEvents.length : limit);
  const synthetic = retainedEvents.every(
    (event) => event.origin === "synthetic",
  );
  const timelineSpansMultipleDates = timeline
    ? rangeSpansMultipleDates(timeline.range)
    : false;
  const showEventDates = timeline
    ? timelineSpansMultipleDates
    : new Set(retainedEvents.map((event) => toDateKey(event.start))).size > 1;
  const selectedDate =
    timeline && !timelineSpansMultipleDates
      ? toDateKey(timeline.range.start)
      : undefined;

  async function removeManualKetone(id: string) {
    if (!onDeleteManualKetone || deletingId) return;
    setDeletingId(id);
    try {
      const deleted = await onDeleteManualKetone(id);
      if (deleted) {
        setDeletedIds((current) => new Set(current).add(id));
      } else {
        Alert.alert(
          "Ketone reading not removed",
          "This reading may already have been removed. Pull down to refresh, then try again.",
        );
      }
    } catch {
      Alert.alert(
        "Couldn't remove ketone reading",
        "T1 Arc couldn't remove this reading. Pull down to refresh, then try again.",
      );
    } finally {
      setDeletingId(undefined);
    }
  }

  function confirmRemoveManualKetone(id: string, title: string) {
    if (!onDeleteManualKetone || deletingId) return;
    Alert.alert(
      "Remove this ketone reading?",
      `"${title}" will be permanently removed from T1 Arc.`,
      [
        { text: "Keep reading", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => void removeManualKetone(id),
        },
      ],
    );
  }

  return (
    <SectionCard style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.eyebrow, { color: colors.accent }]}>
            CONTEXT
          </Text>
          <Text style={[styles.title, { color: colors.text }]}>
            Around the timeline
          </Text>
        </View>
        {synthetic ? (
          <Text style={[styles.badge, { color: colors.primary }]}>
            DEMO CONTEXT
          </Text>
        ) : null}
      </View>
      {visible.map((event, index) => {
        const presentation = eventPresentation(event, regional);
        const ketone = manualKetoneDraftFromEvent(event);
        const displayTitle = ketone
          ? formatManualKetoneTitle(
              ketone.ketoneType === "blood"
                ? { ketoneType: "blood", value: ketone.value }
                : { ketoneType: "urine", value: ketone.value },
              regional.locale,
            )
          : event.kind === "note"
            ? contextNoteDisplayTitle(event, regional)
            : event.title;
        const interval = healthMetricIntervalPresentation({
          end: contextEventEnd(event),
          forceDates: showEventDates,
          selectedDate,
          start: event.start,
        });
        const rowDeleting = deletingId === event.id;
        const anyDeletionPending = deletingId !== undefined;
        return (
          <View
            key={event.id}
            style={[
              styles.row,
              index < visible.length - 1 && {
                borderBottomColor: colors.divider,
                borderBottomWidth: StyleSheet.hairlineWidth,
              },
            ]}
          >
            <Pressable
              accessibilityHint={
                onInspect && timeline
                  ? "Opens the exact event with nearby glucose and insulin records"
                  : undefined
              }
              accessibilityLabel={`${displayTitle}, ${presentation.detail}, ${interval.accessibilityLabel}`}
              accessibilityRole={onInspect && timeline ? "button" : undefined}
              accessibilityState={rowDeleting ? { disabled: true } : undefined}
              disabled={!onInspect || !timeline || rowDeleting}
              onPress={() =>
                timeline &&
                onInspect?.(buildContextEventEvidence(event, timeline))
              }
              style={({ pressed }) => [
                styles.rowContent,
                pressed && {
                  backgroundColor: `${colors.primary}0A`,
                },
              ]}
            >
              <View
                style={[styles.icon, { backgroundColor: `${colors.accent}16` }]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.accent}
                  name={presentation.icon}
                  size={19}
                />
              </View>
              <View style={styles.copy}>
                <Text style={[styles.eventTitle, { color: colors.text }]}>
                  {displayTitle}
                </Text>
                <Text style={[styles.detail, { color: colors.textSecondary }]}>
                  {presentation.detail}
                </Text>
              </View>
              <View style={styles.timeBlock}>
                <Text style={[styles.time, { color: colors.textTertiary }]}>
                  {interval.startLabel}
                </Text>
                {interval.endLabel ? (
                  <Text
                    style={[styles.endTime, { color: colors.textTertiary }]}
                  >
                    to {interval.endLabel}
                  </Text>
                ) : null}
              </View>
              {onInspect && timeline ? (
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.textTertiary}
                  name="chevron-forward"
                  size={17}
                />
              ) : null}
            </Pressable>
            {event.origin === "manual" &&
            event.sourceId === MANUAL_CONTEXT_SOURCE_ID &&
            onEditManualContext ? (
              <Pressable
                accessibilityLabel={`Edit ${displayTitle}`}
                accessibilityRole="button"
                accessibilityState={{ disabled: rowDeleting }}
                disabled={rowDeleting}
                hitSlop={4}
                onPress={() => onEditManualContext(event)}
                style={({ pressed }) => [
                  styles.editButton,
                  {
                    backgroundColor: pressed
                      ? `${colors.primary}12`
                      : "transparent",
                    opacity: rowDeleting ? 0.45 : 1,
                  },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.primary}
                  name="create-outline"
                  size={18}
                />
              </Pressable>
            ) : null}
            {ketone && onDeleteManualKetone ? (
              <Pressable
                accessibilityHint="Removes this manually entered ketone reading after confirmation"
                accessibilityLabel={`Delete ${displayTitle}`}
                accessibilityRole="button"
                accessibilityState={{ disabled: anyDeletionPending }}
                disabled={anyDeletionPending}
                hitSlop={4}
                onPress={() =>
                  confirmRemoveManualKetone(event.id, displayTitle)
                }
                style={({ pressed }) => [
                  styles.editButton,
                  {
                    backgroundColor: pressed
                      ? `${colors.danger}16`
                      : "transparent",
                    opacity: anyDeletionPending ? 0.45 : 1,
                  },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.danger}
                  name="trash-outline"
                  size={18}
                />
              </Pressable>
            ) : null}
          </View>
        );
      })}
      {retainedEvents.length > visible.length ? (
        <Pressable
          accessibilityHint="Shows every context entry in this list"
          accessibilityLabel={`Show all ${formatRegionalNumber(retainedEvents.length, regional.locale, { maximumFractionDigits: 0 })} context events`}
          accessibilityRole="button"
          onPress={() => setExpanded(true)}
          style={({ pressed }) => [
            styles.moreButton,
            {
              backgroundColor: pressed ? `${colors.primary}12` : "transparent",
            },
          ]}
        >
          <Text style={[styles.more, { color: colors.primary }]}>
            Show all{" "}
            {formatRegionalNumber(retainedEvents.length, regional.locale, {
              maximumFractionDigits: 0,
            })}{" "}
            context events
          </Text>
        </Pressable>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 8,
  },
  eyebrow: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 1,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
  },
  badge: {
    fontSize: 9,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 0.7,
  },
  row: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "stretch",
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
  },
  editButton: {
    width: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: {
    flex: 1,
  },
  eventTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  detail: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 1,
  },
  time: {
    fontSize: 11,
    lineHeight: 16,
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  timeBlock: {
    alignItems: "flex-end",
    flexShrink: 0,
    maxWidth: 128,
  },
  endTime: {
    fontSize: 10,
    lineHeight: 14,
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  more: {
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "700",
  },
  moreButton: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    marginTop: 4,
    paddingHorizontal: 4,
  },
});
