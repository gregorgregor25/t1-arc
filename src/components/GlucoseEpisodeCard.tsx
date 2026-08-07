import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  buildGlucoseEpisodeEvidence,
  detectGlucoseEpisodes,
  EvidenceReference,
  glucoseEpisodeDurationMinutes,
  rankGlucoseEpisodes,
} from '@/domain/insights';
import { TimelineData } from '@/domain/models';
import { formatTime } from '@/domain/time';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

export function GlucoseEpisodeCard({
  data,
  onInspect,
}: {
  data: TimelineData;
  onInspect(evidence: EvidenceReference): void;
}) {
  const { colors, radius } = useAppTheme();
  const episodes = rankGlucoseEpisodes(
    [
      ...detectGlucoseEpisodes(data.glucose, 'high'),
      ...detectGlucoseEpisodes(data.glucose, 'low'),
    ],
    3,
  );
  if (!episodes.length) return null;

  return (
    <SectionCard>
      <View style={styles.header}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>
            Glucose episodes
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Largest observed high and low periods on this date.
          </Text>
        </View>
        <Text style={[styles.count, { color: colors.primary }]}>
          TOP {episodes.length}
        </Text>
      </View>
      <View style={styles.rows}>
        {episodes.map((episode) => {
          const evidence = buildGlucoseEpisodeEvidence(episode, data);
          const tone =
            episode.kind === 'high' ? colors.warning : colors.danger;
          const nearby =
            evidence.recordIds.length - episode.readings.length;
          return (
            <Pressable
              key={episode.id}
              accessibilityLabel={`Inspect ${episode.kind} glucose episode reaching ${episode.extremeMmolL.toFixed(1)} millimoles per litre`}
              accessibilityRole="button"
              onPress={() => onInspect(evidence)}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderColor: `${tone}44`,
                  borderRadius: radius.md,
                  opacity: pressed ? 0.68 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.icon,
                  { backgroundColor: `${tone}18`, borderRadius: radius.sm },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={tone}
                  name={
                    episode.kind === 'high'
                      ? 'trending-up-outline'
                      : 'trending-down-outline'
                  }
                  size={20}
                />
              </View>
              <View style={styles.copy}>
                <Text style={[styles.kind, { color: tone }]}>
                  {episode.kind === 'high' ? 'OBSERVED HIGH' : 'OBSERVED LOW'}
                </Text>
                <Text style={[styles.value, { color: colors.text }]}>
                  {episode.extremeMmolL.toFixed(1)} mmol/L
                </Text>
                <Text style={[styles.detail, { color: colors.textSecondary }]}>
                  {formatTime(episode.start)}–{formatTime(episode.end)} ·{' '}
                  {glucoseEpisodeDurationMinutes(episode)} min ·{' '}
                  {episode.readings.length} readings
                </Text>
                <Text style={[styles.nearby, { color: colors.textTertiary }]}>
                  {nearby
                    ? `${nearby} nearby insulin/context records included`
                    : 'No nearby insulin/context records found'}
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
        })}
      </View>
      <Text style={[styles.footnote, { color: colors.textTertiary }]}>
        Nearby records are for inspection only. T1 Arc does not claim they
        caused an episode.
      </Text>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  count: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginTop: 3,
  },
  rows: {
    gap: 8,
    marginTop: 14,
  },
  row: {
    minHeight: 92,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  icon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
  },
  kind: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  value: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    marginTop: 1,
  },
  detail: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 1,
  },
  nearby: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
  footnote: {
    fontSize: 10,
    lineHeight: 16,
    marginTop: 12,
  },
});
