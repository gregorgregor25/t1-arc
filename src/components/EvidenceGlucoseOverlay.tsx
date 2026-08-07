import { useMemo, useState } from 'react';
import {
  LayoutChangeEvent,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, {
  G,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from 'react-native-svg';

import {
  buildColouredGlucoseSegments,
  buildGlucoseChartScale,
} from '@/domain/glucoseChart';
import {
  GLUCOSE_COLOR_PALETTE,
  glucoseRangeForValue,
} from '@/domain/glucoseAppearance';
import { GlucoseReading } from '@/domain/models';
import { DateKey, formatDate, toDateKey } from '@/domain/time';
import { useGlucoseAppearance } from '@/providers/GlucoseAppearanceProvider';
import { useAppTheme } from '@/theme/theme';

import { ChartExpandButton } from './FullscreenChart';

const HEIGHT = 270;
const TOP = 14;
const BOTTOM = 218;
const LEFT = 8;
const RIGHT = 34;
const NIGHT_ANCHOR_MS = 12 * 60 * 60 * 1_000;
const DAY_COLORS = [
  '#62D6E8',
  '#F3B85B',
  '#A78BFA',
  '#55D7A0',
  '#F08BA6',
  '#7AA7FF',
  '#D6C46A',
];

interface DayTrace {
  key: DateKey;
  label: string;
  readings: Array<GlucoseReading & { clockMinute: number }>;
}

const CLOCK_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function localClockMinute(timestamp: number) {
  const parts = CLOCK_FORMATTER.formatToParts(new Date(timestamp));
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(
    parts.find((part) => part.type === 'minute')?.value ?? 0,
  );
  const clockMinute = hour * 60 + minute;
  return clockMinute < 12 * 60 ? clockMinute + 24 * 60 : clockMinute;
}

function tracePath(
  readings: DayTrace['readings'],
  x: (clockMinute: number) => number,
  y: (value: number) => number,
) {
  return readings
    .map((reading, index) => {
      const previous = readings[index - 1];
      const move =
        !previous || reading.timestamp - previous.timestamp > 20 * 60_000;
      return `${move ? 'M' : 'L'} ${x(reading.clockMinute)} ${y(reading.mmolL)}`;
    })
    .join(' ');
}

export function EvidenceGlucoseOverlay({
  expanded = false,
  onExpand,
  readings,
}: {
  expanded?: boolean;
  onExpand?(): void;
  readings: GlucoseReading[];
}) {
  const { colors, dark } = useAppTheme();
  const { settings: appearance } = useGlucoseAppearance();
  const window = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const height = expanded
    ? Math.max(200, Math.min(250, window.height - 190))
    : HEIGHT;
  const top = expanded ? 24 : TOP;
  const bottom = expanded ? height - 52 : BOTTOM;
  const traces = useMemo(() => {
    const grouped = new Map<DateKey, DayTrace['readings']>();
    readings.forEach((reading) => {
      const key = toDateKey(reading.timestamp - NIGHT_ANCHOR_MS);
      const entry = grouped.get(key) ?? [];
      entry.push({ ...reading, clockMinute: localClockMinute(reading.timestamp) });
      grouped.set(key, entry);
    });
    return [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-7)
      .map(([key, dayReadings]) => ({
        key,
        label: formatDate(key, { weekday: 'short', day: 'numeric' }),
        readings: dayReadings.sort((a, b) => a.timestamp - b.timestamp),
      }));
  }, [readings]);
  const visibleReadings = useMemo(
    () => traces.flatMap((trace) => trace.readings),
    [traces],
  );
  const average = useMemo(() => {
    const bins = new Map<number, number[]>();
    visibleReadings.forEach((reading) => {
      const bin = Math.round(reading.clockMinute / 15) * 15;
      const values = bins.get(bin) ?? [];
      values.push(reading.mmolL);
      bins.set(bin, values);
    });
    return [...bins.entries()]
      .sort(([a], [b]) => a - b)
      .map(([clockMinute, values]) => ({
        timestamp: clockMinute,
        mmolL: values.reduce((sum, value) => sum + value, 0) / values.length,
      }));
  }, [visibleReadings]);
  const scale = useMemo(
    () => buildGlucoseChartScale(visibleReadings, appearance),
    [appearance, visibleReadings],
  );
  const averageSegments = useMemo(
    () => buildColouredGlucoseSegments(average, appearance, 18),
    [appearance, average],
  );
  const minuteBounds = visibleReadings.reduce(
    (bounds, reading) => ({
      minimum: Math.min(bounds.minimum, reading.clockMinute),
      maximum: Math.max(bounds.maximum, reading.clockMinute),
    }),
    { minimum: 18 * 60, maximum: 30 * 60 },
  );
  const minimumMinute =
    Math.floor((minuteBounds.minimum - 30) / 60) * 60;
  const maximumMinute =
    Math.ceil((minuteBounds.maximum + 30) / 60) * 60;
  const plotWidth = Math.max(1, width - LEFT - RIGHT);
  const plotHeight = bottom - top;
  const x = (clockMinute: number) =>
    LEFT +
    ((clockMinute - minimumMinute) /
      Math.max(60, maximumMinute - minimumMinute)) *
      plotWidth;
  const y = (value: number) =>
    top +
    ((scale.maximum -
      Math.max(scale.minimum, Math.min(scale.maximum, value))) /
      Math.max(1, scale.maximum - scale.minimum)) *
      plotHeight;
  const tickMinutes = Array.from(
    {
      length:
        Math.floor((maximumMinute - minimumMinute) / (2 * 60)) + 1,
    },
    (_, index) => minimumMinute + index * 2 * 60,
  );

  function onLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  return (
    <View>
      {!expanded ? (
      <View style={styles.titleRow}>
        <View style={styles.titleCopy}>
          <Text style={[styles.title, { color: colors.text }]}>
            Day-to-day glucose
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Up to seven local days overlaid by clock time. The thicker line is
            the 15-minute average and follows your glucose-range colours.
          </Text>
        </View>
        {onExpand ? (
          <ChartExpandButton
            label="Open day-to-day glucose full screen"
            onPress={onExpand}
          />
        ) : null}
      </View>
      ) : null}
      <View onLayout={onLayout} style={[styles.chart, { height }]}>
        {width > 0 && visibleReadings.length ? (
          <Svg height={height} width={width}>
            <Rect
              fill={colors.targetBand}
              height={y(appearance.targetMin) - y(appearance.targetMax)}
              opacity={0.64}
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
                  x={LEFT + plotWidth + 7}
                  y={y(tick) + 3}
                >
                  {tick}
                </SvgText>
              </G>
            ))}
            {traces.map((trace, index) => (
              <Path
                d={tracePath(trace.readings, x, y)}
                fill="none"
                key={trace.key}
                opacity={0.45}
                stroke={DAY_COLORS[index % DAY_COLORS.length]}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.35}
              />
            ))}
            {averageSegments.map((segment, index) => (
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
                  GLUCOSE_COLOR_PALETTE[appearance.colors[segment.range]][
                    dark ? 'dark' : 'light'
                  ]
                }
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3}
              />
            ))}
            {tickMinutes.map((minute, index) => (
              <SvgText
                fill={colors.textTertiary}
                fontSize={8}
                key={minute}
                textAnchor={
                  index === 0
                    ? 'start'
                    : index === tickMinutes.length - 1
                      ? 'end'
                      : 'middle'
                }
                x={x(minute)}
                y={bottom + 22}
              >
                {`${String(Math.floor((minute % 1440) / 60)).padStart(2, '0')}:00`}
              </SvgText>
            ))}
          </Svg>
        ) : null}
      </View>
      <View style={styles.legend}>
        {traces.map((trace, index) => (
          <View key={trace.key} style={styles.legendItem}>
            <View
              style={[
                styles.legendLine,
                { backgroundColor: DAY_COLORS[index % DAY_COLORS.length] },
              ]}
            />
            <Text style={[styles.legendText, { color: colors.textSecondary }]}>
              {trace.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  titleCopy: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  chart: {
    height: HEIGHT,
    marginTop: 12,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendLine: {
    width: 13,
    height: 2,
    borderRadius: 2,
  },
  legendText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
  },
});
