import cardSpec from '../../modules/t1arc-glucose-display/shared/current-glucose-card.json';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import {
  Alert,
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
import { AapsEstimateSummary } from './AapsEstimateSummary';
import type { AapsEstimateInput } from './aapsEstimatePresentation';
import { currentGlucoseCardLayout } from './currentGlucoseCardLayout';
import {
  lowReadingMessage,
  nowCardSourceName,
  nowCardState,
  staleReadingMessage,
  type NowStateShape,
  type NowTherapyStateLine,
} from './nowCardPresentation';
import { useSystemBarInsets } from '@/hooks/useSystemBarInsets';
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
}: {
  endTimestamp: number;
  readings: GlucoseReading[];
  stale: boolean;
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
      style={styles.flowTrace}
    >
      <Svg
        height={cardSpec.traceHeight}
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

function StateShape({ shape, color }: { shape: NowStateShape; color: string }) {
  const size = 12;
  let inner;
  switch (shape) {
    case 'circle':
      inner = <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
      break;
    case 'ring':
      inner = <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: color }} />;
      break;
    case 'triangle-up':
    case 'triangle-down':
      inner = (
        <View
          style={[
            styles.triangle,
            shape === 'triangle-up'
              ? { borderBottomWidth: size, borderBottomColor: color }
              : { borderTopWidth: size, borderTopColor: color },
          ]}
        />
      );
      break;
  }
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.shapeBox}
      testID={`now-state-${shape}`}
    >
      {inner}
    </View>
  );
}

export function CurrentGlucoseCard({
  reading,
  history = [],
  source,
  now,
  trendAssessment,
  trendDetailsRequest = 0,
  onChooseSource,
  onCheckConnection,
  onLogHypoTreatment,
  onLogMeterReading,
  aapsEstimates,
}: {
  reading?: GlucoseReading;
  history?: GlucoseReading[];
  source?: DataSourceStatus;
  now: number;
  trendAssessment?: GlucoseTrendAssessment;
  trendDetailsRequest?: number;
  onChooseSource?(): void;
  /** No recent reading: opens the settings page for the glucose source. */
  onCheckConnection?(): void;
  /** Low or very low: opens the hypo treatment form (nothing saves until confirmed). */
  onLogHypoTreatment?(): void;
  /** No recent reading: opens the meter (finger-prick) reading form. */
  onLogMeterReading?(): void;
  aapsEstimates?: AapsEstimateInput;
}) {
  const { colors, dark, radius } = useAppTheme();
  const insets = useSystemBarInsets();
  const { fontScale } = useWindowDimensions();
  const { settings: appearance } = useGlucoseAppearance();
  const { defaults: regional } = useRegionalProfile();
  const [trendDetailsVisible, setTrendDetailsVisible] = useState(false);
  useEffect(() => {
    if (trendDetailsRequest > 0) {
      // A widget deep link is a one-shot request to open the existing evidence.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTrendDetailsVisible(true);
    }
  }, [trendDetailsRequest]);
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
  const state = nowCardState(valueRange, freshness);
  const lowMode = Boolean(reading) && state.mode === 'low';
  const staleMode = Boolean(reading) && isStale;
  const sourceName = nowCardSourceName(reading?.sourceId);
  const trendIcon: keyof typeof Ionicons.glyphMap =
    assessment.direction === 'tripleDown' ||
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
  const readingLabel = reading
    ? isStale
      ? `Last known glucose ${formatGlucoseAccessible(reading.mmolL, regional)}, shown struck through because it is stale. Updated ${age}.`
      : `Current glucose ${formatGlucoseAccessible(reading.mmolL, regional)}, ${trendLabel}. ${state.word}. ${freshnessCopy[freshness].label}, updated ${age}.`
    : 'Current glucose is unavailable.';
  const ageLine = staleMode
    ? `Last reading ${age}`
    : [aapsEstimates ? `Glucose · ${age}` : age, sourceName].filter(Boolean).join(' · ');

  return (
    <View
      style={[
        styles.card,
        reading ? null : { minHeight: layout.minHeight },
        {
          backgroundColor: lowMode ? `${valueTone}1F` : colors.surface,
          borderColor: lowMode ? valueTone : colors.border,
          borderWidth: lowMode ? 2 : StyleSheet.hairlineWidth,
          borderRadius: radius.xl,
          shadowColor: colors.surfaceShadow,
        },
      ]}
      testID={`now-card-${reading ? state.mode : 'missing'}`}
    >
      {reading ? (
        <>
          <View style={styles.topRow}>
            <View
              style={[
                styles.statePill,
                {
                  backgroundColor: staleMode ? colors.surfaceMuted : `${valueTone}24`,
                  borderColor: staleMode ? colors.border : `${valueTone}88`,
                },
              ]}
            >
              <StateShape color={staleMode ? colors.textSecondary : valueTone} shape={state.shape} />
              <Text style={[styles.stateWord, { color: staleMode ? colors.text : valueTone }]}>
                {state.word}
              </Text>
            </View>
            <View style={styles.statusBlock}>
              <Text style={[styles.age, { color: colors.textSecondary }]}>{ageLine}</Text>
              {freshness === 'delayed' ? <StatusPill freshness={freshness} /> : null}
            </View>
          </View>

          <Pressable
            accessibilityHint="Opens how this reading's direction was recorded"
            accessibilityLabel={readingLabel}
            accessibilityRole="button"
            onPress={() => setTrendDetailsVisible(true)}
            style={({ pressed }) => [styles.readingRow, pressed && { opacity: 0.72 }]}
            testID="now-card-reading"
          >
            <Text
              maxFontSizeMultiplier={1.3}
              style={[
                styles.value,
                { color: staleMode ? colors.textSecondary : lowMode ? valueTone : colors.text },
                staleMode && {
                  textDecorationColor: colors.textSecondary,
                  textDecorationLine: 'line-through',
                  textDecorationStyle: 'solid',
                },
              ]}
            >
              {formatGlucose(reading.mmolL, regional, { withUnit: false })}
            </Text>
            <View style={styles.unitBlock}>
              {staleMode ? (
                <>
                  <Text style={[styles.direction, { color: colors.text }]}>Last known</Text>
                  <Text style={[styles.unit, { color: colors.textSecondary }]}>
                    at {formatTime(reading.timestamp)} · {glucoseUnitLabel(regional.glucoseUnit)}
                  </Text>
                </>
              ) : (
                <>
                  <View style={styles.directionRow}>
                    <Text
                      maxFontSizeMultiplier={1.3}
                      style={[styles.arrow, { color: lowMode ? valueTone : colors.text }]}
                    >
                      {trend.arrow}
                    </Text>
                    <Text style={[styles.direction, { color: colors.text }]}>
                      {trendLabel}
                    </Text>
                  </View>
                  <Text style={[styles.unit, { color: colors.textSecondary }]}>
                    {glucoseUnitLabel(regional.glucoseUnit)}
                  </Text>
                </>
              )}
            </View>
          </Pressable>

          {lowMode ? (
            <View style={styles.stateBlock}>
              <Text style={[styles.stateMessage, { color: colors.text }]}>
                {lowReadingMessage(
                  valueRange,
                  formatGlucose(
                    valueRange === 'veryLow' ? appearance.veryLowMax : appearance.targetMin,
                    regional,
                  ),
                )}
              </Text>
              {onLogHypoTreatment ? (
                <Pressable
                  accessibilityHint="Opens the hypo treatment form. Nothing is saved until you confirm."
                  accessibilityRole="button"
                  onPress={onLogHypoTreatment}
                  style={({ pressed }) => [
                    styles.stateButton,
                    {
                      backgroundColor: valueTone,
                      borderRadius: radius.md,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <Ionicons accessibilityElementsHidden color={colors.background} name="medkit-outline" size={20} />
                  <Text style={[styles.stateButtonText, { color: colors.background }]}>
                    Log hypo treatment
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {staleMode ? (
            <View style={styles.stateBlock}>
              <Text style={[styles.stateMessage, { color: colors.text }]}>
                {staleReadingMessage(sourceName, formatTime(reading.timestamp))}
              </Text>
              {onCheckConnection ? (
                <Pressable
                  accessibilityHint="Opens the settings page for your glucose source"
                  accessibilityRole="button"
                  onPress={onCheckConnection}
                  style={({ pressed }) => [
                    styles.stateButton,
                    {
                      backgroundColor: colors.primary,
                      borderRadius: radius.md,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <Ionicons accessibilityElementsHidden color={colors.onPrimary} name="git-network-outline" size={20} />
                  <Text style={[styles.stateButtonText, { color: colors.onPrimary }]}>
                    Check the connection
                  </Text>
                </Pressable>
              ) : null}
              {onLogMeterReading ? (
                <Pressable
                  accessibilityHint="Opens a form to record a finger-prick reading. It is kept separate from sensor readings."
                  accessibilityRole="button"
                  onPress={onLogMeterReading}
                  style={({ pressed }) => [
                    styles.stateButton,
                    styles.secondaryStateButton,
                    {
                      borderColor: colors.primary,
                      borderRadius: radius.md,
                      backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
                    },
                  ]}
                >
                  <Ionicons accessibilityElementsHidden color={colors.primary} name="eyedrop-outline" size={20} />
                  <Text style={[styles.stateButtonText, { color: colors.primary }]}>
                    Log a meter reading
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {!staleMode ? (
            <GlucoseTrace
              endTimestamp={reading.timestamp}
              readings={history}
              stale={isStale}
            />
          ) : null}

          {!isStale && (assessment.origin === 'calculated' || assessment.sourceDetail) ? (
            <View style={styles.footer}>
              <View style={styles.detailRow}>
                <Ionicons
                  accessibilityElementsHidden
                  name={trendIcon}
                  color={colors.textSecondary}
                  size={18}
                />
                <Text style={[styles.detail, { color: colors.textSecondary }]}>
                  {assessment.origin === 'calculated' ? 'Direction calculated by T1 Arc' : 'Direction from your source'}
                </Text>
              </View>
              <Pressable
                accessibilityLabel={assessment.origin === 'calculated' ? 'How this trend was calculated' : 'About this source trend'}
                accessibilityHint={assessment.origin === 'calculated' ? 'Opens the exact readings used for this fallback' : 'Opens the source direction and watch display details'}
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
            </View>
          ) : null}
        </>
      ) : (
        <View style={styles.missing}>
          <View style={styles.topRow}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Now</Text>
            <StatusPill freshness={freshness} />
          </View>
          <Text accessibilityLabel={readingLabel} style={[styles.missingTitle, { color: colors.text }]}>
            No reading
          </Text>
          <Text style={[styles.detail, { color: colors.textSecondary }]}>
            {source?.isLive
              ? 'The connected glucose source has not supplied a usable value.'
              : 'Connect a glucose source whenever you are ready.'}
          </Text>
          {!source?.isLive && onChooseSource ? (
            <Pressable
              accessibilityHint="Opens Settings, where data connections are listed first."
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
                Connect a source
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
      {reading && freshness !== 'current' && source?.isLive ? (
        <Text style={[styles.detail, { color: colors.textSecondary }]}>
          {source.errorCode
            ? 'The last source check failed. Open Settings to check the connection and retry.'
            : source.lastUpdatedAt && source.lastUpdatedAt > reading.timestamp
              ? `Source checked ${relativeAge(source.lastUpdatedAt, now)}; the reading is still from ${formatTime(reading.timestamp)}. A successful check does not mean a new reading arrived.`
              : 'Waiting for a newer reading. Open Settings to check the source connection.'}
        </Text>
      ) : null}
      {aapsEstimates ? <AapsEstimateSummary estimates={aapsEstimates} now={now} /> : null}
      <Modal
        animationType="fade"
        onRequestClose={() => setTrendDetailsVisible(false)}
        statusBarTranslucent
        transparent
        visible={trendDetailsVisible}
      >
        <View
          style={[
            styles.modalBackdrop,
            {
              backgroundColor: colors.overlay,
              paddingTop: 20 + insets.top,
              paddingBottom: 20 + insets.bottom,
            },
          ]}
        >
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
                {assessment.origin === 'calculated' ? (
                  <Text style={[styles.modalEyebrow, { color: colors.accent }]}>TRANSPARENT FALLBACK</Text>
                ) : null}
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  {assessment.origin === 'calculated' ? 'Source direction unavailable' : 'Source trend'}
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Close trend details"
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
            {assessment.origin === 'unavailable' ? (
              <Text style={[styles.modalBody, { color: colors.textSecondary }]}>
                {assessment.reason ?? 'No direction is available for this reading.'}
              </Text>
            ) : assessment.origin === 'source' ? (
              <Text style={[styles.modalBody, { color: colors.textSecondary }]}>
                {assessment.sourceDetail ?? 'This direction was supplied by your glucose source with the reading.'}{assessment.compatibilityNote ? ` ${assessment.compatibilityNote}` : ''}
              </Text>
            ) : (
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
            )}
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
    </View>
  );
}

const THERAPY_STATE_ICONS: Record<NowTherapyStateLine['state']['kind'], keyof typeof Ionicons.glyphMap> = {
  'temporary-target': 'flag-outline',
  'profile-switch': 'person-outline',
  'loop-mode': 'sync-outline',
  'pump-suspend': 'pause-circle-outline',
  exercise: 'walk-outline',
};

/**
 * One calm chip per recorded AAPS state that is active now (at most two),
 * shown under the Now card. Tapping shows the full record and its source
 * (AAPS on this phone, or Nightscout). It repeats what was recorded and
 * suggests nothing.
 */
export function NowTherapyStateChips({ lines }: { lines: readonly NowTherapyStateLine[] }) {
  const { colors, radius, type } = useAppTheme();
  if (!lines.length) return null;

  function showRecord(line: NowTherapyStateLine) {
    Alert.alert(
      'Recorded setting',
      `${line.detail}

Source: ${line.source}

This shows what your loop recorded. T1 Arc does not change any setting.`,
    );
  }

  return (
    <View accessibilityLabel="Recorded loop settings now" style={styles.therapyRow}>
      {lines.map((line) => (
        <Pressable
          key={line.id}
          accessibilityRole="button"
          accessibilityLabel={`Recorded setting: ${line.text}`}
          accessibilityHint="Shows the full record and where it came from"
          onPress={() => showRecord(line)}
          style={({ pressed }) => [
            styles.therapyChip,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
              borderRadius: radius.pill,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.textSecondary}
            name={THERAPY_STATE_ICONS[line.state.kind]}
            size={15}
          />
          <Text style={[styles.therapyLabel, { color: colors.text, fontSize: type.callout }]}>
            {line.text}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  therapyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  therapyChip: {
    minHeight: 44,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  therapyLabel: { flexShrink: 1, fontWeight: '700' },
  card: {
    padding: cardSpec.padding,
    overflow: 'hidden',
    gap: 14,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 4,
  },
  // The age and source can wrap at large text sizes. Reserve the graph after
  // the measured value row instead of positioning it over a guessed height.
  flowTrace: {
    height: cardSpec.traceHeight + 18,
    paddingTop: 18,
    opacity: cardSpec.traceOpacity,
  },
  shapeBox: {
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  triangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  statePill: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  stateWord: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  directionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  direction: {
    flexShrink: 1,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
  },
  stateBlock: {
    gap: 10,
  },
  stateMessage: {
    fontSize: 16,
    lineHeight: 23,
  },
  stateButton: {
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryStateButton: {
    borderWidth: 1,
  },
  stateButtonText: {
    flexShrink: 1,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
  },
  tracePeriod: {
    position: 'absolute',
    top: 0,
    right: 2,
    paddingLeft: 7,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  label: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  statusBlock: {
    flexShrink: 1,
    alignItems: 'flex-end',
    gap: 6,
  },
  age: {
    fontSize: 15,
    lineHeight: 20,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  readingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    minHeight: 48,
  },
  value: {
    fontSize: cardSpec.valueSize,
    lineHeight: cardSpec.valueLineHeight,
    fontWeight: '700',
    letterSpacing: cardSpec.valueLetterSpacing,
    fontVariant: ['tabular-nums'],
  },
  unitBlock: {
    flexShrink: 1,
    marginLeft: 13,
    paddingTop: 7,
    gap: 2,
  },
  arrow: {
    fontSize: cardSpec.arrowSize,
    lineHeight: cardSpec.arrowLineHeight,
    fontWeight: '700',
  },
  unit: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
  },
  detailRow: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  detail: {
    fontSize: 14,
    lineHeight: 20,
  },
  calculatedTrend: {
    width: 44,
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
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
    fontSize: 12,
    lineHeight: 17,
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
    fontSize: 13,
    lineHeight: 18,
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
