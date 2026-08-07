import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { DataSourceStatus, GlucoseReading } from '@/domain/models';
import { freshnessCopy } from '@/domain/freshness';
import {
  GLUCOSE_RANGE_LABELS,
  glucoseRangeForValue,
  glucoseTone,
} from '@/domain/glucoseAppearance';
import { formatTime, relativeAge } from '@/domain/time';
import {
  assessGlucoseTrend,
  GlucoseTrendAssessment,
  presentTrend,
} from '@/domain/trend';
import { useGlucoseAppearance } from '@/providers/GlucoseAppearanceProvider';
import { useAppTheme } from '@/theme/theme';
import { DIRECT_LIBRE_LINKUP_SOURCE_ID } from '@/data/libreLinkUp/constants';
import { GLOOKO_CGM_SOURCE_ID } from '@/data/import/glookoCsv';
import { NOTIFICATION_SOURCE_ID } from '@/data/notification/types';
import { NIGHTSCOUT_SOURCE_ID } from '@/data/nightscout/types';
import { XDRIP_SOURCE_ID } from '@/data/xdrip/types';

import { StatusPill } from './StatusPill';

export function CurrentGlucoseCard({
  reading,
  source,
  now,
  trendAssessment,
  onChooseSource,
}: {
  reading?: GlucoseReading;
  source?: DataSourceStatus;
  now: number;
  trendAssessment?: GlucoseTrendAssessment;
  onChooseSource?(): void;
}) {
  const { colors, dark, radius } = useAppTheme();
  const { settings: appearance } = useGlucoseAppearance();
  const [trendDetailsVisible, setTrendDetailsVisible] = useState(false);
  const freshness = source?.freshness ?? 'missing';
  const isStale = freshness === 'stale';
  const assessment =
    trendAssessment ?? assessGlucoseTrend(reading, reading ? [reading] : []);
  const trend = presentTrend(assessment.direction);
  const age = relativeAge(reading?.timestamp, now);
  const valueTone = glucoseTone(
    reading?.mmolL,
    freshness,
    appearance,
    dark,
  );
  const valueRange = glucoseRangeForValue(
    reading?.mmolL,
    freshness,
    appearance,
  );
  const trendIcon: keyof typeof Ionicons.glyphMap =
    assessment.direction === 'doubleDown' ||
    assessment.direction === 'down' ||
    assessment.direction === 'slightDown'
      ? 'trending-down-outline'
      : assessment.direction === 'flat'
        ? 'remove-outline'
        : assessment.direction === 'unknown' || !reading
          ? 'help-outline'
          : 'trending-up-outline';
  const trendLabel =
    assessment.origin === 'calculated'
      ? `${trend.label} (calculated)`
      : trend.label;
  const sourceLabel =
    !reading && !source?.isLive
      ? 'No glucose source connected'
      : reading?.sourceId === DIRECT_LIBRE_LINKUP_SOURCE_ID
      ? 'Direct LibreLinkUp'
      : reading?.sourceId === NOTIFICATION_SOURCE_ID
        ? 'Phone notification source'
        : reading?.sourceId === GLOOKO_CGM_SOURCE_ID
          ? 'Glooko glucose history'
          : reading?.sourceId === NIGHTSCOUT_SOURCE_ID
            ? 'Nightscout'
          : reading?.sourceId === XDRIP_SOURCE_ID
            ? 'xDrip-compatible endpoint'
          : source?.origin === 'synthetic'
            ? 'Synthetic T1 Arc feed'
            : source?.detail ?? 'No glucose source connected';

  return (
    <LinearGradient
      accessibilityLabel={
        reading
          ? isStale
            ? `Last known glucose ${reading.mmolL.toFixed(1)} millimoles per litre, shown struck through because it is stale. Updated ${age}.`
            : `Current glucose ${reading.mmolL.toFixed(1)} millimoles per litre, ${trendLabel}. ${freshnessCopy[freshness].label}, updated ${age}.`
          : 'Current glucose is unavailable.'
      }
      colors={
        isStale
          ? dark
            ? [colors.surfaceElevated, colors.surface, colors.background]
            : [colors.surfaceMuted, colors.surface, colors.background]
          : dark
          ? ['#16424C', '#10272D', '#102328']
          : ['#D8F4F6', '#F3FBFC', '#FFFFFF']
      }
      end={{ x: 0.9, y: 1 }}
      start={{ x: 0, y: 0 }}
      style={[
        styles.card,
        {
          borderColor: colors.border,
          borderRadius: radius.xl,
          shadowColor: colors.shadow,
        },
      ]}
    >
      <View style={styles.topRow}>
        <View>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            {isStale ? 'LAST KNOWN GLUCOSE' : 'CURRENT GLUCOSE'}
          </Text>
          <Text style={[styles.source, { color: colors.textTertiary }]}>
            {sourceLabel}
          </Text>
        </View>
        <StatusPill freshness={freshness} />
      </View>

      {reading ? (
        <>
          <View style={styles.readingRow}>
            <Text
              maxFontSizeMultiplier={1.3}
              style={[
                styles.value,
                { color: valueTone },
                isStale && {
                  textDecorationColor: valueTone,
                  textDecorationLine: 'line-through',
                  textDecorationStyle: 'solid',
                },
              ]}
            >
              {reading.mmolL.toFixed(1)}
            </Text>
            <View style={styles.unitBlock}>
              <Text
                style={[
                  styles.arrow,
                  { color: valueTone },
                  isStale && {
                    textDecorationColor: valueTone,
                    textDecorationLine: 'line-through',
                    textDecorationStyle: 'solid',
                  },
                ]}
              >
                {trend.arrow}
              </Text>
              <Text style={[styles.unit, { color: colors.textSecondary }]}>
                mmol/L
              </Text>
            </View>
          </View>
          <View style={styles.footer}>
            {isStale ? (
              <View style={styles.detailRow}>
                <Ionicons
                  accessibilityElementsHidden
                  name="alert-circle-outline"
                  color={valueTone}
                  size={18}
                />
                <Text style={[styles.detailStrong, { color: colors.text }]}>
                  Stale · last known reading
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.detailRow}>
                  <Ionicons
                    accessibilityElementsHidden
                    name={trendIcon}
                    color={valueTone}
                    size={18}
                  />
                  <Text style={[styles.detailStrong, { color: colors.text }]}>
                    {trendLabel}
                  </Text>
                </View>
                <View
                  style={[
                    styles.rangePill,
                    {
                      backgroundColor: `${valueTone}18`,
                      borderColor: `${valueTone}66`,
                    },
                  ]}
                >
                  <View
                    accessibilityElementsHidden
                    style={[styles.rangeDot, { backgroundColor: valueTone }]}
                  />
                  <Text style={[styles.rangeText, { color: valueTone }]}>
                    {GLUCOSE_RANGE_LABELS[valueRange]}
                  </Text>
                </View>
              </>
            )}
            <View style={styles.detailRow}>
              <Ionicons
                accessibilityElementsHidden
                name="time-outline"
                color={colors.textSecondary}
                size={18}
              />
              <Text style={[styles.detail, { color: colors.textSecondary }]}>
                {age}
              </Text>
            </View>
          </View>
          {!isStale && assessment.origin === 'calculated' ? (
            <Pressable
              accessibilityHint="Opens the exact readings used for this fallback"
              accessibilityRole="button"
              onPress={() => setTrendDetailsVisible(true)}
              style={({ pressed }) => [
                styles.calculatedTrend,
                {
                  backgroundColor: `${colors.accent}12`,
                  borderColor: `${colors.accent}44`,
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={colors.accent}
                name="analytics-outline"
                size={16}
              />
              <Text style={[styles.calculatedTrendText, { color: colors.accent }]}>
                Calculated from {assessment.supportingReadings.length} readings
                {' · '}inspect
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : (
        <View style={styles.missing}>
          <Text style={[styles.missingTitle, { color: colors.text }]}>No reading</Text>
          <Text style={[styles.detail, { color: colors.textSecondary }]}>
            {source?.isLive
              ? 'The connected glucose source has not supplied a usable value.'
              : 'Connect a glucose source whenever you are ready.'}
          </Text>
          {!source?.isLive && onChooseSource ? (
            <Pressable
              accessibilityHint="Opens the list of supported glucose sources."
              accessibilityRole="button"
              onPress={onChooseSource}
              style={({ pressed }) => [
                styles.chooseSourceButton,
                {
                  backgroundColor: colors.primary,
                  borderRadius: radius.md,
                  opacity: pressed ? 0.74 : 1,
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={colors.onPrimary}
                name="git-network-outline"
                size={19}
              />
              <Text
                style={[
                  styles.chooseSourceButtonText,
                  { color: colors.onPrimary },
                ]}
              >
                Choose glucose source
              </Text>
              <Ionicons
                accessibilityElementsHidden
                color={colors.onPrimary}
                name="arrow-forward"
                size={18}
              />
            </Pressable>
          ) : null}
        </View>
      )}
      <Modal
        animationType="fade"
        onRequestClose={() => setTrendDetailsVisible(false)}
        statusBarTranslucent
        transparent
        visible={trendDetailsVisible}
      >
        <View style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}>
          <View
            accessibilityViewIsModal
            style={[
              styles.modalCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radius.xl,
              },
            ]}
          >
            <View style={styles.modalHeading}>
              <View style={styles.modalHeadingCopy}>
                <Text style={[styles.modalEyebrow, { color: colors.accent }]}>
                  TRANSPARENT FALLBACK
                </Text>
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  Source direction unavailable
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Close calculated trend details"
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => setTrendDetailsVisible(false)}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.textSecondary}
                  name="close"
                  size={25}
                />
              </Pressable>
            </View>
            <Text style={[styles.modalBody, { color: colors.textSecondary }]}>
              T1 Arc fitted one direction across{' '}
              {assessment.supportingReadings.length} recent readings from the
              same source over {assessment.windowMinutes ?? 0} minutes. The
              observed rate was{' '}
              {assessment.rateMmolLPerFiveMinutes?.toFixed(2) ?? '—'} mmol/L
              per 5 minutes. This is not a sensor-provided arrow and is not for
              dosing decisions.
            </Text>
            <View style={[styles.evidenceList, { borderColor: colors.border }]}>
              {assessment.supportingReadings.map((item, index) => (
                <View
                  key={`${item.id}:${item.timestamp}`}
                  style={[
                    styles.evidenceRow,
                    index > 0 && { borderTopColor: colors.border, borderTopWidth: 1 },
                  ]}
                >
                  <Text style={[styles.evidenceTime, { color: colors.textSecondary }]}>
                    {formatTime(item.timestamp)}
                  </Text>
                  <Text style={[styles.evidenceValue, { color: colors.text }]}>
                    {item.mmolL.toFixed(1)} mmol/L
                  </Text>
                </View>
              ))}
            </View>
            <Text style={[styles.sourceEvidence, { color: colors.textTertiary }]}>
              Source: {reading?.sourceId ?? 'Unavailable'}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setTrendDetailsVisible(false)}
              style={({ pressed }) => [
                styles.modalButton,
                {
                  backgroundColor: colors.primary,
                  borderRadius: radius.md,
                },
                pressed && { opacity: 0.76 },
              ]}
            >
              <Text style={[styles.modalButtonText, { color: colors.onPrimary }]}>
                Done
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 256,
    padding: 22,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.09,
    shadowRadius: 22,
    elevation: 4,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  source: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  readingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
  },
  value: {
    fontSize: 78,
    lineHeight: 82,
    fontWeight: '700',
    letterSpacing: -4,
    fontVariant: ['tabular-nums'],
  },
  unitBlock: {
    marginLeft: 13,
    paddingTop: 7,
  },
  arrow: {
    fontSize: 32,
    lineHeight: 34,
    fontWeight: '700',
  },
  unit: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginTop: 2,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 18,
    marginTop: 15,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  detailStrong: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  detail: {
    fontSize: 14,
    lineHeight: 20,
  },
  calculatedTrend: {
    alignSelf: 'flex-start',
    minHeight: 36,
    marginTop: 14,
    paddingHorizontal: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  calculatedTrendText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  rangePill: {
    minHeight: 30,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rangeDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  rangeText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
  },
  missing: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 30,
  },
  missingTitle: {
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '700',
    marginBottom: 8,
  },
  chooseSourceButton: {
    alignSelf: 'flex-start',
    minHeight: 46,
    marginTop: 18,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chooseSourceButtonText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  modalHeading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
  },
  modalHeadingCopy: {
    flex: 1,
  },
  modalEyebrow: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '900',
    letterSpacing: 1,
  },
  modalTitle: {
    marginTop: 4,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  modalBody: {
    marginTop: 12,
    fontSize: 14,
    lineHeight: 21,
  },
  evidenceList: {
    marginTop: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    overflow: 'hidden',
  },
  evidenceRow: {
    minHeight: 44,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  evidenceTime: {
    fontSize: 13,
    lineHeight: 18,
    fontVariant: ['tabular-nums'],
  },
  evidenceValue: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  sourceEvidence: {
    marginTop: 10,
    fontSize: 11,
    lineHeight: 16,
  },
  modalButton: {
    minHeight: 48,
    marginTop: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
});
