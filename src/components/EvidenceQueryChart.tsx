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

import {
  buildEvidenceQueryAccessibilitySummary,
  buildEvidenceQueryTimeTicks,
  buildEvidenceQueryValueTicks,
  EvidenceQueryChartWindow,
  EvidenceQueryVisualizationReference,
  evidenceQueryPath,
  formatEvidenceQueryRange,
  formatEvidenceQueryTick,
  formatEvidenceQueryTimestamp,
  isEvidenceQueryVisualizationReference,
  projectEvidenceQueryTimestamp,
  segmentEvidenceQueryPoints,
} from '@/domain/evidenceQueryChart';
import { useAppTheme } from '@/theme/theme';

import { ChartExpandButton } from './FullscreenChart';

const LEFT = 10;
const RIGHT = 43;
const TRACE_COLORS_DARK = ['#61C9DE', '#F3B85B', '#BBA6F5', '#69D5AC'];
const TRACE_COLORS_LIGHT = ['#087F99', '#8A5200', '#6C4FB3', '#087A5C'];
const TRACE_DASHES = [undefined, '8 4', '2 4', '10 3 2 3'] as const;
const TRACE_PATTERN_LABELS = ['solid', 'dashed', 'dotted', 'dash-dot'] as const;

interface Props {
  expanded?: boolean;
  onExpand?(): void;
  onShowRecords?(): void;
  visualization: EvidenceQueryVisualizationReference;
}

function DataAlternativeButton({ onPress }: { onPress(): void }) {
  const { colors, radius } = useAppTheme();
  return (
    <Pressable
      accessibilityHint="Switches to the complete text list of exact records used for this chart."
      accessibilityLabel="View chart data as exact records"
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.dataButton,
        {
          backgroundColor: pressed
            ? colors.surfaceElevated
            : colors.surfaceMuted,
          borderColor: colors.border,
          borderRadius: radius.md,
        },
      ]}
    >
      <Ionicons
        accessibilityElementsHidden
        color={colors.primary}
        name="list-outline"
        size={19}
      />
      <View style={styles.dataButtonCopy}>
        <Text style={[styles.dataButtonTitle, { color: colors.text }]}>
          View chart data as exact records
        </Text>
        <Text style={[styles.dataButtonDetail, { color: colors.textSecondary }]}>
          Complete paged text alternative for the supporting records
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
}

function coverageLabel(window: EvidenceQueryChartWindow) {
  if (window.coverageStatus === 'unavailable' || window.recordCount === 0) {
    return 'No sensor readings';
  }
  return `${window.coveragePercent.toFixed(1)}% coverage${
    window.coverageStatus === 'limited' ? ' - limited' : ''
  }`;
}

function WindowHeading({ window }: { window: EvidenceQueryChartWindow }) {
  const { colors, radius } = useAppTheme();
  return (
    <View style={styles.windowHeading}>
      <View style={styles.windowHeadingCopy}>
        <Text style={[styles.windowTitle, { color: colors.text }]}>
          {window.label}
        </Text>
        <Text style={[styles.windowRange, { color: colors.textSecondary }]}>
          {formatEvidenceQueryRange(window.range)}
        </Text>
      </View>
      <View
        style={[
          styles.coverageChip,
          {
            backgroundColor:
              window.coverageStatus === 'unavailable'
                ? `${colors.danger}12`
                : window.coverageStatus === 'limited'
                  ? `${colors.warning}12`
                  : colors.surfaceMuted,
            borderColor:
              window.coverageStatus === 'unavailable'
                ? `${colors.danger}55`
                : window.coverageStatus === 'limited'
                  ? `${colors.warning}55`
                  : colors.border,
            borderRadius: radius.pill,
          },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={
            window.coverageStatus === 'unavailable'
              ? colors.danger
              : window.coverageStatus === 'limited'
                ? colors.warning
                : colors.primary
          }
          name={
            window.coverageStatus === 'unavailable'
              ? 'remove-circle-outline'
              : window.coverageStatus === 'limited'
                ? 'warning-outline'
                : 'checkmark-circle-outline'
          }
          size={14}
        />
        <Text style={[styles.coverageText, { color: colors.textSecondary }]}>
          {coverageLabel(window)}
        </Text>
      </View>
    </View>
  );
}

function EmptyWindow({ window }: { window: EvidenceQueryChartWindow }) {
  const { colors, radius } = useAppTheme();
  return (
    <View
      style={[
        styles.empty,
        {
          backgroundColor: colors.background,
          borderColor: colors.border,
          borderRadius: radius.md,
        },
      ]}
    >
      <Ionicons
        accessibilityElementsHidden
        color={colors.textTertiary}
        name="analytics-outline"
        size={22}
      />
      <View style={styles.emptyCopy}>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          No readings in this exact period
        </Text>
        <Text style={[styles.emptyDetail, { color: colors.textSecondary }]}>
          The axis remains {formatEvidenceQueryRange(window.range)}. No values
          were inferred for missing sensor time.
        </Text>
      </View>
    </View>
  );
}

function SamplingNote({ window }: { window: EvidenceQueryChartWindow }) {
  const { colors } = useAppTheme();
  if (!window.sampling) return null;
  return (
    <View style={styles.noteRow}>
      <Ionicons
        accessibilityElementsHidden
        color={colors.accent}
        name="contract-outline"
        size={14}
      />
      <Text style={[styles.noteText, { color: colors.textSecondary }]}>
        Displaying {window.sampling.displayedPointCount} of{' '}
        {window.sampling.sourceSampleCount} timestamp-normalised samples using
        a deterministic min/max time-bucket envelope. The calculation and All
        records retain all {window.sampling.sourceRecordCount} exact source
        records.
      </Text>
    </View>
  );
}

function TracePanels({
  expanded,
  visualization,
}: {
  expanded: boolean;
  visualization: Extract<
    EvidenceQueryVisualizationReference,
    { kind: 'range-trace-v1' | 'period-comparison-v1' }
  >;
}) {
  const { colors, dark, radius } = useAppTheme();
  const screen = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const comparison = visualization.windows.length > 1;
  const panelHeight = expanded
    ? Math.max(210, Math.min(280, screen.height - 150))
    : comparison
      ? 190
      : 278;
  const top = 16;
  const bottom = panelHeight - 45;
  const plotWidth = Math.max(1, width - LEFT - RIGHT);
  const plotHeight = bottom - top;
  const y = (value: number) =>
    top +
    ((visualization.valueDomain.maximum -
      Math.max(
        visualization.valueDomain.minimum,
        Math.min(visualization.valueDomain.maximum, value),
      )) /
      (visualization.valueDomain.maximum - visualization.valueDomain.minimum)) *
      plotHeight;
  const valueTicks = buildEvidenceQueryValueTicks(
    visualization.valueDomain,
    expanded ? 6 : 5,
  );
  const palette = dark ? TRACE_COLORS_DARK : TRACE_COLORS_LIGHT;

  function onLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  return (
    <View onLayout={onLayout}>
      {visualization.windows.map((window, windowIndex) => {
        const segments = segmentEvidenceQueryPoints(
          window.points,
          window.range,
          visualization.gapThresholdMilliseconds,
        );
        const ticks = buildEvidenceQueryTimeTicks(
          window.range,
          expanded || width >= 520 ? 7 : 4,
        );
        const x = (timestamp: number) =>
          LEFT + projectEvidenceQueryTimestamp(timestamp, window.range, plotWidth);
        const traceColor = palette[windowIndex % palette.length]!;
        const traceDash = TRACE_DASHES[windowIndex % TRACE_DASHES.length];
        return (
          <View key={window.id} style={windowIndex ? styles.panelSpacing : undefined}>
            <WindowHeading window={window} />
            {!window.points.length ? (
              <EmptyWindow window={window} />
            ) : (
              <View
                style={[
                  styles.svgFrame,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.divider,
                    borderRadius: radius.md,
                    height: panelHeight,
                  },
                ]}
              >
                {width > 0 ? (
                  <Svg accessibilityElementsHidden height={panelHeight} width={width}>
                    <Rect
                      fill={colors.targetBand}
                      height={Math.max(
                        0,
                        y(visualization.targetRange.minimum) -
                          y(visualization.targetRange.maximum),
                      )}
                      opacity={0.68}
                      width={plotWidth}
                      x={LEFT}
                      y={y(visualization.targetRange.maximum)}
                    />
                    {valueTicks.map((tick) => (
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
                          fontSize={8.5}
                          x={LEFT + plotWidth + 6}
                          y={y(tick) + 3}
                        >
                          {tick.toFixed(tick % 1 ? 1 : 0)}
                        </SvgText>
                      </G>
                    ))}
                    {window.meanMmolL !== null ? (
                      <G>
                        <Line
                          stroke={colors.accent}
                          strokeDasharray="10 4"
                          strokeWidth={2}
                          x1={LEFT}
                          x2={LEFT + plotWidth}
                          y1={y(window.meanMmolL)}
                          y2={y(window.meanMmolL)}
                        />
                        <SvgText
                          fill={colors.accent}
                          fontSize={8.5}
                          fontWeight="800"
                          textAnchor="end"
                          x={LEFT + plotWidth - 3}
                          y={y(window.meanMmolL) - 5}
                        >
                          MEAN {window.meanMmolL.toFixed(1)}
                        </SvgText>
                      </G>
                    ) : null}
                    {segments.map((segment, segmentIndex) => (
                      <G key={`${window.id}-${segmentIndex}`}>
                        {segment.length > 1 ? (
                          <Path
                            d={evidenceQueryPath(segment, x, y)}
                            fill="none"
                            stroke={traceColor}
                            strokeDasharray={traceDash}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                          />
                        ) : null}
                        <Circle
                          cx={x(segment[0]!.timestamp)}
                          cy={y(segment[0]!.mmolL)}
                          fill={colors.background}
                          r={3}
                          stroke={traceColor}
                          strokeWidth={2}
                        />
                        {segment.length > 1 ? (
                          <Rect
                            fill={colors.background}
                            height={6}
                            stroke={traceColor}
                            strokeWidth={2}
                            width={6}
                            x={x(segment.at(-1)!.timestamp) - 3}
                            y={y(segment.at(-1)!.mmolL) - 3}
                          />
                        ) : null}
                      </G>
                    ))}
                    {ticks.map((tick, index) => (
                      <G key={tick}>
                        <Line
                          stroke={colors.grid}
                          strokeWidth={1}
                          x1={x(tick)}
                          x2={x(tick)}
                          y1={bottom}
                          y2={bottom + 4}
                        />
                        <SvgText
                          fill={colors.textTertiary}
                          fontSize={8.5}
                          textAnchor={
                            index === 0
                              ? 'start'
                              : index === ticks.length - 1
                                ? 'end'
                                : 'middle'
                          }
                          x={x(tick)}
                          y={bottom + 18}
                        >
                          {formatEvidenceQueryTick(tick, window.range)}
                        </SvgText>
                      </G>
                    ))}
                    <SvgText
                      fill={colors.textTertiary}
                      fontSize={8}
                      letterSpacing={0.45}
                      textAnchor="middle"
                      x={LEFT + plotWidth / 2}
                      y={bottom + 36}
                    >
                      EXACT REQUESTED PERIOD - EUROPE/LONDON
                    </SvgText>
                  </Svg>
                ) : null}
              </View>
            )}
            {segments.length > 1 ? (
              <View style={styles.noteRow}>
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.textTertiary}
                  name="cut-outline"
                  size={14}
                />
                <Text style={[styles.noteText, { color: colors.textSecondary }]}>
                  Lines stop across {segments.length - 1} sensor gap
                  {segments.length === 2 ? '' : 's'}; missing time is blank.
                </Text>
              </View>
            ) : null}
            <SamplingNote window={window} />
          </View>
        );
      })}
      {comparison ? (
        <View style={styles.legendRow}>
          {visualization.windows.map((window, index) => (
            <View key={window.id} style={styles.legendItem}>
              <View
                style={[
                  styles.legendLine,
                  {
                    backgroundColor: palette[index % palette.length],
                    borderStyle: index % 2 ? 'dashed' : 'solid',
                  },
                ]}
              />
              <Text style={[styles.legendText, { color: colors.textSecondary }]}>
                {index + 1}. {window.label} -{' '}
                {TRACE_PATTERN_LABELS[index % TRACE_PATTERN_LABELS.length]}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.noteRow}>
        <Ionicons
          accessibilityElementsHidden
          color={colors.accent}
          name="color-fill-outline"
          size={14}
        />
        <Text style={[styles.noteText, { color: colors.textSecondary }]}>
          Shaded band: {visualization.targetRange.minimum.toFixed(1)} to{' '}
          {visualization.targetRange.maximum.toFixed(1)} mmol/L.
          {visualization.windows.some((window) => window.meanMmolL !== null)
            ? ' The dashed horizontal line is the observed mean.'
            : ''}
        </Text>
      </View>
    </View>
  );
}

const DISTRIBUTION_KEYS = [
  { key: 'belowPercent', label: 'Below', symbol: 'B' },
  { key: 'inRangePercent', label: 'In range', symbol: 'IN' },
  { key: 'abovePercent', label: 'Above', symbol: 'A' },
] as const;

function DistributionPanels({
  visualization,
}: {
  visualization: Extract<
    EvidenceQueryVisualizationReference,
    { kind: 'range-distribution-v1' }
  >;
}) {
  const { colors, radius } = useAppTheme();
  const distributionColors = [colors.low, colors.accent, colors.high];
  return (
    <View>
      <View style={styles.thresholdRow}>
        <Ionicons
          accessibilityElementsHidden
          color={colors.accent}
          name="resize-outline"
          size={16}
        />
        <Text style={[styles.thresholdText, { color: colors.textSecondary }]}>
          Observed-time range: {visualization.lowerBoundMmolL.toFixed(1)} to{' '}
          {visualization.upperBoundMmolL.toFixed(1)} mmol/L
        </Text>
      </View>
      {visualization.windows.map((window, windowIndex) => {
        const distribution = window.distribution;
        const available =
          window.recordCount > 0 &&
          distribution?.belowPercent !== null &&
          distribution?.inRangePercent !== null &&
          distribution?.abovePercent !== null;
        return (
          <View
            key={window.id}
            style={windowIndex ? styles.panelSpacing : undefined}
          >
            <WindowHeading window={window} />
            {!available || !distribution ? (
              <EmptyWindow window={window} />
            ) : (
              <View
                style={[
                  styles.distributionCard,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.divider,
                    borderRadius: radius.md,
                  },
                ]}
              >
                <View style={[styles.distributionBar, { borderRadius: radius.sm }]}>
                  {DISTRIBUTION_KEYS.map(({ key, symbol }, index) => {
                    const value = distribution[key] ?? 0;
                    if (value <= 0) return null;
                    return (
                      <View
                        key={key}
                        style={[
                          styles.distributionSegment,
                          {
                            backgroundColor: distributionColors[index],
                            flexGrow: value,
                          },
                        ]}
                      >
                        {value >= 9 ? (
                          <Text style={[styles.segmentSymbol, { color: colors.background }]}>
                            {symbol}
                          </Text>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
                <View style={styles.distributionLegend}>
                  {DISTRIBUTION_KEYS.map(({ key, label, symbol }, index) => (
                    <View key={key} style={styles.distributionLegendItem}>
                      <View
                        style={[
                          styles.distributionSymbol,
                          {
                            backgroundColor: distributionColors[index],
                            borderRadius: radius.pill,
                          },
                        ]}
                      >
                        <Text style={[styles.distributionSymbolText, { color: colors.background }]}>
                          {symbol}
                        </Text>
                      </View>
                      <Text style={[styles.distributionLabel, { color: colors.textSecondary }]}>
                        {label}
                      </Text>
                      <Text style={[styles.distributionValue, { color: colors.text }]}>
                        {(distribution[key] ?? 0).toFixed(1)}%
                      </Text>
                    </View>
                  ))}
                </View>
                <Text style={[styles.denominatorText, { color: colors.textTertiary }]}>
                  Percentages use observed sensor duration only. Missing time is
                  excluded, not counted as in range.
                </Text>
              </View>
            )}
            <SamplingNote window={window} />
          </View>
        );
      })}
    </View>
  );
}

function EventPanels({
  expanded,
  visualization,
}: {
  expanded: boolean;
  visualization: Extract<
    EvidenceQueryVisualizationReference,
    { kind: 'event-timeline-v1' }
  >;
}) {
  const { colors, radius } = useAppTheme();
  const [width, setWidth] = useState(0);
  const plotWidth = Math.max(1, width - LEFT * 2);
  const eventColor =
    visualization.eventKind === 'low' ? colors.low : colors.high;

  function onLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  return (
    <View onLayout={onLayout}>
      <View style={styles.thresholdRow}>
        <Ionicons
          accessibilityElementsHidden
          color={eventColor}
          name={visualization.eventKind === 'low' ? 'trending-down' : 'trending-up'}
          size={16}
        />
        <Text style={[styles.thresholdText, { color: colors.textSecondary }]}>
          Sustained {visualization.eventKind} threshold:{' '}
          {visualization.eventKind === 'low' ? 'below' : 'above'}{' '}
          {visualization.thresholdMmolL.toFixed(1)} mmol/L
        </Text>
      </View>
      {visualization.windows.map((window, windowIndex) => {
        const events = window.events.filter(
          (event) =>
            event.kind === visualization.eventKind &&
            event.start >= window.range.start &&
            event.start < window.range.end,
        );
        const ticks = buildEvidenceQueryTimeTicks(
          window.range,
          expanded || width >= 520 ? 7 : 4,
        );
        const x = (timestamp: number) =>
          LEFT +
          projectEvidenceQueryTimestamp(
            Math.max(window.range.start, Math.min(window.range.end, timestamp)),
            window.range,
            plotWidth,
          );
        return (
          <View
            key={window.id}
            style={windowIndex ? styles.panelSpacing : undefined}
          >
            <WindowHeading window={window} />
            {!window.points.length ? (
              <EmptyWindow window={window} />
            ) : (
              <View
                style={[
                  styles.eventCard,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.divider,
                    borderRadius: radius.md,
                  },
                ]}
              >
                <Text style={[styles.eventCount, { color: eventColor }]}>
                  {events.length} sustained {visualization.eventKind} event
                  {events.length === 1 ? '' : 's'} started in this period
                </Text>
                <View style={styles.eventSvg}>
                  {width > 0 ? (
                    <Svg accessibilityElementsHidden height={76} width={width}>
                      <Line
                        stroke={colors.grid}
                        strokeWidth={4}
                        x1={LEFT}
                        x2={LEFT + plotWidth}
                        y1={24}
                        y2={24}
                      />
                      {events.map((event, index) => {
                        const startX = x(event.start);
                        const endX = Math.max(startX + 4, x(event.end));
                        return (
                          <G key={event.id}>
                            <Rect
                              fill={eventColor}
                              height={16}
                              opacity={0.74}
                              rx={4}
                              width={Math.min(LEFT + plotWidth - startX, endX - startX)}
                              x={startX}
                              y={16}
                            />
                            <Circle
                              cx={startX}
                              cy={24}
                              fill={colors.background}
                              r={4}
                              stroke={eventColor}
                              strokeWidth={2}
                            />
                            {endX - startX > 26 ? (
                              <SvgText
                                fill={colors.background}
                                fontSize={8}
                                fontWeight="800"
                                textAnchor="middle"
                                x={(startX + endX) / 2}
                                y={27}
                              >
                                {index + 1}
                              </SvgText>
                            ) : null}
                          </G>
                        );
                      })}
                      {ticks.map((tick, index) => (
                        <SvgText
                          fill={colors.textTertiary}
                          fontSize={8.5}
                          key={tick}
                          textAnchor={
                            index === 0
                              ? 'start'
                              : index === ticks.length - 1
                                ? 'end'
                                : 'middle'
                          }
                          x={x(tick)}
                          y={56}
                        >
                          {formatEvidenceQueryTick(tick, window.range)}
                        </SvgText>
                      ))}
                      <SvgText
                        fill={colors.textTertiary}
                        fontSize={8}
                        letterSpacing={0.4}
                        textAnchor="middle"
                        x={LEFT + plotWidth / 2}
                        y={73}
                      >
                        EVENT STARTS - EXACT REQUESTED PERIOD
                      </SvgText>
                    </Svg>
                  ) : null}
                </View>
                {events.length ? (
                  <View style={[styles.eventList, { borderTopColor: colors.divider }]}>
                    {events.map((event, index) => (
                      <View key={event.id} style={styles.eventRow}>
                        <View
                          style={[
                            styles.eventIndex,
                            { backgroundColor: `${eventColor}22`, borderRadius: radius.pill },
                          ]}
                        >
                          <Text style={[styles.eventIndexText, { color: eventColor }]}>
                            {index + 1}
                          </Text>
                        </View>
                        <Text style={[styles.eventDetail, { color: colors.textSecondary }]}>
                          {formatEvidenceQueryTimestamp(event.start)} ·{' '}
                          {event.endStatus === 'confirmed-recovery'
                            ? `recovery confirmed at ${formatEvidenceQueryTimestamp(event.end)}`
                            : event.endStatus === 'observed-through'
                              ? `observed through ${formatEvidenceQueryTimestamp(event.end)}${
                                  event.continuesBeyondWindow
                                    ? '; may continue beyond this period'
                                    : '; recovery was not confirmed'
                                }`
                              : `legacy recorded end ${formatEvidenceQueryTimestamp(event.end)}`}{' '}
                          · extreme{' '}
                          {event.extremeMmolL.toFixed(1)} mmol/L
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={[styles.noEvents, { color: colors.textSecondary }]}>
                    Readings were present, but no event matching this sustained
                    threshold definition started in the period.
                  </Text>
                )}
              </View>
            )}
            <SamplingNote window={window} />
          </View>
        );
      })}
    </View>
  );
}

export function EvidenceQueryChart({
  expanded = false,
  onExpand,
  onShowRecords,
  visualization,
}: Props) {
  const { colors, radius } = useAppTheme();
  const valid = useMemo(
    () => isEvidenceQueryVisualizationReference(visualization),
    [visualization],
  );
  const summary = useMemo(
    () =>
      valid
        ? buildEvidenceQueryAccessibilitySummary(visualization)
        : 'This saved chart is unavailable because its evidence specification is invalid.',
    [valid, visualization],
  );
  const chart =
    visualization.kind === 'range-distribution-v1' ? (
      <DistributionPanels visualization={visualization} />
    ) : visualization.kind === 'event-timeline-v1' ? (
      <EventPanels expanded={expanded} visualization={visualization} />
    ) : (
      <TracePanels expanded={expanded} visualization={visualization} />
    );
  return (
    <View>
      {!expanded ? (
        <View style={styles.titleRow}>
          <View style={styles.titleCopy}>
            <Text style={[styles.title, { color: colors.text }]}>
              {visualization.title}
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {visualization.subtitle}
            </Text>
          </View>
          {onExpand && valid ? (
            <ChartExpandButton
              label={`Open ${visualization.title} full screen`}
              onPress={onExpand}
            />
          ) : null}
        </View>
      ) : null}
      <View
        accessible
        accessibilityLabel={summary}
        accessibilityRole="image"
        style={styles.chartBody}
      >
        {valid ? (
          chart
        ) : (
          <View
            style={[
              styles.empty,
              {
                backgroundColor: colors.background,
                borderColor: `${colors.warning}66`,
                borderRadius: radius.md,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.warning}
              name="warning-outline"
              size={22}
            />
            <View style={styles.emptyCopy}>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                This saved chart cannot be displayed
              </Text>
              <Text style={[styles.emptyDetail, { color: colors.textSecondary }]}>
                Its stored evidence does not match the exact chart contract, so
                no potentially misleading graph has been drawn.
              </Text>
            </View>
          </View>
        )}
      </View>
      {onShowRecords ? <DataAlternativeButton onPress={onShowRecords} /> : null}
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
  chartBody: {
    marginTop: 12,
  },
  windowHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  windowHeadingCopy: {
    flex: 1,
    minWidth: 0,
  },
  windowTitle: {
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 19,
  },
  windowRange: {
    fontSize: 10.5,
    lineHeight: 15,
    marginTop: 1,
  },
  coverageChip: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 5,
    minHeight: 28,
    paddingHorizontal: 9,
  },
  coverageText: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 14,
  },
  panelSpacing: {
    marginTop: 20,
  },
  svgFrame: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  empty: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    minHeight: 94,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  emptyCopy: {
    flex: 1,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 19,
  },
  emptyDetail: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  noteRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 6,
    marginTop: 7,
  },
  noteText: {
    flex: 1,
    fontSize: 10.5,
    lineHeight: 15,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  legendLine: {
    borderWidth: 1,
    height: 3,
    width: 22,
  },
  legendText: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 14,
  },
  thresholdRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    marginBottom: 13,
  },
  thresholdText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
  },
  distributionCard: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  distributionBar: {
    flexDirection: 'row',
    height: 52,
    overflow: 'hidden',
    width: '100%',
  },
  distributionSegment: {
    alignItems: 'center',
    flexBasis: 0,
    justifyContent: 'center',
    minWidth: 2,
  },
  segmentSymbol: {
    fontSize: 10,
    fontWeight: '900',
  },
  distributionLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 14,
  },
  distributionLegendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  distributionSymbol: {
    alignItems: 'center',
    height: 23,
    justifyContent: 'center',
    minWidth: 23,
    paddingHorizontal: 4,
  },
  distributionSymbolText: {
    fontSize: 8,
    fontWeight: '900',
  },
  distributionLabel: {
    fontSize: 10,
    fontWeight: '700',
  },
  distributionValue: {
    fontSize: 11,
    fontWeight: '900',
  },
  denominatorText: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 12,
  },
  eventCard: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  eventCount: {
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  eventSvg: {
    marginHorizontal: -4,
    marginTop: 6,
  },
  eventList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 9,
    marginTop: 8,
    paddingTop: 11,
  },
  eventRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 8,
  },
  eventIndex: {
    alignItems: 'center',
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  eventIndexText: {
    fontSize: 10,
    fontWeight: '900',
  },
  eventDetail: {
    flex: 1,
    fontSize: 10.5,
    lineHeight: 16,
  },
  noEvents: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 6,
  },
  dataButton: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    minHeight: 56,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  dataButtonCopy: {
    flex: 1,
  },
  dataButtonTitle: {
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
  },
  dataButtonDetail: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 1,
  },
});
