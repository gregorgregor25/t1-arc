import { useEffect, useMemo, useState } from 'react';
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, {
  Circle,
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
  TARGET_HIGH_MMOL_L,
  TARGET_LOW_MMOL_L,
  TimelineData,
} from '@/domain/models';
import { formatTime } from '@/domain/time';
import { presentTrend } from '@/domain/trend';
import { useAppTheme } from '@/theme/theme';

import { EmptyState } from './EmptyState';
import { SectionCard } from './SectionCard';

const CHART_HEIGHT = 318;
const GLUCOSE_TOP = 18;
const GLUCOSE_BOTTOM = 182;
const INSULIN_TOP = 222;
const INSULIN_BOTTOM = 286;
const PLOT_LEFT = 6;
const AXIS_WIDTH = 35;
const MIN_GLUCOSE = 2.5;
const MAX_GLUCOSE = 15.5;
const MAX_BASAL_RATE = 1.25;
const MAX_BOLUS_UNITS = 7;
const GAP_THRESHOLD_MS = 12 * 60_000;

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

function downsample(readings: GlucoseReading[], maximum = 760) {
  if (readings.length <= maximum) return readings;
  const step = Math.ceil(readings.length / maximum);
  return readings.filter((reading, index) => {
    const previous = readings[index - 1];
    const next = readings[index + 1];
    const nearGap =
      (previous && reading.timestamp - previous.timestamp > GAP_THRESHOLD_MS) ||
      (next && next.timestamp - reading.timestamp > GAP_THRESHOLD_MS);
    return index % step === 0 || index === readings.length - 1 || Boolean(nearGap);
  });
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

function LegendKey({
  color,
  label,
  shape = 'line',
}: {
  color: string;
  label: string;
  shape?: 'line' | 'bar' | 'stem';
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.legendItem}>
      <View style={styles.legendSymbol}>
        {shape === 'line' ? (
          <View style={[styles.lineKey, { backgroundColor: color }]} />
        ) : shape === 'bar' ? (
          <View style={[styles.barKey, { backgroundColor: color }]} />
        ) : (
          <View style={[styles.stemKey, { backgroundColor: color }]} />
        )}
      </View>
      <Text style={[styles.legendLabel, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

function buildGlucosePaths(
  readings: GlucoseReading[],
  x: (timestamp: number) => number,
  y: (value: number) => number,
) {
  const paths: string[] = [];
  let current = '';
  readings.forEach((reading, index) => {
    const previous = readings[index - 1];
    if (!previous || reading.timestamp - previous.timestamp > GAP_THRESHOLD_MS) {
      if (current) paths.push(current);
      current = `M ${x(reading.timestamp).toFixed(2)} ${y(reading.mmolL).toFixed(2)}`;
    } else {
      current += ` L ${x(reading.timestamp).toFixed(2)} ${y(reading.mmolL).toFixed(2)}`;
    }
  });
  if (current) paths.push(current);
  return paths;
}

function Inspector({
  timestamp,
  glucose,
  basal,
  bolus,
  insulinAvailable,
}: {
  timestamp?: number;
  glucose?: GlucoseReading;
  basal?: BasalDelivery;
  bolus?: BolusDelivery;
  insulinAvailable: boolean;
}) {
  const { colors } = useAppTheme();
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
  return (
    <View style={[styles.inspector, { borderColor: colors.divider }]}>
      <View style={styles.inspectorBlock}>
        <Text style={[styles.inspectorTime, { color: colors.textSecondary }]}>
          {formatTime(timestamp)}
        </Text>
        <Text style={[styles.inspectorValue, { color: colors.text }]}>
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
            : basal
              ? `Basal ${basal.rateUnitsPerHour.toFixed(2)} U/h`
              : 'No basal'}
          {insulinAvailable && bolus
            ? `  ·  Bolus ${bolus.units.toFixed(1)} U`
            : ''}
        </Text>
      </View>
    </View>
  );
}

export function CombinedTimeline({
  data,
  title = 'Glucose + insulin',
}: {
  data: TimelineData;
  title?: string;
}) {
  const { colors } = useAppTheme();
  const [width, setWidth] = useState(0);
  const [selectedTimestamp, setSelectedTimestamp] = useState<number>();
  const insulinAvailable =
    data.basal.length > 0 ||
    data.boluses.length > 0 ||
    !data.sources.some(
      (source) => source.label === 'Insulin' && source.freshness === 'missing',
    );
  const duration = data.range.end - data.range.start;
  const plotRight = Math.max(PLOT_LEFT + 1, width - AXIS_WIDTH);
  const plotWidth = plotRight - PLOT_LEFT;
  const x = (timestamp: number) =>
    PLOT_LEFT + ((timestamp - data.range.start) / Math.max(1, duration)) * plotWidth;
  const glucoseY = (value: number) =>
    GLUCOSE_BOTTOM -
    ((value - MIN_GLUCOSE) / (MAX_GLUCOSE - MIN_GLUCOSE)) *
      (GLUCOSE_BOTTOM - GLUCOSE_TOP);

  useEffect(() => {
    setSelectedTimestamp(undefined);
  }, [data.range.end, data.range.start]);

  const sampledGlucose = useMemo(() => downsample(data.glucose), [data.glucose]);
  const glucosePaths = useMemo(
    () => buildGlucosePaths(sampledGlucose, x, glucoseY),
    // x and glucoseY are pure projections of these values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.range.end, data.range.start, plotWidth, sampledGlucose],
  );

  const unitsPerPixel = duration / Math.max(1, plotWidth);
  const glucoseTolerance = Math.max(7 * 60_000, unitsPerPixel * 18);
  const bolusTolerance = Math.max(15 * 60_000, unitsPerPixel * 18);
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

  function onLayout(event: LayoutChangeEvent) {
    setWidth(Math.floor(event.nativeEvent.layout.width));
  }

  function inspect(event: GestureResponderEvent) {
    const location = event.nativeEvent.locationX;
    const clampedX = Math.max(PLOT_LEFT, Math.min(plotRight, location));
    const timestamp =
      data.range.start + ((clampedX - PLOT_LEFT) / Math.max(1, plotWidth)) * duration;
    setSelectedTimestamp(timestamp);
  }

  return (
    <SectionCard style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Target band 3.9–10.0 mmol/L
          </Text>
        </View>
        <Text style={[styles.tapLabel, { color: colors.primary }]}>TAP TO INSPECT</Text>
      </View>
      <View style={styles.legend}>
        <LegendKey color={colors.glucose} label="Glucose" />
        {insulinAvailable ? (
          <>
            <LegendKey color={colors.insulin} label="Basal rate" shape="bar" />
            <LegendKey color={colors.primary} label="Bolus" shape="stem" />
          </>
        ) : null}
      </View>

      {data.glucose.length === 0 &&
      data.basal.length === 0 &&
      data.boluses.length === 0 ? (
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
            insulinAvailable={insulinAvailable}
          />
          <View
            accessibilityLabel={`Timeline with ${data.glucose.length} glucose readings, ${data.basal.length} basal delivery intervals and ${data.boluses.length} boluses. A tabular alternative is available in Records.`}
            onLayout={onLayout}
            style={styles.chart}
          >
            {width > 0 ? (
              <>
                <Svg height={CHART_HEIGHT} width={width}>
                  <Rect
                    x={PLOT_LEFT}
                    y={glucoseY(TARGET_HIGH_MMOL_L)}
                    width={plotWidth}
                    height={glucoseY(TARGET_LOW_MMOL_L) - glucoseY(TARGET_HIGH_MMOL_L)}
                    fill={colors.targetBand}
                  />
                  {[4, 7, 10, 13].map((tick) => (
                    <Line
                      key={`grid-${tick}`}
                      x1={PLOT_LEFT}
                      x2={plotRight}
                      y1={glucoseY(tick)}
                      y2={glucoseY(tick)}
                      stroke={colors.grid}
                      strokeWidth={1}
                      strokeDasharray={tick === 4 || tick === 10 ? '4 4' : undefined}
                    />
                  ))}
                  {[4, 7, 10, 13].map((tick) => (
                    <SvgText
                      key={`label-${tick}`}
                      x={width - 2}
                      y={glucoseY(tick) + 4}
                      fill={colors.textTertiary}
                      fontSize={10}
                      textAnchor="end"
                    >
                      {tick}
                    </SvgText>
                  ))}
                  {glucosePaths.map((path, index) => (
                    <Path
                      key={`glucose-${index}`}
                      d={path}
                      fill="none"
                      stroke={colors.glucose}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.4}
                    />
                  ))}

                  <Line
                    x1={PLOT_LEFT}
                    x2={plotRight}
                    y1={INSULIN_TOP - 12}
                    y2={INSULIN_TOP - 12}
                    stroke={colors.divider}
                    strokeWidth={1}
                  />
                  <SvgText
                    x={PLOT_LEFT}
                    y={INSULIN_TOP - 18}
                    fill={colors.textTertiary}
                    fontSize={10}
                    fontWeight="600"
                  >
                    {insulinAvailable
                      ? 'INSULIN — DELAYED CLOUD DATA'
                      : 'INSULIN — NOT CONNECTED'}
                  </SvgText>
                  {data.basal.map((delivery) => {
                    const startX = Math.max(PLOT_LEFT, x(delivery.start));
                    const endX = Math.min(plotRight, x(delivery.end));
                    const height =
                      (Math.min(MAX_BASAL_RATE, delivery.rateUnitsPerHour) /
                        MAX_BASAL_RATE) *
                      (INSULIN_BOTTOM - INSULIN_TOP);
                    return (
                      <Rect
                        key={delivery.id}
                        x={startX}
                        y={INSULIN_BOTTOM - height}
                        width={Math.max(1, endX - startX + 0.3)}
                        height={height}
                        fill={colors.insulin}
                        fillOpacity={0.36}
                      />
                    );
                  })}
                  {data.boluses.map((delivery) => {
                    const deliveryX = x(delivery.timestamp);
                    const top =
                      INSULIN_BOTTOM -
                      (Math.min(MAX_BOLUS_UNITS, delivery.units) / MAX_BOLUS_UNITS) *
                        (INSULIN_BOTTOM - INSULIN_TOP);
                    return (
                      <Path
                        key={delivery.id}
                        d={`M ${deliveryX} ${INSULIN_BOTTOM} L ${deliveryX} ${top}`}
                        stroke={colors.primary}
                        strokeWidth={2}
                        strokeLinecap="round"
                      />
                    );
                  })}
                  {data.boluses.map((delivery) => {
                    const deliveryX = x(delivery.timestamp);
                    const top =
                      INSULIN_BOTTOM -
                      (Math.min(MAX_BOLUS_UNITS, delivery.units) / MAX_BOLUS_UNITS) *
                        (INSULIN_BOTTOM - INSULIN_TOP);
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

                  {Array.from({ length: 4 }, (_, index) => {
                    const timestamp =
                      data.range.start + (duration * index) / Math.max(1, 3);
                    const tickX = x(timestamp);
                    return (
                      <SvgText
                        key={`x-${index}`}
                        x={tickX}
                        y={CHART_HEIGHT - 3}
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
                        y1={GLUCOSE_TOP}
                        y2={INSULIN_BOTTOM}
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
                          stroke={colors.glucose}
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
          <Text style={[styles.footnote, { color: colors.textTertiary }]}>
            {insulinAvailable
              ? 'Gaps in the glucose line are missing readings. Basal is shown as rate; bolus markers show delivered events.'
              : 'Gaps in the glucose line are missing readings. No synthetic insulin is mixed into this personal timeline.'}
          </Text>
        </>
      )}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 16,
  },
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
  tapLabel: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 0.7,
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
  stemKey: {
    width: 2,
    height: 12,
    borderRadius: 99,
  },
  legendLabel: {
    fontSize: 11,
    lineHeight: 16,
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
