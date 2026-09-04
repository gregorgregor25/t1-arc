import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, {
  Circle,
  G,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from 'react-native-svg';

import { buildGlucoseProfile } from '@/domain/glucoseProfile';
import {
  buildColouredGlucoseSegments,
  buildGlucoseChartScale,
} from '@/domain/glucoseChart';
import {
  GLUCOSE_COLOR_PALETTE,
  glucoseRangeForValue,
} from '@/domain/glucoseAppearance';
import { EvidenceReference } from '@/domain/insights';
import { GlucoseReading, TimelineData } from '@/domain/models';
import { formatGlucose, formatRegionalNumber } from '@/domain/regionalFormat';
import { formatRegionalWallClockMinute } from '@/domain/regionalWallClock';
import { useGlucoseAppearance } from '@/providers/GlucoseAppearanceProvider';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';

import { EmptyState } from './EmptyState';
import {
  ChartExpandButton,
  FullscreenChartModal,
} from './FullscreenChart';
import { SectionCard } from './SectionCard';

const HEIGHT = 224;
const TOP = 14;
const BOTTOM = 188;
const LEFT = 8;
const RIGHT = 34;

function evidenceForProfile(
  data: TimelineData,
  regional: Parameters<typeof formatGlucose>[1],
): EvidenceReference {
  const readings = [...data.glucose].sort(
    (a, b) => a.timestamp - b.timestamp,
  );
  const representative = [
    readings[0],
    [...readings].sort((a, b) => b.mmolL - a.mmolL)[0],
    [...readings].sort((a, b) => a.mmolL - b.mmolL)[0],
    readings[readings.length - 1],
  ].filter((reading): reading is GlucoseReading => reading !== undefined);
  const examples = [
    ...new Map(
      representative.map((reading) => [
        reading.id,
        {
          id: reading.id,
          kind: 'glucose' as const,
          timestamp: reading.timestamp,
          primary: formatGlucose(reading.mmolL, regional),
          secondary: reading.quality,
          sourceId: reading.sourceId,
        },
      ]),
    ).values(),
  ];
  return {
    id: `glucose-profile:${data.range.start}:${data.range.end}`,
    label: 'Aggregate glucose profile',
    description: `${formatRegionalNumber(readings.length, regional.locale, { maximumFractionDigits: 0 })} glucose readings grouped into local half-hour clock windows. The line is the median, the solid band is the middle 50%, and whiskers show the 10th to 90th percentile`,
    range: data.range,
    recordIds: readings.map((reading) => reading.id),
    examples,
  };
}

export function GlucoseProfileCard({
  data,
  expanded = false,
  onInspect,
}: {
  data: TimelineData;
  expanded?: boolean;
  onInspect(evidence: EvidenceReference): void;
}) {
  const { colors, dark, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const { settings: appearance } = useGlucoseAppearance();
  const window = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const [showExpanded, setShowExpanded] = useState(false);
  const height = expanded
    ? Math.max(190, Math.min(250, window.height - 190))
    : HEIGHT;
  const top = expanded ? 24 : TOP;
  const bottom = expanded ? height - 48 : BOTTOM;
  const profile = useMemo(
    () => buildGlucoseProfile(data.glucose, data.range),
    [data.glucose, data.range],
  );
  const profileScalePoints = useMemo(
    () =>
      profile.bins.flatMap((bin) =>
        [bin.p10, bin.median, bin.p90]
          .filter((value): value is number => value !== undefined)
          .map((mmolL) => ({ timestamp: bin.index, mmolL })),
      ),
    [profile.bins],
  );
  const scale = useMemo(
    () => buildGlucoseChartScale(profileScalePoints, appearance),
    [appearance, profileScalePoints],
  );
  const medianSegments = useMemo(
    () =>
      buildColouredGlucoseSegments(
        profile.bins.flatMap((bin) =>
          bin.median === undefined
            ? []
            : [{ timestamp: bin.index, mmolL: bin.median }],
        ),
        appearance,
        1.1,
      ),
    [appearance, profile.bins],
  );
  const plotWidth = Math.max(1, width - LEFT - RIGHT);
  const plotHeight = bottom - top;
  const x = (index: number) =>
    LEFT + ((index + 0.5) / profile.bins.length) * plotWidth;
  const y = (value: number) =>
    top +
    ((scale.maximum -
      Math.max(scale.minimum, Math.min(scale.maximum, value))) /
      Math.max(1, scale.maximum - scale.minimum)) *
      plotHeight;
  const rangeColor = (value: number) => {
    const range = glucoseRangeForValue(value, 'current', appearance);
    return GLUCOSE_COLOR_PALETTE[appearance.colors[range]][
      dark ? 'dark' : 'light'
    ];
  };
  const enoughCoverage =
    profile.expectedDays >= 3 && profile.representedBins >= 16;

  function onLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  return (
    <>
      <SectionCard style={expanded ? styles.expandedCard : undefined}>
      {!expanded ? (
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>
            TYPICAL DAY
          </Text>
          <Text style={[styles.title, { color: colors.text }]}>
            Glucose profile
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Median and spread by time of day.
          </Text>
        </View>
        <View style={styles.headerActions}>
          <ChartExpandButton
            label="Open glucose profile full screen"
            onPress={() => setShowExpanded(true)}
          />
          <Pressable
            accessibilityLabel="Inspect every glucose reading in this profile"
            accessibilityRole="button"
            disabled={!data.glucose.length}
            onPress={() => onInspect(evidenceForProfile(data, regional))}
            style={({ pressed }) => [
              styles.inspect,
              {
                backgroundColor: colors.surfaceMuted,
                borderColor: colors.border,
                borderRadius: radius.pill,
                opacity: pressed ? 0.65 : 1,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.primary}
              name="list-outline"
              size={17}
            />
            <Text style={[styles.inspectText, { color: colors.primary }]}>
              RECORDS
            </Text>
          </Pressable>
        </View>
      </View>
      ) : null}

      {!enoughCoverage ? (
        <View style={styles.empty}>
          <EmptyState
            title="Building a reliable profile"
            detail={`T1 Arc needs readings from at least ${formatRegionalNumber(profile.minimumDaysPerBin, regional.locale, { maximumFractionDigits: 0 })} separate days in enough half-hour windows. ${formatRegionalNumber(profile.representedBins, regional.locale, { maximumFractionDigits: 0 })} of ${formatRegionalNumber(profile.bins.length, regional.locale, { maximumFractionDigits: 0 })} windows are ready.`}
          />
        </View>
      ) : (
        <>
          <View
            accessibilityLabel={`Aggregate glucose profile across ${formatRegionalNumber(profile.expectedDays, regional.locale, { maximumFractionDigits: 0 })} days. ${formatRegionalNumber(profile.representedBins, regional.locale, { maximumFractionDigits: 0 })} of ${formatRegionalNumber(profile.bins.length, regional.locale, { maximumFractionDigits: 0 })} half-hour windows represented.`}
            onLayout={onLayout}
            style={[styles.chart, { height }]}
          >
            {width > 0 ? (
              <Svg height={height} width={width}>
                <Rect
                  fill={colors.targetBand}
                  height={
                    y(appearance.targetMin) - y(appearance.targetMax)
                  }
                  opacity={0.72}
                  width={plotWidth}
                  x={LEFT}
                  y={y(appearance.targetMax)}
                />
                {scale.ticks.map((tick) => (
                  <G key={tick}>
                    <Line
                      stroke={colors.grid}
                      strokeWidth={1}
                      x1={LEFT}
                      x2={LEFT + plotWidth}
                      y1={y(tick)}
                      y2={y(tick)}
                    />
                    <SvgText
                      fill={colors.textTertiary}
                      fontSize={8}
                      textAnchor="start"
                      x={LEFT + plotWidth + 7}
                      y={y(tick) + 3}
                    >
                      {formatGlucose(tick, regional, { withUnit: false })}
                    </SvgText>
                  </G>
                ))}
                {profile.bins.map((bin) => {
                  if (
                    bin.p10 === undefined ||
                    bin.p25 === undefined ||
                    bin.p75 === undefined ||
                    bin.p90 === undefined ||
                    bin.median === undefined
                  ) {
                    return null;
                  }
                  const centre = x(bin.index);
                  const barWidth = Math.max(
                    2,
                    (plotWidth / profile.bins.length) * 0.72,
                  );
                  const binColor = rangeColor(bin.median);
                  return (
                    <G key={bin.index}>
                      <Line
                        opacity={0.34}
                        stroke={binColor}
                        strokeWidth={1}
                        x1={centre}
                        x2={centre}
                        y1={y(bin.p90)}
                        y2={y(bin.p10)}
                      />
                      <Rect
                        fill={binColor}
                        height={Math.max(1, y(bin.p25) - y(bin.p75))}
                        opacity={0.2}
                        width={barWidth}
                        x={centre - barWidth / 2}
                        y={y(bin.p75)}
                      />
                      <Circle
                        cx={centre}
                        cy={y(bin.median)}
                        fill={binColor}
                        r={1.3}
                      />
                    </G>
                  );
                })}
                {medianSegments.map((segment, index) => (
                  <Path
                    d={segment.points
                      .map(
                        (point, pointIndex) =>
                          `${pointIndex ? 'L' : 'M'} ${x(point.timestamp)} ${y(point.mmolL)}`,
                      )
                      .join(' ')}
                    fill="none"
                    key={`${segment.range}-${index}`}
                    stroke={
                      GLUCOSE_COLOR_PALETTE[
                        appearance.colors[segment.range]
                      ][dark ? 'dark' : 'light']
                    }
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.2}
                  />
                ))}
                {[0, 6, 12, 18, 24].map((hour) => {
                  const tickX = LEFT + (hour / 24) * plotWidth;
                  return (
                    <SvgText
                      fill={colors.textTertiary}
                      fontSize={8}
                      key={hour}
                      textAnchor={
                        hour === 0 ? 'start' : hour === 24 ? 'end' : 'middle'
                      }
                      x={tickX}
                      y={bottom + 20}
                    >
                      {formatRegionalWallClockMinute(
                        (hour * 60) % (24 * 60),
                        regional.locale,
                      )}
                    </SvgText>
                  );
                })}
              </Svg>
            ) : null}
          </View>
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View
                style={[
                  styles.legendLine,
                  { backgroundColor: colors.glucose },
                ]}
              />
              <Text
                style={[styles.legendText, { color: colors.textSecondary }]}
              >
                Median
              </Text>
            </View>
            <View style={styles.legendItem}>
              <View
                style={[
                  styles.legendBand,
                  { backgroundColor: `${colors.glucose}44` },
                ]}
              />
              <Text
                style={[styles.legendText, { color: colors.textSecondary }]}
              >
                Middle 50%
              </Text>
            </View>
            <View style={styles.legendItem}>
              <View
                style={[
                  styles.legendWhisker,
                  { backgroundColor: `${colors.glucose}88` },
                ]}
              />
              <Text
                style={[styles.legendText, { color: colors.textSecondary }]}
              >
                10–90%
              </Text>
            </View>
          </View>
        </>
      )}
      {!expanded ? (
      <Text style={[styles.footnote, { color: colors.textTertiary }]}>
        Built from local clock time across{' '}
        {formatRegionalNumber(profile.expectedDays, regional.locale, {
          maximumFractionDigits: 0,
        })}{' '}
        days. This is
        a retrospective view, not a prediction or dosing recommendation.
      </Text>
      ) : null}
      </SectionCard>
      {!expanded ? (
        <FullscreenChartModal
          detail={`Typical day from ${formatRegionalNumber(profile.expectedDays, regional.locale, { maximumFractionDigits: 0 })} local days`}
          onClose={() => setShowExpanded(false)}
          title="Glucose profile"
          visible={showExpanded}
        >
          <GlucoseProfileCard
            data={data}
            expanded
            onInspect={onInspect}
          />
        </FullscreenChartModal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  expandedCard: {
    padding: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  eyebrow: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    marginTop: 2,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  inspect: {
    minHeight: 38,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  inspectText: {
    fontSize: 8,
    lineHeight: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  empty: {
    marginTop: 8,
  },
  chart: {
    height: HEIGHT,
    marginTop: 12,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 13,
    marginTop: 4,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendLine: {
    width: 18,
    height: 2,
  },
  legendBand: {
    width: 18,
    height: 8,
  },
  legendWhisker: {
    width: 1,
    height: 12,
  },
  legendText: {
    fontSize: 9,
    lineHeight: 13,
  },
  footnote: {
    fontSize: 10,
    lineHeight: 16,
    marginTop: 12,
  },
});
