import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  PanResponder,
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
  BasalDelivery,
  BolusDelivery,
  APP_TIME_ZONE,
  GlucoseReading,
  InsulinDailyTotal,
  PumpStateInterval,
  TimelineData,
} from '@/domain/models';
import {
  buildColouredGlucoseSegments,
  buildGlucoseChartScale,
} from '@/domain/glucoseChart';
import {
  GLUCOSE_COLOR_PALETTE,
  glucoseRangeForValue,
} from '@/domain/glucoseAppearance';
import {
  DateKey,
  dayRange,
  formatTime,
  toDateKey,
} from '@/domain/time';
import {
  DEFAULT_GLUCOSE_GAP_THRESHOLD_MS,
  sampleGlucoseForChart,
} from '@/domain/timelineSampling';
import {
  describeInsulinTimelineFidelity,
  summarizeInsulinByDay,
} from '@/domain/timelineInsulinSummary';
import { presentTrend } from '@/domain/trend';
import { useGlucoseAppearance } from '@/providers/GlucoseAppearanceProvider';
import { useAppTheme } from '@/theme/theme';

import { EmptyState } from './EmptyState';
import {
  ChartExpandButton,
  FullscreenChartModal,
} from './FullscreenChart';
import { SectionCard } from './SectionCard';

const CHART_HEIGHT = 318;
const GLUCOSE_TOP = 18;
const GLUCOSE_BOTTOM = 182;
const INSULIN_TOP = 222;
const INSULIN_BOTTOM = 286;
const PLOT_LEFT = 6;
const AXIS_WIDTH = 35;
const MAX_BOLUS_UNITS = 7;
const GAP_THRESHOLD_MS = DEFAULT_GLUCOSE_GAP_THRESHOLD_MS;
const DAILY_INSULIN_SUMMARY_THRESHOLD_MS = 14 * 24 * 3_600_000;

function nearestByTimestamp<T>(
  items: T[],
  timestampFor: (item: T) => number,
  target: number,
) {
  let nearest: T | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  items.forEach((item) => {
    const distance = Math.abs(timestampFor(item) - target);
    if (distance < nearestDistance) {
      nearest = item;
      nearestDistance = distance;
    }
  });
  return { item: nearest, distance: nearestDistance };
}

function chartTick(timestamp: number, rangeDuration: number) {
  if (rangeDuration >= 36 * 3_600_000) {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: APP_TIME_ZONE,
      weekday: 'short',
      day: 'numeric',
    }).format(timestamp);
  }
  return formatTime(timestamp);
}

function basalStepPath(
  deliveries: BasalDelivery[],
  range: { start: number; end: number },
  x: (timestamp: number) => number,
  y: (rateUnitsPerHour: number) => number,
) {
  const visible = deliveries
    .filter(
      (delivery) =>
        delivery.end > range.start && delivery.start < range.end,
    )
    .sort((first, second) => first.start - second.start);
  let path = '';
  let previousEnd: number | undefined;
  let previousRate: number | undefined;

  visible.forEach((delivery) => {
    const start = Math.max(range.start, delivery.start);
    const end = Math.min(range.end, delivery.end);
    if (end <= start) return;
    const startX = x(start);
    const endX = x(end);
    const currentY = y(delivery.rateUnitsPerHour);
    const isContinuous =
      previousEnd !== undefined &&
      previousRate !== undefined &&
      Math.abs(start - previousEnd) <= 60_000;

    if (isContinuous) {
      path += ` L ${startX.toFixed(2)} ${y(previousRate!).toFixed(2)}`;
      path += ` L ${startX.toFixed(2)} ${currentY.toFixed(2)}`;
    } else {
      path += ` M ${startX.toFixed(2)} ${currentY.toFixed(2)}`;
    }
    path += ` L ${endX.toFixed(2)} ${currentY.toFixed(2)}`;
    previousEnd = end;
    previousRate = delivery.rateUnitsPerHour;
  });

  return path.trim();
}

function LegendKey({
  color,
  label,
  shape = 'line',
}: {
  color: string;
  label: string;
  shape?: 'line' | 'bar' | 'stem' | 'band';
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.legendItem}>
      <View style={styles.legendSymbol}>
        {shape === 'line' ? (
          <View style={[styles.lineKey, { backgroundColor: color }]} />
        ) : shape === 'bar' ? (
          <View style={[styles.barKey, { backgroundColor: color }]} />
        ) : shape === 'band' ? (
          <View
            style={[
              styles.bandKey,
              { backgroundColor: color, borderColor: color },
            ]}
          />
        ) : (
          <View style={[styles.stemKey, { backgroundColor: color }]} />
        )}
      </View>
      <Text style={[styles.legendLabel, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

function Inspector({
  timestamp,
  glucose,
  basal,
  bolus,
  dailyTotal,
  pumpStates,
  insulinAvailable,
}: {
  timestamp?: number;
  glucose?: GlucoseReading;
  basal?: BasalDelivery;
  bolus?: BolusDelivery;
  dailyTotal?: InsulinDailyTotal;
  pumpStates: PumpStateInterval[];
  insulinAvailable: boolean;
}) {
  const { colors, dark } = useAppTheme();
  const { settings: appearance } = useGlucoseAppearance();
  if (timestamp === undefined) {
    return (
      <View style={styles.inspector}>
        <Text style={[styles.inspectorHint, { color: colors.textSecondary }]}>
          Tap the chart to inspect exact readings and deliveries.
        </Text>
      </View>
    );
  }
  const trend = glucose ? presentTrend(glucose.trend) : undefined;
  const insulinParts: string[] = [];
  if (basal) {
    insulinParts.push(`Basal ${basal.rateUnitsPerHour.toFixed(2)} U/h`);
  } else if (dailyTotal?.basalUnits !== undefined) {
    insulinParts.push(`Basal ${dailyTotal.basalUnits.toFixed(1)} U this day`);
  }
  return (
    <View style={[styles.inspector, { borderColor: colors.divider }]}>
      <View style={styles.inspectorBlock}>
        <Text style={[styles.inspectorTime, { color: colors.textSecondary }]}>
          {formatTime(timestamp)}
        </Text>
        <Text
          style={[
            styles.inspectorValue,
            {
              color: glucose
                ? GLUCOSE_COLOR_PALETTE[
                    appearance.colors[
                      glucoseRangeForValue(
                        glucose.mmolL,
                        'current',
                        appearance,
                      )
                    ]
                  ][dark ? 'dark' : 'light']
                : colors.text,
            },
          ]}
        >
          {glucose
            ? `${glucose.mmolL.toFixed(1)} mmol/L  ${trend?.arrow ?? ''}`
            : 'No nearby glucose'}
        </Text>
      </View>
      <View style={styles.inspectorBlock}>
        <Text style={[styles.inspectorTime, { color: colors.textSecondary }]}>
          INSULIN
        </Text>
        <Text style={[styles.inspectorInsulin, { color: colors.insulin }]}>
          {!insulinAvailable
            ? 'Not connected'
            : insulinParts.length
              ? insulinParts.join('  ·  ')
              : 'No timed delivery event near this point'}
          {insulinAvailable && bolus
            ? `  ·  Bolus ${bolus.units.toFixed(1)} U`
            : ''}
        </Text>
        {pumpStates.length ? (
          <View style={styles.inspectorStateRow}>
            {pumpStates.map((state) => (
              <Text
                key={state.id}
                style={[
                  styles.inspectorStates,
                  {
                    color:
                      state.kind === 'activity-mode'
                        ? colors.accent
                        : colors.warning,
                  },
                ]}
              >
                {state.kind === 'activity-mode'
                  ? 'Activity mode'
                  : 'Automated pause'}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function CombinedTimeline({
  data,
  expanded = false,
  title = 'Glucose + insulin',
}: {
  data: TimelineData;
  expanded?: boolean;
  title?: string;
}) {
  const { colors, dark } = useAppTheme();
  const { settings: appearance } = useGlucoseAppearance();
  const window = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const [selectedTimestamp, setSelectedTimestamp] = useState<number>();
  const [showExpanded, setShowExpanded] = useState(false);
  const chartHeight = expanded
    ? Math.max(145, Math.min(180, window.height - 275))
    : CHART_HEIGHT;
  const verticalScale = chartHeight / CHART_HEIGHT;
  const glucoseTop = GLUCOSE_TOP * verticalScale;
  const glucoseBottom = GLUCOSE_BOTTOM * verticalScale;
  const insulinTop = INSULIN_TOP * verticalScale;
  const insulinBottom = INSULIN_BOTTOM * verticalScale;
  const projection = useRef({
    duration: 1,
    plotRight: PLOT_LEFT + 1,
    plotWidth: 1,
    readings: data.glucose,
    rangeStart: data.range.start,
  });
  const insulinAvailable =
    data.basal.length > 0 ||
    data.boluses.length > 0 ||
    (data.dailyInsulinTotals?.length ?? 0) > 0 ||
    (data.pumpStates?.length ?? 0) > 0 ||
    !data.sources.some(
      (source) => source.label === 'Insulin' && source.freshness === 'missing',
    );
  const insulinFidelity = useMemo(
    () => describeInsulinTimelineFidelity(data),
    [data],
  );
  const duration = data.range.end - data.range.start;
  const showDailyInsulinSummary =
    duration >= DAILY_INSULIN_SUMMARY_THRESHOLD_MS;
  const hasDetailedBasal = data.basal.length > 0;
  const hasReportedBasal = (data.dailyInsulinTotals ?? []).some(
    (total) => total.basalUnits !== undefined,
  );
  const plotRight = Math.max(PLOT_LEFT + 1, width - AXIS_WIDTH);
  const plotWidth = plotRight - PLOT_LEFT;
  const x = (timestamp: number) =>
    PLOT_LEFT + ((timestamp - data.range.start) / Math.max(1, duration)) * plotWidth;
  const glucoseScale = useMemo(
    () => buildGlucoseChartScale(data.glucose, appearance),
    [appearance, data.glucose],
  );
  const glucoseY = (value: number) =>
    glucoseBottom -
    ((value - glucoseScale.minimum) /
      Math.max(1, glucoseScale.maximum - glucoseScale.minimum)) *
      (glucoseBottom - glucoseTop);
  const rangeColor = (value: number) => {
    const range = glucoseRangeForValue(value, 'current', appearance);
    const token = appearance.colors[range];
    return GLUCOSE_COLOR_PALETTE[token][dark ? 'dark' : 'light'];
  };

  useEffect(() => {
    setSelectedTimestamp(undefined);
  }, [data.range.end, data.range.start]);

  const sampledGlucose = useMemo(
    () => sampleGlucoseForChart(data.glucose),
    [data.glucose],
  );
  const glucoseSegments = useMemo(
    () =>
      buildColouredGlucoseSegments(
        sampledGlucose,
        appearance,
        GAP_THRESHOLD_MS,
      ),
    [appearance, sampledGlucose],
  );
  const dailyInsulin = useMemo(
    () =>
      showDailyInsulinSummary
        ? summarizeInsulinByDay(
            data.basal,
            data.boluses,
            data.range,
            data.dailyInsulinTotals,
          )
        : [],
    [
      data.basal,
      data.boluses,
      data.dailyInsulinTotals,
      data.range,
      showDailyInsulinSummary,
    ],
  );
  const maxDailyInsulin = Math.max(
    1,
    ...dailyInsulin.map((summary) => summary.totalUnits),
  );
  const shortRangeBasalTotals = showDailyInsulinSummary
    ? []
    : (data.dailyInsulinTotals ?? []).filter(
        (total) => total.basalUnits !== undefined,
      );
  const maxShortRangeBasal = Math.max(
    1,
    ...shortRangeBasalTotals.map((total) => total.basalUnits ?? 0),
  );
  const maxBasalRate = useMemo(() => {
    const observedMaximum = Math.max(
      0,
      ...data.basal.map((delivery) => delivery.rateUnitsPerHour),
    );
    return Math.max(0.5, Math.ceil(observedMaximum * 4) / 4);
  }, [data.basal]);
  const basalY = (rateUnitsPerHour: number) =>
    insulinBottom -
    1 -
    (Math.min(maxBasalRate, Math.max(0, rateUnitsPerHour)) /
      maxBasalRate) *
      Math.max(1, insulinBottom - insulinTop - 2);
  const basalPath = useMemo(
    () => basalStepPath(data.basal, data.range, x, basalY),
    [
      data.basal,
      data.range,
      insulinBottom,
      insulinTop,
      maxBasalRate,
      plotWidth,
    ],
  );

  const unitsPerPixel = duration / Math.max(1, plotWidth);
  const glucoseTolerance = Math.min(
    30 * 60_000,
    Math.max(7 * 60_000, unitsPerPixel * 18),
  );
  const bolusTolerance = Math.min(
    3 * 3_600_000,
    Math.max(15 * 60_000, unitsPerPixel * 18),
  );
  const nearestGlucose =
    selectedTimestamp === undefined
      ? undefined
      : nearestByTimestamp(
          data.glucose,
          (reading) => reading.timestamp,
          selectedTimestamp,
        );
  const selectedGlucose =
    nearestGlucose && nearestGlucose.distance <= glucoseTolerance
      ? nearestGlucose.item
      : undefined;
  const selectedBasal =
    selectedTimestamp === undefined
      ? undefined
      : data.basal.find(
          (delivery) =>
            selectedTimestamp >= delivery.start && selectedTimestamp < delivery.end,
        );
  const nearestBolus =
    selectedTimestamp === undefined
      ? undefined
      : nearestByTimestamp(
          data.boluses,
          (delivery) => delivery.timestamp,
          selectedTimestamp,
        );
  const selectedBolus =
    nearestBolus && nearestBolus.distance <= bolusTolerance
      ? nearestBolus.item
      : undefined;
  const selectedDailyTotal =
    selectedTimestamp === undefined
      ? undefined
      : data.dailyInsulinTotals?.find(
          (total) => total.dateKey === toDateKey(selectedTimestamp),
        );
  const selectedPumpStates =
    selectedTimestamp === undefined
      ? []
      : (data.pumpStates ?? []).filter(
          (state) =>
            selectedTimestamp >= state.start &&
            selectedTimestamp < state.end,
        );

  function onLayout(event: LayoutChangeEvent) {
    setWidth(Math.floor(event.nativeEvent.layout.width));
  }

  projection.current = {
    duration,
    plotRight,
    plotWidth,
    readings: data.glucose,
    rangeStart: data.range.start,
  };

  function inspectAtX(location: number) {
    const current = projection.current;
    const clampedX = Math.max(
      PLOT_LEFT,
      Math.min(current.plotRight, location),
    );
    const timestamp =
      current.rangeStart +
      ((clampedX - PLOT_LEFT) / Math.max(1, current.plotWidth)) *
        current.duration;
    const nearest = nearestByTimestamp(
      current.readings,
      (reading) => reading.timestamp,
      timestamp,
    );
    setSelectedTimestamp(nearest.item?.timestamp ?? timestamp);
  }

  function inspect(event: GestureResponderEvent) {
    inspectAtX(event.nativeEvent.locationX);
  }

  const scrubber = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          Math.abs(gesture.dx) > 5 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 5 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
        onPanResponderGrant: (event) =>
          inspectAtX(event.nativeEvent.locationX),
        onPanResponderMove: (event) =>
          inspectAtX(event.nativeEvent.locationX),
        onPanResponderTerminationRequest: () => false,
      }),
    [],
  );

  return (
    <>
      <SectionCard
        style={[styles.card, expanded && styles.expandedCard]}
      >
      {!expanded ? (
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Target band {appearance.targetMin.toFixed(1)}–
              {appearance.targetMax.toFixed(1)} mmol/L
            </Text>
          </View>
          <ChartExpandButton
            label={`Open ${title} full screen`}
            onPress={() => setShowExpanded(true)}
          />
        </View>
      ) : null}
      <View style={styles.legend}>
        <LegendKey
          color={rangeColor(
            data.glucose.at(-1)?.mmolL ??
              (appearance.targetMin + appearance.targetMax) / 2,
          )}
          label="Glucose by range"
        />
        {hasDetailedBasal || hasReportedBasal ? (
            <LegendKey
              color={colors.insulin}
              label={
                hasDetailedBasal && !showDailyInsulinSummary
                  ? 'Basal rate'
                  : 'Daily basal total'
              }
              shape={
                hasDetailedBasal && !showDailyInsulinSummary
                  ? 'line'
                  : 'bar'
              }
            />
        ) : null}
        {data.boluses.length > 0 || showDailyInsulinSummary ? (
            <LegendKey
              color={colors.primary}
              label={showDailyInsulinSummary ? 'Daily bolus' : 'Bolus'}
              shape={showDailyInsulinSummary ? 'bar' : 'stem'}
            />
        ) : null}
        {(data.pumpStates ?? []).some(
          (state) => state.kind === 'activity-mode',
        ) ? (
          <LegendKey
            color={colors.accent}
            label="Activity mode"
            shape="band"
          />
        ) : null}
        {(data.pumpStates ?? []).some(
          (state) => state.kind === 'automated-pause',
        ) ? (
          <LegendKey
            color={colors.warning}
            label="Automated pause"
            shape="band"
          />
        ) : null}
      </View>

      <View
        accessibilityLabel={`Insulin data detail: ${insulinFidelity.label}. ${insulinFidelity.detail}`}
        style={[
          styles.fidelityNotice,
          {
            backgroundColor: colors.surfaceMuted,
            borderColor: colors.divider,
          },
        ]}
      >
        <Text style={[styles.fidelityLabel, { color: colors.text }]}>
          {insulinFidelity.label}
        </Text>
        <Text style={[styles.fidelityDetail, { color: colors.textSecondary }]}>
          {insulinFidelity.detail}
        </Text>
      </View>

      {data.glucose.length === 0 &&
      data.basal.length === 0 &&
      data.boluses.length === 0 &&
      (data.dailyInsulinTotals?.length ?? 0) === 0 &&
      (data.pumpStates?.length ?? 0) === 0 ? (
        <EmptyState
          title="No timeline data"
          detail="There are no glucose or insulin records in this range."
        />
      ) : (
        <>
          <Inspector
            timestamp={selectedTimestamp}
            glucose={selectedGlucose}
            basal={selectedBasal}
            bolus={selectedBolus}
            dailyTotal={selectedDailyTotal}
            pumpStates={selectedPumpStates}
            insulinAvailable={insulinAvailable}
          />
          <View
            accessibilityLabel={`Timeline with ${data.glucose.length} glucose readings, ${data.basal.length} basal delivery intervals, ${data.boluses.length} boluses and ${data.pumpStates?.length ?? 0} pump-state intervals. A tabular alternative is available in Records.`}
            onLayout={onLayout}
            style={[styles.chart, { height: chartHeight }]}
            {...scrubber.panHandlers}
          >
            {width > 0 ? (
              <>
                <Svg height={chartHeight} width={width}>
                  <Rect
                    x={PLOT_LEFT}
                    y={glucoseY(appearance.targetMax)}
                    width={plotWidth}
                    height={
                      glucoseY(appearance.targetMin) -
                      glucoseY(appearance.targetMax)
                    }
                    fill={colors.targetBand}
                  />
                  {(data.pumpStates ?? []).map((state) => {
                    const startX = Math.max(PLOT_LEFT, x(state.start));
                    const endX = Math.min(plotRight, x(state.end));
                    const stateWidth = Math.max(0, endX - startX);
                    if (stateWidth <= 0) return null;
                    const activity = state.kind === 'activity-mode';
                    const colour = activity
                      ? colors.accent
                      : colors.warning;
                    const label = activity
                      ? 'ACTIVITY MODE'
                      : 'AUTOMATED PAUSE';
                    return (
                      <G key={state.id}>
                        <Rect
                          fill={colour}
                          fillOpacity={activity ? 0.15 : 0.17}
                          height={insulinBottom - glucoseTop}
                          stroke={colour}
                          strokeOpacity={0.48}
                          strokeWidth={1}
                          width={stateWidth}
                          x={startX}
                          y={glucoseTop}
                        />
                        {stateWidth >= (expanded ? 54 : 74) ? (
                          <SvgText
                            fill={colour}
                            fontSize={expanded ? 8 : 7}
                            fontWeight="800"
                            textAnchor="middle"
                            x={startX + stateWidth / 2}
                            y={glucoseTop + 11}
                          >
                            {label}
                          </SvgText>
                        ) : null}
                      </G>
                    );
                  })}
                  {glucoseScale.ticks.map((tick) => (
                    <Line
                      key={`grid-${tick}`}
                      x1={PLOT_LEFT}
                      x2={plotRight}
                      y1={glucoseY(tick)}
                      y2={glucoseY(tick)}
                      stroke={colors.grid}
                      strokeWidth={1}
                      strokeDasharray={
                        tick === appearance.targetMin ||
                        tick === appearance.targetMax
                          ? '4 4'
                          : undefined
                      }
                    />
                  ))}
                  {glucoseScale.ticks.map((tick) => (
                    <SvgText
                      key={`label-${tick}`}
                      x={width - 2}
                      y={glucoseY(tick) + 4}
                      fill={colors.textTertiary}
                      fontSize={10}
                      textAnchor="end"
                    >
                      {Number.isInteger(tick) ? tick : tick.toFixed(1)}
                    </SvgText>
                  ))}
                  {glucoseSegments.map((segment, index) => (
                    <Path
                      key={`glucose-${index}`}
                      d={segment.points
                        .map(
                          (point, pointIndex) =>
                            `${pointIndex ? 'L' : 'M'} ${x(point.timestamp).toFixed(2)} ${glucoseY(point.mmolL).toFixed(2)}`,
                        )
                        .join(' ')}
                      fill="none"
                      stroke={
                        GLUCOSE_COLOR_PALETTE[
                          appearance.colors[segment.range]
                        ][dark ? 'dark' : 'light']
                      }
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.4}
                    />
                  ))}
                  {sampledGlucose.map((reading) => (
                    <Circle
                      key={`${reading.id}:marker`}
                      cx={x(reading.timestamp)}
                      cy={glucoseY(reading.mmolL)}
                      fill={rangeColor(reading.mmolL)}
                      r={1.7}
                      stroke={colors.surface}
                      strokeWidth={0.65}
                    />
                  ))}

                  <Line
                    x1={PLOT_LEFT}
                    x2={plotRight}
                    y1={insulinTop - 12}
                    y2={insulinTop - 12}
                    stroke={colors.divider}
                    strokeWidth={1}
                  />
                  <SvgText
                    x={PLOT_LEFT}
                    y={insulinTop - 18}
                    fill={colors.textTertiary}
                    fontSize={10}
                    fontWeight="600"
                  >
                    {insulinAvailable ? 'INSULIN' : 'INSULIN — NOT CONNECTED'}
                  </SvgText>
                  {showDailyInsulinSummary
                    ? dailyInsulin.flatMap((summary) => {
                        const startX = Math.max(PLOT_LEFT, x(summary.start));
                        const endX = Math.min(plotRight, x(summary.end));
                        const barWidth = Math.max(2, endX - startX - 1.5);
                        const basalHeight =
                          (summary.basalUnits / maxDailyInsulin) *
                          (insulinBottom - insulinTop);
                        const bolusHeight =
                          (summary.bolusUnits / maxDailyInsulin) *
                          (insulinBottom - insulinTop);
                        const barX = startX + 0.75;
                        return [
                          <Rect
                            key={`${summary.dateKey}:basal`}
                            x={barX}
                            y={insulinBottom - basalHeight}
                            width={barWidth}
                            height={basalHeight}
                            fill={colors.insulin}
                            fillOpacity={0.58}
                          />,
                          <Rect
                            key={`${summary.dateKey}:bolus`}
                            x={barX}
                            y={
                              insulinBottom -
                              basalHeight -
                              bolusHeight
                            }
                            width={barWidth}
                            height={bolusHeight}
                            fill={colors.primary}
                            fillOpacity={0.82}
                          />,
                        ];
                      })
                    : (
                      <>
                        {basalPath ? (
                          <Path
                            d={basalPath}
                            fill="none"
                            stroke={colors.insulin}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.5}
                          />
                        ) : null}
                        {!basalPath
                          ? shortRangeBasalTotals.map((total) => {
                              const totalRange = dayRange(
                                total.dateKey as DateKey,
                              );
                              const startX = Math.max(
                                PLOT_LEFT,
                                x(totalRange.start),
                              );
                              const endX = Math.min(
                                plotRight,
                                x(totalRange.end),
                              );
                              const barWidth = Math.max(0, endX - startX);
                              if (barWidth <= 0) return null;
                              const barHeight =
                                8 +
                                ((total.basalUnits ?? 0) /
                                  maxShortRangeBasal) *
                                  Math.max(
                                    1,
                                    insulinBottom - insulinTop - 12,
                                  );
                              return (
                                <G key={`${total.id}:reported-basal`}>
                                  <Rect
                                    fill={colors.insulin}
                                    fillOpacity={0.22}
                                    height={barHeight}
                                    stroke={colors.insulin}
                                    strokeOpacity={0.42}
                                    strokeWidth={1}
                                    width={barWidth}
                                    x={startX}
                                    y={insulinBottom - barHeight}
                                  />
                                  {barWidth >= 72 ? (
                                    <SvgText
                                      fill={colors.insulin}
                                      fontSize={8}
                                      fontWeight="700"
                                      textAnchor="middle"
                                      x={startX + barWidth / 2}
                                      y={insulinBottom - barHeight + 11}
                                    >
                                      {(total.basalUnits ?? 0).toFixed(1)} U basal
                                    </SvgText>
                                  ) : null}
                                </G>
                              );
                            })
                          : null}
                        {data.boluses.map((delivery) => {
                          const deliveryX = x(delivery.timestamp);
                          const top =
                            insulinBottom -
                            (Math.min(
                              MAX_BOLUS_UNITS,
                              delivery.units,
                            ) /
                              MAX_BOLUS_UNITS) *
                              (insulinBottom - insulinTop);
                          return (
                            <Path
                              key={delivery.id}
                              d={`M ${deliveryX} ${insulinBottom} L ${deliveryX} ${top}`}
                              stroke={colors.primary}
                              strokeWidth={2}
                              strokeLinecap="round"
                            />
                          );
                        })}
                        {data.boluses.map((delivery) => {
                          const deliveryX = x(delivery.timestamp);
                          const top =
                            insulinBottom -
                            (Math.min(
                              MAX_BOLUS_UNITS,
                              delivery.units,
                            ) /
                              MAX_BOLUS_UNITS) *
                              (insulinBottom - insulinTop);
                          return (
                            <Circle
                              key={`${delivery.id}:dot`}
                              cx={deliveryX}
                              cy={top}
                              r={3.5}
                              fill={colors.primary}
                              stroke={colors.surface}
                              strokeWidth={1.5}
                            />
                          );
                        })}
                      </>
                    )}

                  {Array.from({ length: 4 }, (_, index) => {
                    const timestamp =
                      data.range.start + (duration * index) / Math.max(1, 3);
                    const tickX = x(timestamp);
                    return (
                      <SvgText
                        key={`x-${index}`}
                        x={tickX}
                        y={chartHeight - 3}
                        fill={colors.textTertiary}
                        fontSize={10}
                        textAnchor={
                          index === 0 ? 'start' : index === 3 ? 'end' : 'middle'
                        }
                      >
                        {chartTick(timestamp, duration)}
                      </SvgText>
                    );
                  })}

                  {selectedTimestamp !== undefined ? (
                    <>
                      <Line
                        x1={x(selectedTimestamp)}
                        x2={x(selectedTimestamp)}
                        y1={glucoseTop}
                        y2={insulinBottom}
                        stroke={colors.textSecondary}
                        strokeWidth={1}
                        strokeDasharray="3 3"
                      />
                      {selectedGlucose ? (
                        <Circle
                          cx={x(selectedGlucose.timestamp)}
                          cy={glucoseY(selectedGlucose.mmolL)}
                          r={5}
                          fill={colors.surface}
                          stroke={rangeColor(selectedGlucose.mmolL)}
                          strokeWidth={2.5}
                        />
                      ) : null}
                    </>
                  ) : null}
                </Svg>
                <Pressable
                  accessibilityHint="Shows the nearest glucose reading, basal rate, and bolus."
                  accessibilityLabel="Inspect timeline"
                  accessibilityRole="button"
                  onPress={inspect}
                  style={StyleSheet.absoluteFill}
                />
              </>
            ) : null}
          </View>
          {!expanded ? (
          <Text style={[styles.footnote, { color: colors.textTertiary }]}>
            {insulinAvailable
              ? showDailyInsulinSummary
                ? 'Gaps are missing readings. Drag across the chart for exact glucose and daily insulin data.'
                : hasDetailedBasal
                  ? 'Gaps are missing readings. Drag across the chart for exact glucose, basal rate and bolus data.'
                  : hasReportedBasal
                    ? 'Drag across the chart for exact glucose, daily basal total and bolus data.'
                    : 'Drag across the chart for exact glucose and bolus data.'
              : 'Gaps in the glucose line are missing readings. No synthetic insulin is mixed into this personal timeline.'}
          </Text>
          ) : null}
        </>
      )}
      </SectionCard>
      {!expanded ? (
        <FullscreenChartModal
          detail={`Target ${appearance.targetMin.toFixed(1)}–${appearance.targetMax.toFixed(1)} mmol/L · ${data.glucose.length} readings`}
          onClose={() => setShowExpanded(false)}
          title={title}
          visible={showExpanded}
        >
          <CombinedTimeline data={data} expanded title={title} />
        </FullscreenChartModal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 16,
  },
  expandedCard: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
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
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginTop: 14,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendSymbol: {
    width: 18,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineKey: {
    width: 18,
    height: 2.5,
    borderRadius: 99,
  },
  barKey: {
    width: 14,
    height: 8,
    borderRadius: 2,
    opacity: 0.5,
  },
  bandKey: {
    width: 14,
    height: 10,
    borderWidth: 1,
    opacity: 0.38,
  },
  stemKey: {
    width: 2,
    height: 12,
    borderRadius: 99,
  },
  legendLabel: {
    fontSize: 11,
    lineHeight: 16,
  },
  fidelityNotice: {
    marginTop: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  fidelityLabel: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
  },
  fidelityDetail: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 1,
  },
  inspector: {
    minHeight: 57,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    marginTop: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  inspectorHint: {
    fontSize: 12,
    lineHeight: 18,
  },
  inspectorBlock: {
    flex: 1,
    minWidth: 0,
  },
  inspectorTime: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  inspectorValue: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginTop: 1,
  },
  inspectorInsulin: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginTop: 1,
  },
  inspectorStates: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    marginTop: 1,
  },
  inspectorStateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 10,
  },
  chart: {
    height: CHART_HEIGHT,
    marginTop: 2,
  },
  footnote: {
    fontSize: 11,
    lineHeight: 17,
    marginTop: 7,
  },
});
