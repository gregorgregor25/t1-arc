import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, {
  Defs,
  LinearGradient as SvgLinearGradient,
  Path,
  Stop,
} from 'react-native-svg';

import { DataSourceStatus, GlucoseReading } from '@/domain/models';
import { freshnessCopy, glucoseFreshness } from '@/domain/freshness';
import {
  GLUCOSE_RANGE_LABELS,
  glucoseRangeForValue,
  glucoseTone,
} from '@/domain/glucoseAppearance';
import { formatTime, relativeAge } from '@/domain/time';
import {
  formatGlucose,
  formatGlucoseAccessible,
  formatRegionalNumber,
  glucoseFromMmolL,
  glucoseUnitLabel,
} from '@/domain/regionalFormat';
import {
  assessGlucoseTrend,
  GlucoseTrendAssessment,
  presentTrend,
} from '@/domain/trend';
import { useGlucoseAppearance } from '@/providers/GlucoseAppearanceProvider';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';

import { StatusPill } from './StatusPill';
import { SurfaceSheen } from './SurfaceSheen';
import { currentGlucoseCardLayout } from './currentGlucoseCardLayout';
import {
  glucoseTraceGeometry,
  TRACE_HEIGHT,
  TRACE_WIDTH,
} from './currentGlucoseTrace';

function tracePeriod(duration: number) {
  const minutes = Math.max(1, Math.round(duration / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder >= 10 ? `${hours}h ${remainder}m` : `${hours}h`;
}

function GlucoseTrace({
  endTimestamp,
  readings,
  stale,
  traceTop,
}: {
  endTimestamp: number;
  readings: GlucoseReading[];
  stale: boolean;
  traceTop: number;
}) {
  const { colors, dark } = useAppTheme();
  const { settings } = useGlucoseAppearance();
  const geometry = glucoseTraceGeometry(readings, endTimestamp);
  if (!geometry) return null;
  const fillTone = stale ? colors.textTertiary : colors.glucose;

  return (
    <View
      accessibilityElementsHidden
      pointerEvents="none"
      style={[styles.trace, { top: traceTop }]}
    >
      <Svg
        height="100%"
        preserveAspectRatio="none"
        viewBox={`0 0 ${TRACE_WIDTH} ${TRACE_HEIGHT}`}
        width="100%"
      >
        <Defs>
          <SvgLinearGradient id="glucoseArea" x1="0" x2="0" y1="0" y2="1">
            <Stop offset="0" stopColor={fillTone} stopOpacity={0.42} />
            <Stop offset="0.72" stopColor={fillTone} stopOpacity={0.12} />
            <Stop offset="1" stopColor={fillTone} stopOpacity={0} />
          </SvgLinearGradient>
        </Defs>
        {geometry.areas.map((area, index) => (
          <Path key={index} d={area} fill="url(#glucoseArea)" />
        ))}
        {geometry.segments.map((segment, index) => (
          <Path
            key={`${index}:${segment.value}`}
            d={segment.path}
            fill="none"
            opacity={stale ? 0.52 : 0.92}
            stroke={glucoseTone(segment.value, 'current', settings, dark)}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {geometry.isolatedPoints.map((point, index) => (
          <Path
            key={`point:${index}`}
            d={`M ${point.x.toFixed(2)} ${point.y.toFixed(2)} h 0.01`}
            fill="none"
            opacity={stale ? 0.52 : 0.92}
            stroke={glucoseTone(point.value, 'current', settings, dark)}
            strokeLinecap="round"
            strokeWidth={3}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </Svg>
      <Text
        maxFontSizeMultiplier={1.3}
        style={[styles.tracePeriod, { color: colors.textTertiary }]}
      >
        {geometry.duration > 0
          ? `${tracePeriod(geometry.duration)} ${stale ? 'to last reading' : 'history'}`
          : `${geometry.readingCount} ${geometry.readingCount === 1 ? 'reading' : 'readings'}`}
      </Text>
    </View>
  );
}

export function CurrentGlucoseCard({
  reading,
  history = [],
  source,
  now,
  trendAssessment,
  onChooseSource,
}: {
  reading?: GlucoseReading;
  history?: GlucoseReading[];
  source?: DataSourceStatus;
  now: number;
  trendAssessment?: GlucoseTrendAssessment;
  onChooseSource?(): void;
}) {
  const { colors, dark, radius } = useAppTheme();
  const { fontScale } = useWindowDimensions();
  const { settings: appearance } = useGlucoseAppearance();
  const { defaults: regional } = useRegionalProfile();
  const [trendDetailsVisible, setTrendDetailsVisible] = useState(false);
  const layout = currentGlucoseCardLayout(fontScale);
  // The value and its timestamp are one observation. Source status is loaded
  // independently and can briefly describe the row that preceded a headless
  // write, so it must never make a current displayed reading look stale.
  const freshness = glucoseFreshness(reading?.timestamp, now);
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
  const chooseSourceContent = colors.onPrimary;
  return (
    <LinearGradient
      accessibilityLabel={
        reading
          ? isStale
            ? `Last known glucose ${formatGlucoseAccessible(reading.mmolL, regional)}, shown struck through because it is stale. Updated ${age}.`
            : `Current glucose ${formatGlucoseAccessible(reading.mmolL, regional)}, ${trendLabel}. ${freshnessCopy[freshness].label}, updated ${age}.`
          : 'Current glucose is unavailable.'
      }
      colors={[
        colors.surfaceGradientStart,
        colors.surfaceGradientMiddle,
        colors.surfaceGradientEnd,
      ]}
      end={{ x: 0.9, y: 1 }}
      locations={[0, 0.46, 1]}
      start={{ x: 0.02, y: 0 }}
      style={[
        styles.card,
        { minHeight: layout.minHeight },
        {
          borderColor: colors.surfaceBorder,
          borderRadius: radius.xl,
          shadowColor: colors.surfaceShadow,
        },
      ]}
    >
      <SurfaceSheen radius={radius.xl} />
      {reading ? (
        <GlucoseTrace
          endTimestamp={reading.timestamp}
          readings={history}
          stale={isStale}
          traceTop={layout.traceTop}
        />
      ) : null}
      <View style={styles.topRow}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          {isStale ? 'Last known' : 'Now'}
        </Text>
        <View style={styles.statusBlock}>
          {reading ? (
            <Text style={[styles.age, { color: colors.textSecondary }]}>
              {age}
            </Text>
          ) : null}
          {freshness !== 'current' ? <StatusPill freshness={freshness} /> : null}
        </View>
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
              {formatGlucose(reading.mmolL, regional, { withUnit: false })}
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
                {glucoseUnitLabel(regional.glucoseUnit)}
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
          </View>
          {!isStale && assessment.origin === 'calculated' ? (
            <Pressable
              accessibilityLabel="How this trend was calculated"
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
                size={18}
              />
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
                  borderColor: dark ? `${colors.primary}55` : colors.primary,
                  borderRadius: radius.md,
                  opacity: pressed ? 0.74 : 1,
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={chooseSourceContent}
                name="git-network-outline"
                size={19}
              />
              <Text
                style={[
                  styles.chooseSourceButtonText,
                  { color: chooseSourceContent },
                ]}
              >
                Choose glucose source
              </Text>
              <Ionicons
                accessibilityElementsHidden
                color={chooseSourceContent}
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
              {formatRegionalNumber(
                assessment.supportingReadings.length,
                regional.locale,
                { maximumFractionDigits: 0 },
              )} recent readings from the
              same source over{' '}
              {formatRegionalNumber(
                assessment.windowMinutes ?? 0,
                regional.locale,
                { maximumFractionDigits: 0 },
              )}{' '}
              minutes. The
              observed rate was{' '}
              {assessment.rateMmolLPerFiveMinutes === undefined
                ? '—'
                : formatRegionalNumber(
                    glucoseFromMmolL(
                      assessment.rateMmolLPerFiveMinutes,
                      regional.glucoseUnit,
                    ),
                    regional.locale,
                    { maximumFractionDigits: 2, signDisplay: 'exceptZero' },
                  )}{' '}
              {glucoseUnitLabel(regional.glucoseUnit)}
              per{' '}
              {formatRegionalNumber(5, regional.locale, {
                maximumFractionDigits: 0,
              })}{' '}
              minutes. This is not a sensor-provided arrow and is not for
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
                    {formatGlucose(item.mmolL, regional)}
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
    minHeight: 238,
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 8,
  },
  trace: {
    position: 'absolute',
    left: 18,
    right: 18,
    top: 78,
    height: 92,
    opacity: 0.72,
  },
  tracePeriod: {
    position: 'absolute',
    top: 0,
    right: 2,
    paddingLeft: 7,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  label: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  statusBlock: {
    alignItems: 'flex-end',
    gap: 6,
  },
  age: {
    fontSize: 12,
    lineHeight: 17,
    fontVariant: ['tabular-nums'],
  },
  readingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
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
    position: 'absolute',
    left: 20,
    right: 66,
    bottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    zIndex: 3,
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
    position: 'absolute',
    right: 16,
    bottom: 12,
    width: 44,
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
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
    maxWidth: '100%',
    minHeight: 48,
    marginTop: 18,
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chooseSourceButtonText: {
    flexShrink: 1,
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
