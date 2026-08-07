import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MANUAL_CONTEXT_SOURCE_ID } from '@/data/manualContext';
import { EvidenceReference, buildContextEventEvidence } from '@/domain/insights';
import { HealthContextEvent, TimelineData } from '@/domain/models';
import { contextNoteCategoryLabel } from '@/domain/contextNotes';
import { formatTime } from '@/domain/time';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

function eventPresentation(event: HealthContextEvent) {
  switch (event.kind) {
    case 'meal':
      return {
        icon: 'restaurant-outline' as const,
        detail: `${event.carbsGrams} g carbohydrate`,
      };
    case 'activity':
      return {
        icon: 'walk-outline' as const,
        detail: `${event.durationMinutes} min · ${event.intensity}`,
      };
    case 'sleep': {
      const hours = Math.floor(event.durationMinutes / 60);
      const minutes = event.durationMinutes % 60;
      return {
        icon: 'moon-outline' as const,
        detail: `${hours}h ${minutes}m · ended ${formatTime(event.end)}`,
      };
    }
    case 'weight':
      return {
        icon: 'scale-outline' as const,
        detail: `${event.kilograms.toFixed(1)} kg`,
      };
    case 'medication':
      return {
        icon: 'medical-outline' as const,
        detail:
          event.amount !== undefined
            ? `${event.amount}${event.unit ? ` ${event.unit}` : ''}`
            : 'Recorded event',
      };
    case 'note':
      return {
        icon:
          event.category === 'pump'
            ? ('water-outline' as const)
            : event.category === 'sensor'
              ? ('radio-outline' as const)
              : ('document-text-outline' as const),
        detail: event.detail
          ? `${contextNoteCategoryLabel(event.category)} · ${event.detail}`
          : contextNoteCategoryLabel(event.category),
      };
  }
}

export function ContextEventList({
  events,
  limit = 8,
  onEditManualContext,
  onInspect,
  timeline,
}: {
  events: HealthContextEvent[];
  limit?: number;
  onEditManualContext?(event: HealthContextEvent): void;
  onInspect?(evidence: EvidenceReference): void;
  timeline?: TimelineData;
}) {
  const { colors } = useAppTheme();
  if (events.length === 0) return null;
  const visible = [...events]
    .sort((a, b) => b.start - a.start)
    .slice(0, limit);
  const synthetic = events.every((event) => event.origin === 'synthetic');

  return (
    <SectionCard style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.eyebrow, { color: colors.accent }]}>CONTEXT</Text>
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
        const presentation = eventPresentation(event);
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
                  ? 'Opens the exact event with nearby glucose and insulin records'
                  : undefined
              }
              accessibilityLabel={`${event.title}, ${presentation.detail}, ${formatTime(event.start)}`}
              accessibilityRole={onInspect && timeline ? 'button' : undefined}
              disabled={!onInspect || !timeline}
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
                style={[
                  styles.icon,
                  { backgroundColor: `${colors.accent}16` },
                ]}
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
                  {event.title}
                </Text>
                <Text style={[styles.detail, { color: colors.textSecondary }]}>
                  {presentation.detail}
                </Text>
              </View>
              <Text style={[styles.time, { color: colors.textTertiary }]}>
                {formatTime(event.start)}
              </Text>
              {onInspect && timeline ? (
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.textTertiary}
                  name="chevron-forward"
                  size={17}
                />
              ) : null}
            </Pressable>
            {event.origin === 'manual' &&
            event.sourceId === MANUAL_CONTEXT_SOURCE_ID &&
            onEditManualContext ? (
              <Pressable
                accessibilityLabel={`Edit ${event.title}`}
                accessibilityRole="button"
                hitSlop={4}
                onPress={() => onEditManualContext(event)}
                style={({ pressed }) => [
                  styles.editButton,
                  {
                    backgroundColor: pressed
                      ? `${colors.primary}12`
                      : 'transparent',
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
          </View>
        );
      })}
      {events.length > visible.length ? (
        <Text style={[styles.more, { color: colors.textTertiary }]}>
          Showing {visible.length} of {events.length} context events
        </Text>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  eyebrow: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
  },
  badge: {
    fontSize: 9,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  row: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  editButton: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
  },
  eventTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  detail: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 1,
  },
  time: {
    fontSize: 11,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
  more: {
    fontSize: 11,
    lineHeight: 17,
    paddingTop: 10,
  },
});
