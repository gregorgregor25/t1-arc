import Ionicons from '@expo/vector-icons/Ionicons';
import { ReactNode, useMemo, useState } from 'react';
import {
  LayoutChangeEvent,
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
  Polygon,
  Rect,
  Text as SvgText,
} from 'react-native-svg';

import {
  buildEvidenceClockWindowAccessibilitySummary,
  buildEvidenceClockWindowScale,
  buildEvidenceClockWindowTicks,
  EvidenceClockWindowAggregatePoint,
  EvidenceClockWindowDomain,
  EvidenceClockWindowOccurrence,
  EvidenceClockWindowTargetRange,
  evidenceClockWindowPath,
  formatEvidenceClockMinute,
  formatEvidenceClockWindow,
  formatEvidenceClockWindowValue,
  prepareEvidenceClockWindowAggregate,
  prepareEvidenceClockWindowSegments,
  projectEvidenceClockMinute,
  resolveEvidenceClockWindowDomain,
} from '@/domain/evidenceClockWindowChart';
import { useGlucoseAppearance } from '@/providers/GlucoseAppearanceProvider';
import { useAppTheme } from '@/theme/theme';

import { ChartExpandButton } from './FullscreenChart';

const COMPACT_HEIGHT = 286;
const TOP = 18;
const LEFT = 8;
const RIGHT = 48;
const DARK_TRACE_COLORS = [
  '#42B8D0',
  '#F3B85B',
  '#A78BFA',
  '#55D7A0',
  '#F08BA6',
  '#7AA7FF',
  '#D6C46A',
];
const LIGHT_TRACE_COLORS = [
  '#087F99',
  '#8A5200',
  '#6C4FB3',
  '#087A5C',
  '#A13B5B',
  '#356AC3',
  '#6B6400',
];
const TRACE_DASHES = [undefined, '8 4', '2 4', '10 3 2 3'] as const;
const MARKERS = ['circle', 'square', 'diamond', 'triangle'] as const;

type Marker = (typeof MARKERS)[number];

export interface EvidenceClockWindowOverlayProps {
  aggregatePoints: EvidenceClockWindowAggregatePoint[];
  accessibilitySummary?: string;
  coverageSummary: string;
  domain: EvidenceClockWindowDomain;
  emptyMessage?: string;
  expanded?: boolean;
  gapThresholdMinutes?: number;
  minimumAggregateContributors: number;
  missingOccurrenceLabels?: string[];
  onExpand?(): void;
  subtitle: string;
  targetRange?: EvidenceClockWindowTargetRange;
  title: string;
  units: string;
  windows: EvidenceClockWindowOccurrence[];
}

function traceStyle(index: number, dark: boolean) {
  const palette = dark ? DARK_TRACE_COLORS : LIGHT_TRACE_COLORS;
  return {
    color: palette[index % palette.length]!,
    dash: TRACE_DASHES[Math.floor(index / palette.length) % TRACE_DASHES.length],
    marker: MARKERS[index % MARKERS.length]!,
  };
}

function markerNode({
  color,
  cx,
  cy,
  fill,
  key,
  marker,
  radius,
}: {
  color: string;
  cx: number;
  cy: number;
  fill: string;
  key: string;
  marker: Marker;
  radius: number;
}): ReactNode {
  if (marker === 'square') {
    return (
      <Rect
        fill={fill}
        height={radius * 2}
        key={key}
        rx={1.5}
        stroke={color}
        strokeWidth={1.5}
        width={radius * 2}
        x={cx - radius}
        y={cy - radius}
      />
    );
  }
  if (marker === 'diamond') {
    return (
      <Polygon
        fill={fill}
        key={key}
        points={`${cx},${cy - radius} ${cx + radius},${cy} ${cx},${cy + radius} ${cx - radius},${cy}`}
        stroke={color}
        strokeWidth={1.5}
      />
    );
  }
  if (marker === 'triangle') {
    return (
      <Polygon
        fill={fill}
        key={key}
        points={`${cx},${cy - radius} ${cx + radius},${cy + radius} ${cx - radius},${cy + radius}`}
        stroke={color}
        strokeWidth={1.5}
      />
    );
  }
  return (
    <Circle
      cx={cx}
      cy={cy}
      fill={fill}
      key={key}
      r={radius}
      stroke={color}
      strokeWidth={1.5}
    />
  );
}

function LegendSample({
  color,
  dash,
  marker,
}: {
  color: string;
  dash?: string;
  marker: Marker;
}) {
  return (
    <Svg accessibilityElementsHidden height={16} width={32}>
      <Line
        stroke={color}
        strokeDasharray={dash}
        strokeWidth={2}
        x1={1}
        x2={31}
        y1={8}
        y2={8}
      />
      {markerNode({
        color,
        cx: 16,
        cy: 8,
        fill: color,
        key: 'legend-marker',
        marker,
        radius: 3,
      })}
    </Svg>
  );
}

function missingLabels(
  windows: EvidenceClockWindowOccurrence[],
  labels: string[],
) {
  return [
    ...new Set([
      ...labels,
      ...windows
        .filter((window) => window.status === 'missing')
        .map((window) => window.label),
    ]),
  ].filter(Boolean);
}

export function EvidenceClockWindowOverlay({
  accessibilitySummary,
  aggregatePoints,
  coverageSummary,
  domain,
  emptyMessage = 'No glucose readings matched this clock window.',
  expanded = false,
  gapThresholdMinutes = 20,
  minimumAggregateContributors,
  missingOccurrenceLabels = [],
  onExpand,
  subtitle,
  targetRange,
  title,
  units,
  windows,
}: EvidenceClockWindowOverlayProps) {
  const { colors, dark, radius } = useAppTheme();
  const { settings: appearance } = useGlucoseAppearance();
  const screen = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const height = expanded
    ? Math.max(220, Math.min(310, screen.height - 170))
    : COMPACT_HEIGHT;
  const bottom = height - 52;
  const resolved = useMemo(() => {
    try {
      return resolveEvidenceClockWindowDomain(domain);
    } catch {
      return null;
    }
  }, [domain]);
  const preparedWindows = useMemo(
    () =>
      resolved
        ? windows
            .map((window, index) => ({
              index,
              segments: prepareEvidenceClockWindowSegments(
                window,
                resolved,
                gapThresholdMinutes,
              ),
              window,
            }))
            .filter(({ segments }) => segments.length > 0)
        : [],
    [gapThresholdMinutes, resolved, windows],
  );
  const aggregateSegments = useMemo(
    () =>
      resolved
        ? prepareEvidenceClockWindowAggregate(
            aggregatePoints,
            resolved,
            minimumAggregateContributors,
            gapThresholdMinutes,
          )
        : [],
    [
      aggregatePoints,
      gapThresholdMinutes,
      minimumAggregateContributors,
      resolved,
    ],
  );
  const values = useMemo(
    () => [
      ...preparedWindows.flatMap(({ segments }) =>
        segments.flatMap((segment) =>
          segment.map((point) => point.mmolL),
        ),
      ),
      ...aggregateSegments.flatMap((segment) =>
        segment.map((point) => point.mmolL),
      ),
    ],
    [aggregateSegments, preparedWindows],
  );
  const effectiveTargetRange = useMemo(() => {
    if (targetRange) return targetRange;
    const unitMultiplier = /mg\s*\/\s*dL/i.test(units) ? 18 : 1;
    return {
      maximum: appearance.targetMax * unitMultiplier,
      minimum: appearance.targetMin * unitMultiplier,
    };
  }, [appearance.targetMax, appearance.targetMin, targetRange, units]);
  const scale = useMemo(
    () => buildEvidenceClockWindowScale(values, effectiveTargetRange),
    [effectiveTargetRange, values],
  );
  const summary = useMemo(
    () =>
      accessibilitySummary ??
      buildEvidenceClockWindowAccessibilitySummary({
        aggregatePoints,
        coverageSummary,
        domain,
        gapThresholdMinutes,
        minimumAggregateContributors,
        missingOccurrenceLabels,
        targetRange: effectiveTargetRange,
        title,
        units,
        windows,
      }),
    [
      accessibilitySummary,
      aggregatePoints,
      coverageSummary,
      domain,
      gapThresholdMinutes,
      minimumAggregateContributors,
      missingOccurrenceLabels,
      effectiveTargetRange,
      title,
      units,
      windows,
    ],
  );
  const missing = useMemo(
    () => missingLabels(windows, missingOccurrenceLabels),
    [missingOccurrenceLabels, windows],
  );
  const contributorSummary = useMemo(() => {
    const visible = aggregateSegments.flat();
    if (!visible.length) return null;
    const counts = visible.map((point) => point.contributingWindowCount);
    const minimum = Math.min(...counts);
    const maximum = Math.max(...counts);
    return minimum === maximum
      ? `${minimum} occurrences contribute to each average point`
      : `${minimum}–${maximum} occurrences contribute across the average line`;
  }, [aggregateSegments]);
  const clockTransitions = windows.flatMap(
    (window) => window.clockTransitions ?? [],
  );
  const hasGaps = preparedWindows.some(({ segments, window }) => {
    if (segments.length <= 1) return false;
    const supplied = window.segments?.filter(
      (segment) => segment.points.length > 0,
    );
    if (!supplied?.length) return true;
    return supplied.slice(1).some(
      (segment) => segment.startsAfter?.sensorGap ?? true,
    );
  });
  const hasClockChanges = clockTransitions.length > 0;
  const plotWidth = Math.max(1, width - LEFT - RIGHT);
  const plotHeight = Math.max(1, bottom - TOP);
  const x = (minute: number) =>
    resolved
      ? LEFT + projectEvidenceClockMinute(minute, resolved, plotWidth)
      : LEFT;
  const y = (value: number) =>
    TOP +
    ((scale.maximum - Math.max(scale.minimum, Math.min(scale.maximum, value))) /
      Math.max(1, scale.maximum - scale.minimum)) *
      plotHeight;
  const ticks = resolved
    ? buildEvidenceClockWindowTicks(resolved, width >= 520 ? 7 : 5)
    : [];
  const invalidDomain = !resolved;
  const hasVisibleValues = values.length > 0;

  function onLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  return (
    <View>
      {!expanded ? (
        <View style={styles.titleRow}>
          <View style={styles.titleCopy}>
            <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {subtitle}
            </Text>
          </View>
          {onExpand ? (
            <ChartExpandButton
              label={`Open ${title} full screen`}
              onPress={onExpand}
            />
          ) : null}
        </View>
      ) : null}

      <View style={styles.metaRow}>
        <View
          style={[
            styles.coverageChip,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
              borderRadius: radius.pill,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.primary}
            name="scan-outline"
            size={14}
          />
          <Text style={[styles.coverageText, { color: colors.textSecondary }]}>
            {coverageSummary}
          </Text>
        </View>
        <Text style={[styles.unitText, { color: colors.textTertiary }]}>
          {units}
        </Text>
      </View>

      <View
        accessible
        accessibilityLabel={summary}
        accessibilityRole="image"
        onLayout={onLayout}
        style={[
          styles.chart,
          {
            backgroundColor: colors.background,
            borderColor: colors.divider,
            borderRadius: radius.md,
            height,
          },
        ]}
      >
        {invalidDomain || !hasVisibleValues ? (
          <View style={styles.emptyState}>
            <View
              style={[
                styles.emptyIcon,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderColor: colors.border,
                  borderRadius: radius.pill,
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={invalidDomain ? colors.warning : colors.textTertiary}
                name={invalidDomain ? 'warning-outline' : 'analytics-outline'}
                size={22}
              />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {invalidDomain ? 'Unable to display this time window' : emptyMessage}
            </Text>
            <Text
              style={[styles.emptyDetail, { color: colors.textSecondary }]}
            >
              {invalidDomain
                ? 'The evidence contains an invalid local clock range.'
                : resolved
                  ? `${formatEvidenceClockWindow(resolved)} · ${coverageSummary}`
                  : coverageSummary}
            </Text>
            {missing.length ? (
              <Text style={[styles.emptyMissing, { color: colors.textTertiary }]}>
                No readings: {missing.join(', ')}
              </Text>
            ) : null}
          </View>
        ) : width > 0 && resolved ? (
          <Svg accessibilityElementsHidden height={height} width={width}>
            {effectiveTargetRange ? (
              <Rect
                fill={colors.targetBand}
                height={Math.max(
                  0,
                  y(effectiveTargetRange.minimum) -
                    y(effectiveTargetRange.maximum),
                )}
                opacity={0.66}
                width={plotWidth}
                x={LEFT}
                y={y(effectiveTargetRange.maximum)}
              />
            ) : null}

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
                  fontSize={9}
                  x={LEFT + plotWidth + 7}
                  y={y(tick) + 3}
                >
                  {formatEvidenceClockWindowValue(tick, units)}
                </SvgText>
              </G>
            ))}

            {preparedWindows.map(({ index, segments, window }) => {
              const visual = traceStyle(index, dark);
              const finalSegment = segments[segments.length - 1]!;
              const finalPoint = finalSegment[finalSegment.length - 1]!;
              return (
                <G key={window.id}>
                  {segments.map((segment, segmentIndex) => (
                    <G key={`${window.id}-${segmentIndex}`}>
                      {segment.length > 1 ? (
                        <Path
                          d={evidenceClockWindowPath(segment, x, y)}
                          fill="none"
                          opacity={0.76}
                          stroke={visual.color}
                          strokeDasharray={visual.dash}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.65}
                        />
                      ) : null}
                      {markerNode({
                        color: visual.color,
                        cx: x(segment[0]!.minute),
                        cy: y(segment[0]!.mmolL),
                        fill: colors.background,
                        key: `${window.id}-${segmentIndex}-start`,
                        marker: visual.marker,
                        radius: 2.8,
                      })}
                      {segment.length > 1
                        ? markerNode({
                            color: visual.color,
                            cx: x(segment[segment.length - 1]!.minute),
                            cy: y(segment[segment.length - 1]!.mmolL),
                            fill: colors.background,
                            key: `${window.id}-${segmentIndex}-end`,
                            marker: visual.marker,
                            radius: 2.8,
                          })
                        : null}
                    </G>
                  ))}
                  {markerNode({
                    color: visual.color,
                    cx: x(finalPoint.minute),
                    cy: y(finalPoint.mmolL),
                    fill: colors.surface,
                    key: `${window.id}-label-marker`,
                    marker: visual.marker,
                    radius: 6.5,
                  })}
                  <SvgText
                    fill={visual.color}
                    fontSize={7.5}
                    fontWeight="800"
                    textAnchor="middle"
                    x={x(finalPoint.minute)}
                    y={y(finalPoint.mmolL) + 2.6}
                  >
                    {index + 1}
                  </SvgText>
                </G>
              );
            })}

            {aggregateSegments.map((segment, index) => (
              <G key={`aggregate-${index}`}>
                {segment.length > 1 ? (
                  <Path
                    d={evidenceClockWindowPath(segment, x, y)}
                    fill="none"
                    stroke={colors.accent}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={3.4}
                  />
                ) : null}
                {segment.map((point, pointIndex) => (
                  <Circle
                    cx={x(point.minute)}
                    cy={y(point.mmolL)}
                    fill={colors.accent}
                    key={`aggregate-${index}-${pointIndex}`}
                    opacity={pointIndex % 2 === 0 ? 0.9 : 0.55}
                    r={1.7}
                  />
                ))}
              </G>
            ))}

            {ticks.map((minute, index) => (
              <G key={minute}>
                <Line
                  stroke={colors.grid}
                  strokeWidth={1}
                  x1={x(minute)}
                  x2={x(minute)}
                  y1={bottom}
                  y2={bottom + 4}
                />
                <SvgText
                  fill={colors.textTertiary}
                  fontSize={9}
                  textAnchor={
                    index === 0
                      ? 'start'
                      : index === ticks.length - 1
                        ? 'end'
                        : 'middle'
                  }
                  x={x(minute)}
                  y={bottom + 19}
                >
                  {formatEvidenceClockMinute(minute)}
                </SvgText>
              </G>
            ))}
            <SvgText
              fill={colors.textTertiary}
              fontSize={8.5}
              letterSpacing={0.4}
              textAnchor="middle"
              x={LEFT + plotWidth / 2}
              y={bottom + 39}
            >
              LOCAL TIME · EXACT REQUESTED WINDOW
            </SvgText>
          </Svg>
        ) : null}
      </View>

      {hasVisibleValues ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.legend}
        >
          {aggregateSegments.length ? (
            <View style={styles.legendItem}>
              <LegendSample
                color={colors.accent}
                marker="circle"
              />
              <Text style={[styles.legendText, { color: colors.textSecondary }]}>
                15-minute average
              </Text>
            </View>
          ) : null}
          {preparedWindows.map(({ index, window }) => {
            const visual = traceStyle(index, dark);
            return (
              <View key={window.id} style={styles.legendItem}>
                <LegendSample
                  color={visual.color}
                  dash={visual.dash}
                  marker={visual.marker}
                />
                <Text
                  style={[styles.legendIndex, { color: visual.color }]}
                >
                  {index + 1}
                </Text>
                <Text
                  style={[styles.legendText, { color: colors.textSecondary }]}
                >
                  {window.label}
                  {window.status === 'partial' ? ' · partial' : ''}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {contributorSummary || hasGaps || hasClockChanges || missing.length ? (
        <View
          style={[
            styles.notes,
            { borderColor: colors.divider },
          ]}
        >
          {contributorSummary ? (
            <View style={styles.noteRow}>
              <Ionicons
                accessibilityElementsHidden
                color={colors.accent}
                name="git-merge-outline"
                size={14}
              />
              <Text style={[styles.noteText, { color: colors.textSecondary }]}>
                {contributorSummary}.
              </Text>
            </View>
          ) : null}
          {hasGaps ? (
            <View style={styles.noteRow}>
              <Ionicons
                accessibilityElementsHidden
                color={colors.textTertiary}
                name="cut-outline"
                size={14}
              />
              <Text style={[styles.noteText, { color: colors.textSecondary }]}>
                Lines stop wherever readings are missing.
              </Text>
            </View>
          ) : null}
          {hasClockChanges ? (
            <View style={styles.noteRow}>
              <Ionicons
                accessibilityElementsHidden
                color={colors.textTertiary}
                name="time-outline"
                size={14}
              />
              <Text style={[styles.noteText, { color: colors.textSecondary }]}>
                The trace splits where the London clock changes; this is not a
                missing sensor interval.
              </Text>
            </View>
          ) : null}
          {missing.length ? (
            <View style={styles.noteRow}>
              <Ionicons
                accessibilityElementsHidden
                color={colors.warning}
                name="remove-circle-outline"
                size={14}
              />
              <Text style={[styles.noteText, { color: colors.textSecondary }]}>
                No readings: {missing.join(', ')}.
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
  },
  titleCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 24,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    marginTop: 12,
  },
  coverageChip: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  coverageText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 15,
  },
  unitText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  chart: {
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 10,
    overflow: 'hidden',
    width: '100%',
  },
  emptyState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyIcon: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
    marginTop: 10,
    textAlign: 'center',
  },
  emptyDetail: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
    textAlign: 'center',
  },
  emptyMissing: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 8,
    textAlign: 'center',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  legendIndex: {
    fontSize: 9,
    fontWeight: '900',
    lineHeight: 13,
  },
  legendText: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 14,
  },
  notes: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 6,
    marginTop: 10,
    paddingTop: 9,
  },
  noteRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 7,
  },
  noteText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 15,
  },
});
