import Ionicons from "@expo/vector-icons/Ionicons";
import { ReactNode, useCallback, useMemo, useState } from "react";
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, {
  Circle,
  G,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from "react-native-svg";

import {
  BasalDelivery,
  BolusDelivery,
  GlucoseReading,
  InsulinDailyTotal,
  PumpStateInterval,
  TimelineData,
} from "@/domain/models";
import {
  buildColouredGlucoseSegments,
  buildGlucoseChartScale,
} from "@/domain/glucoseChart";
import {
  GLUCOSE_COLOR_PALETTE,
  glucoseRangeForValue,
} from "@/domain/glucoseAppearance";
import { DateKey, dayRange, formatTime, toDateKey } from "@/domain/time";
import {
  formatGlucose,
  formatRegionalFixedNumber,
  formatRegionalNumber,
  glucoseFromMmolL,
} from "@/domain/regionalFormat";
import { getRuntimeRegionalDefaults } from "@/domain/regionalProfileRuntime";
import { getCachedDateTimeFormat } from "@/domain/intlFormatterCache";
import {
  DEFAULT_GLUCOSE_GAP_THRESHOLD_MS,
  sampleGlucoseForChart,
  sampleGlucoseMarkersForChart,
} from "@/domain/timelineSampling";
import {
  describeInsulinTimelineFidelity,
  selectLatestInsulinDailyTotals,
  summarizeInsulinByDay,
} from "@/domain/timelineInsulinSummary";
import {
  formatTimelineInspectionTimestamp,
  formatTimelineRange,
  inspectionTimestampForRange,
  resolveTimelineLayerAvailability,
  timelineInspectorInsulinParts,
  timelineTickTimestamp,
  timelineTimestampAtX,
} from "@/domain/timelinePresentation";
import { presentTrend } from "@/domain/trend";
import { useGlucoseAppearance } from "@/providers/GlucoseAppearanceProvider";
import { useRegionalProfile } from "@/providers/RegionalProfileProvider";
import { useAppTheme } from "@/theme/theme";

import { EmptyState } from "./EmptyState";
import { ChartExpandButton, FullscreenChartModal } from "./FullscreenChart";
import { SectionCard } from "./SectionCard";

const CHART_HEIGHT = 342;
const GLUCOSE_TOP = 18;
const GLUCOSE_BOTTOM = 174;
const INSULIN_TOP = 214;
const INSULIN_BOTTOM = 274;
const ACTIVITY_LANE_Y = 287;
const PAUSE_LANE_Y = 303;
const STATE_LANE_HEIGHT = 9;
const PLOT_LEFT = 6;
const AXIS_WIDTH = 35;
const MAX_BOLUS_UNITS = 7;
const GAP_THRESHOLD_MS = DEFAULT_GLUCOSE_GAP_THRESHOLD_MS;
const DAILY_INSULIN_SUMMARY_THRESHOLD_MS = 14 * 24 * 3_600_000;

export type TimelineLayer =
  "glucose" | "basal" | "bolus" | "activity" | "pause";

export type TimelineLayerVisibility = Record<TimelineLayer, boolean>;

export const DEFAULT_TIMELINE_LAYERS: TimelineLayerVisibility = {
  glucose: true,
  basal: true,
  bolus: true,
  activity: false,
  pause: false,
};

export const GLUCOSE_ONLY_TIMELINE_LAYERS: TimelineLayerVisibility = {
  glucose: true,
  basal: false,
  bolus: false,
  activity: false,
  pause: false,
};

export const INSULIN_ONLY_TIMELINE_LAYERS: TimelineLayerVisibility = {
  glucose: false,
  basal: true,
  bolus: true,
  activity: false,
  pause: false,
};

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
  const regional = getRuntimeRegionalDefaults();
  if (rangeDuration >= 36 * 3_600_000) {
    return getCachedDateTimeFormat(regional.locale, {
      timeZone: regional.timeZone,
      weekday: "short",
      day: "numeric",
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
      (delivery) => delivery.end > range.start && delivery.start < range.end,
    )
    .sort((first, second) => first.start - second.start);
  let path = "";
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
  shape = "line",
}: {
  color: string;
  label: string;
  shape?: "line" | "bar" | "stem" | "band";
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.legendItem}>
      <View style={styles.legendSymbol}>
        {shape === "line" ? (
          <View style={[styles.lineKey, { backgroundColor: color }]} />
        ) : shape === "bar" ? (
          <View style={[styles.barKey, { backgroundColor: color }]} />
        ) : shape === "band" ? (
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
      <Text style={[styles.legendLabel, { color: colors.textSecondary }]}>
        {label}
      </Text>
    </View>
  );
}

const LAYER_LABELS: Record<TimelineLayer, string> = {
  glucose: "Glucose",
  basal: "Basal",
  bolus: "Bolus",
  activity: "Activity",
  pause: "Pauses",
};

const LAYER_ICONS: Record<TimelineLayer, keyof typeof Ionicons.glyphMap> = {
  glucose: "pulse-outline",
  basal: "water-outline",
  bolus: "flash-outline",
  activity: "walk-outline",
  pause: "pause-outline",
};

function TimelineLayerControls({
  available,
  layers,
  onToggle,
}: {
  available: TimelineLayerVisibility;
  layers: TimelineLayerVisibility;
  onToggle(layer: TimelineLayer): void;
}) {
  const { colors } = useAppTheme();
  return (
    <View accessibilityRole="toolbar" style={styles.layerControls}>
      {(Object.keys(LAYER_LABELS) as TimelineLayer[]).map((layer) => {
        if (!available[layer]) return null;
        const selected = layers[layer];
        return (
          <Pressable
            accessibilityLabel={`${LAYER_LABELS[layer]} chart layer`}
            accessibilityRole="switch"
            accessibilityState={{ checked: selected }}
            key={layer}
            onPress={() => onToggle(layer)}
            style={({ pressed }) => [
              styles.layerControl,
              {
                backgroundColor: selected
                  ? `${colors.accent}1F`
                  : colors.surfaceMuted,
                borderColor: selected ? colors.accent : colors.divider,
              },
              pressed && styles.layerControlPressed,
            ]}
          >
            <Ionicons
              color={selected ? colors.accent : colors.textTertiary}
              name={LAYER_ICONS[layer]}
              size={16}
            />
            <Text
              style={[
                styles.layerControlText,
                { color: selected ? colors.text : colors.textSecondary },
              ]}
            >
              {LAYER_LABELS[layer]}
            </Text>
          </Pressable>
        );
      })}
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
  showBasal,
  showBolus,
  showGlucose,
}: {
  timestamp?: number;
  glucose?: GlucoseReading;
  basal?: BasalDelivery;
  bolus?: BolusDelivery;
  dailyTotal?: InsulinDailyTotal;
  pumpStates: PumpStateInterval[];
  insulinAvailable: boolean;
  showBasal: boolean;
  showBolus: boolean;
  showGlucose: boolean;
}) {
  const { colors, dark } = useAppTheme();
  const { settings: appearance } = useGlucoseAppearance();
  const { defaults: regional } = useRegionalProfile();
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
  const insulinParts = timelineInspectorInsulinParts({
    basalRateUnitsPerHour: basal?.rateUnitsPerHour,
    bolusUnits: bolus?.units,
    dailyTotal,
    showBasal,
    showBolus,
  });
  const showInsulin = showBasal || showBolus;
  return (
    <View style={[styles.inspector, { borderColor: colors.divider }]}>
      <View style={styles.inspectorBlock}>
        <Text style={[styles.inspectorTime, { color: colors.textSecondary }]}>
          {formatTimelineInspectionTimestamp(timestamp)}
        </Text>
        {showGlucose ? (
          <Text
            style={[
              styles.inspectorValue,
              {
                color: glucose
                  ? GLUCOSE_COLOR_PALETTE[
                      appearance.colors[
                        glucoseRangeForValue(
                          glucose.mmolL,
                          "current",
                          appearance,
                        )
                      ]
                    ][dark ? "dark" : "light"]
                  : colors.text,
              },
            ]}
          >
            {glucose
              ? `${formatGlucose(glucose.mmolL, regional)}  ${trend?.arrow ?? ""}`
              : "No nearby glucose"}
          </Text>
        ) : null}
      </View>
      {showInsulin || pumpStates.length ? (
        <View style={styles.inspectorBlock}>
          {showInsulin ? (
            <>
              <Text
                style={[styles.inspectorTime, { color: colors.textSecondary }]}
              >
                INSULIN
              </Text>
              <Text
                style={[styles.inspectorInsulin, { color: colors.insulin }]}
              >
                {!insulinAvailable
                  ? "Not connected"
                  : insulinParts.length
                    ? insulinParts.join("  ·  ")
                    : "No timed delivery event near this point"}
              </Text>
            </>
          ) : null}
          {pumpStates.length ? (
            <View style={styles.inspectorStateRow}>
              {pumpStates.map((state) => (
                <Text
                  key={state.id}
                  style={[
                    styles.inspectorStates,
                    {
                      color:
                        state.kind === "activity-mode"
                          ? colors.accent
                          : colors.warning,
                    },
                  ]}
                >
                  {state.kind === "activity-mode"
                    ? "Activity mode"
                    : "Automated pause"}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function CombinedTimeline({
  data,
  expanded = false,
  headerAccessory,
  layers: controlledLayers,
  onLayersChange,
  quiet = false,
  title = "Glucose + insulin",
}: {
  data: TimelineData;
  expanded?: boolean;
  headerAccessory?: ReactNode;
  layers?: TimelineLayerVisibility;
  onLayersChange?(layers: TimelineLayerVisibility): void;
  quiet?: boolean;
  title?: string;
}) {
  const { colors, dark } = useAppTheme();
  const { settings: appearance } = useGlucoseAppearance();
  const { defaults: regional } = useRegionalProfile();
  const window = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const [selection, setSelection] = useState<{
    rangeEnd: number;
    rangeStart: number;
    timestamp: number;
  }>();
  const inspectedTimestamp =
    selection?.rangeStart === data.range.start &&
    selection.rangeEnd === data.range.end
      ? inspectionTimestampForRange(selection.timestamp, data.range)
      : undefined;
  const [showExpanded, setShowExpanded] = useState(false);
  const [localLayers, setLocalLayers] = useState<TimelineLayerVisibility>(
    DEFAULT_TIMELINE_LAYERS,
  );
  const layers = controlledLayers ?? localLayers;
  const chartHeight = expanded
    ? Math.max(145, Math.min(180, window.height - 275))
    : quiet
      ? 230
      : CHART_HEIGHT;
  const verticalScale = chartHeight / CHART_HEIGHT;
  const glucoseTop = GLUCOSE_TOP * verticalScale;
  const glucoseBottom = GLUCOSE_BOTTOM * verticalScale;
  const insulinTop = INSULIN_TOP * verticalScale;
  const insulinBottom = INSULIN_BOTTOM * verticalScale;
  const activityLaneY = ACTIVITY_LANE_Y * verticalScale;
  const pauseLaneY = PAUSE_LANE_Y * verticalScale;
  const stateLaneHeight = Math.max(5, STATE_LANE_HEIGHT * verticalScale);
  const insulinAvailable =
    data.basal.length > 0 ||
    data.boluses.length > 0 ||
    (data.dailyInsulinTotals?.length ?? 0) > 0 ||
    (data.pumpStates?.length ?? 0) > 0 ||
    !data.sources.some(
      (source) => source.label === "Insulin" && source.freshness === "missing",
    );
  const insulinFidelity = useMemo(
    () => describeInsulinTimelineFidelity(data),
    [data],
  );
  const duration = data.range.end - data.range.start;
  const latestDailyTotals = useMemo(
    () => selectLatestInsulinDailyTotals(data.dailyInsulinTotals ?? []),
    [data.dailyInsulinTotals],
  );
  const showDailyInsulinSummary =
    duration >= DAILY_INSULIN_SUMMARY_THRESHOLD_MS;
  const hasDetailedBasal = data.basal.length > 0;
  const hasReportedBasal = latestDailyTotals.some(
    (total) => total.basalUnits !== undefined,
  );
  const availableLayers: TimelineLayerVisibility =
    resolveTimelineLayerAvailability({
      glucoseCount: data.glucose.length,
      basalCount: data.basal.length,
      bolusCount: data.boluses.length,
      dailyTotals: latestDailyTotals,
      pumpStates: data.pumpStates ?? [],
    });
  const visibleLayers: TimelineLayerVisibility = {
    glucose: layers.glucose && availableLayers.glucose,
    basal: layers.basal && availableLayers.basal,
    bolus: layers.bolus && availableLayers.bolus,
    activity: layers.activity && availableLayers.activity,
    pause: layers.pause && availableLayers.pause,
  };
  const visibleLayerCount = (Object.keys(layers) as TimelineLayer[]).filter(
    (layer) => availableLayers[layer] && layers[layer],
  ).length;

  function toggleLayer(layer: TimelineLayer) {
    if (layers[layer] && visibleLayerCount === 1) return;
    const next = { ...layers, [layer]: !layers[layer] };
    if (controlledLayers) onLayersChange?.(next);
    else setLocalLayers(next);
  }
  const plotRight = Math.max(PLOT_LEFT + 1, width - AXIS_WIDTH);
  const plotWidth = plotRight - PLOT_LEFT;
  const x = useCallback(
    (timestamp: number) =>
      PLOT_LEFT +
      ((timestamp - data.range.start) / Math.max(1, duration)) * plotWidth,
    [data.range.start, duration, plotWidth],
  );
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
    const range = glucoseRangeForValue(value, "current", appearance);
    const token = appearance.colors[range];
    return GLUCOSE_COLOR_PALETTE[token][dark ? "dark" : "light"];
  };

  const sampledGlucose = useMemo(
    () => sampleGlucoseForChart(data.glucose),
    [data.glucose],
  );
  const glucoseMarkers = useMemo(
    () => sampleGlucoseMarkersForChart(data.glucose),
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
            latestDailyTotals,
          )
        : [],
    [
      data.basal,
      data.boluses,
      latestDailyTotals,
      data.range,
      showDailyInsulinSummary,
    ],
  );
  const maxDailyInsulin = Math.max(
    1,
    ...dailyInsulin.map((summary) => summary.totalUnits),
  );
  const hasDailyUnsplitInsulin = dailyInsulin.some(
    (summary) => summary.sourceMinusBreakdownUnits >= 0.05,
  );
  const hasDailyBreakdownConflict = dailyInsulin.some(
    (summary) => summary.sourceMinusBreakdownUnits <= -0.05,
  );
  const insulinFidelityDetail = hasDailyBreakdownConflict
    ? `${insulinFidelity.detail} A conflicting source total is shown without treating the larger component records as its breakdown.`
    : insulinFidelity.detail;
  const shortRangeBasalTotals = showDailyInsulinSummary
    ? []
    : latestDailyTotals.filter((total) => total.basalUnits !== undefined);
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
  const basalY = useCallback(
    (rateUnitsPerHour: number) =>
      insulinBottom -
      1 -
      (Math.min(maxBasalRate, Math.max(0, rateUnitsPerHour)) / maxBasalRate) *
        Math.max(1, insulinBottom - insulinTop - 2),
    [insulinBottom, insulinTop, maxBasalRate],
  );
  const basalPath = useMemo(
    () => basalStepPath(data.basal, data.range, x, basalY),
    [basalY, data.basal, data.range, x],
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
    inspectedTimestamp === undefined
      ? undefined
      : nearestByTimestamp(
          data.glucose,
          (reading) => reading.timestamp,
          inspectedTimestamp,
        );
  const selectedGlucose =
    visibleLayers.glucose &&
    nearestGlucose &&
    nearestGlucose.distance <= glucoseTolerance
      ? nearestGlucose.item
      : undefined;
  const selectedBasal =
    !visibleLayers.basal || inspectedTimestamp === undefined
      ? undefined
      : data.basal.find(
          (delivery) =>
            inspectedTimestamp >= delivery.start &&
            inspectedTimestamp < delivery.end,
        );
  const nearestBolus =
    inspectedTimestamp === undefined
      ? undefined
      : nearestByTimestamp(
          data.boluses,
          (delivery) => delivery.timestamp,
          inspectedTimestamp,
        );
  const selectedBolus =
    visibleLayers.bolus &&
    nearestBolus &&
    nearestBolus.distance <= bolusTolerance
      ? nearestBolus.item
      : undefined;
  const selectedDailyTotal =
    inspectedTimestamp === undefined ||
    (!visibleLayers.basal && !visibleLayers.bolus)
      ? undefined
      : latestDailyTotals.find(
          (total) => total.dateKey === toDateKey(inspectedTimestamp),
        );
  const selectedPumpStates =
    inspectedTimestamp === undefined
      ? []
      : (data.pumpStates ?? []).filter(
          (state) =>
            (state.kind === "activity-mode"
              ? visibleLayers.activity
              : visibleLayers.pause) &&
            inspectedTimestamp >= state.start &&
            inspectedTimestamp < state.end,
        );

  function onLayout(event: LayoutChangeEvent) {
    setWidth(Math.floor(event.nativeEvent.layout.width));
  }

  const inspectAtX = useCallback(
    (location: number) => {
      setSelection({
        rangeEnd: data.range.end,
        rangeStart: data.range.start,
        timestamp: timelineTimestampAtX({
          location,
          plotLeft: PLOT_LEFT,
          plotRight,
          range: data.range,
        }),
      });
    },
    [data.range, plotRight],
  );

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
        onPanResponderGrant: (event) => inspectAtX(event.nativeEvent.locationX),
        onPanResponderMove: (event) => inspectAtX(event.nativeEvent.locationX),
        onPanResponderTerminationRequest: () => false,
      }),
    [inspectAtX],
  );

  return (
    <>
      <SectionCard
        style={[
          styles.card,
          quiet && styles.quietCard,
          expanded && styles.expandedCard,
        ]}
      >
        {!expanded ? (
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={[styles.title, { color: colors.text }]}>
                {title}
              </Text>
              {!quiet ? (
                <Text
                  style={[styles.subtitle, { color: colors.textSecondary }]}
                >
                  Target band {formatGlucose(appearance.targetMin, regional, { withUnit: false })}–
                  {formatGlucose(appearance.targetMax, regional)}
                </Text>
              ) : null}
            </View>
            <ChartExpandButton
              label={`Open ${title} full screen`}
              onPress={() => setShowExpanded(true)}
            />
          </View>
        ) : null}
        {!expanded && headerAccessory ? (
          <View style={styles.headerAccessory}>{headerAccessory}</View>
        ) : null}
        {!quiet || expanded ? (
          <>
            <Text
              style={[styles.layerHeading, { color: colors.textSecondary }]}
            >
              SHOW ON CHART
            </Text>
            <TimelineLayerControls
              available={availableLayers}
              layers={layers}
              onToggle={toggleLayer}
            />
          </>
        ) : null}
        {!quiet || expanded ? (
          <View style={styles.legend}>
            {visibleLayers.glucose ? (
              <LegendKey
                color={rangeColor(
                  data.glucose.at(-1)?.mmolL ??
                    (appearance.targetMin + appearance.targetMax) / 2,
                )}
                label="Glucose by range"
              />
            ) : null}
            {visibleLayers.basal ? (
              <LegendKey
                color={colors.insulin}
                label={
                  hasDetailedBasal && !showDailyInsulinSummary
                    ? "Basal rate"
                    : "Daily basal total"
                }
                shape={
                  hasDetailedBasal && !showDailyInsulinSummary ? "line" : "bar"
                }
              />
            ) : null}
            {visibleLayers.bolus ? (
              <LegendKey
                color={colors.primary}
                label={showDailyInsulinSummary ? "Daily bolus" : "Bolus"}
                shape={showDailyInsulinSummary ? "bar" : "stem"}
              />
            ) : null}
            {visibleLayers.basal &&
            visibleLayers.bolus &&
            hasDailyUnsplitInsulin ? (
              <LegendKey
                color={colors.textTertiary}
                label="Daily total not split"
                shape="bar"
              />
            ) : null}
            {visibleLayers.basal &&
            visibleLayers.bolus &&
            hasDailyBreakdownConflict ? (
              <LegendKey
                color={colors.warning}
                label="Source total · component conflict"
                shape="bar"
              />
            ) : null}
            {visibleLayers.activity ? (
              <LegendKey
                color={colors.accent}
                label="Activity mode"
                shape="band"
              />
            ) : null}
            {visibleLayers.pause ? (
              <LegendKey
                color={colors.warning}
                label="Automated pause"
                shape="band"
              />
            ) : null}
          </View>
        ) : null}

        {(!quiet || expanded) &&
        (visibleLayers.basal || visibleLayers.bolus) ? (
          <View
            accessibilityLabel={`Insulin data detail: ${insulinFidelity.label}. ${insulinFidelityDetail}`}
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
            <Text
              style={[styles.fidelityDetail, { color: colors.textSecondary }]}
            >
              {insulinFidelityDetail}
            </Text>
          </View>
        ) : null}

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
            {!quiet || expanded || inspectedTimestamp !== undefined ? (
              <Inspector
                timestamp={inspectedTimestamp}
                glucose={selectedGlucose}
                basal={selectedBasal}
                bolus={selectedBolus}
                dailyTotal={selectedDailyTotal}
                pumpStates={selectedPumpStates}
                insulinAvailable={insulinAvailable}
                showBasal={visibleLayers.basal}
                showBolus={visibleLayers.bolus}
                showGlucose={visibleLayers.glucose}
              />
            ) : null}
            <View
              accessibilityLabel={`Timeline for ${formatTimelineRange(data.range)}, with ${formatRegionalNumber(data.glucose.length, regional.locale, { maximumFractionDigits: 0 })} glucose readings, ${formatRegionalNumber(data.basal.length, regional.locale, { maximumFractionDigits: 0 })} basal delivery intervals, ${formatRegionalNumber(data.boluses.length, regional.locale, { maximumFractionDigits: 0 })} boluses and ${formatRegionalNumber(data.pumpStates?.length ?? 0, regional.locale, { maximumFractionDigits: 0 })} pump-state intervals. A tabular alternative is available in Records.`}
              onLayout={onLayout}
              style={[styles.chart, { height: chartHeight }]}
              {...scrubber.panHandlers}
            >
              {width > 0 ? (
                <>
                  <Svg height={chartHeight} width={width}>
                    {visibleLayers.glucose ? (
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
                    ) : null}
                    {(data.pumpStates ?? [])
                      .filter((state) =>
                        state.kind === "activity-mode"
                          ? visibleLayers.activity
                          : visibleLayers.pause,
                      )
                      .map((state) => {
                        const startX = Math.max(PLOT_LEFT, x(state.start));
                        const endX = Math.min(plotRight, x(state.end));
                        const stateWidth = Math.max(0, endX - startX);
                        if (stateWidth <= 0) return null;
                        const activity = state.kind === "activity-mode";
                        const colour = activity
                          ? colors.accent
                          : colors.warning;
                        return (
                          <G key={state.id}>
                            <Rect
                              fill={colour}
                              fillOpacity={activity ? 0.72 : 0.78}
                              height={stateLaneHeight}
                              stroke={colour}
                              strokeOpacity={0.9}
                              strokeWidth={1}
                              width={stateWidth}
                              x={startX}
                              y={activity ? activityLaneY : pauseLaneY}
                              rx={stateLaneHeight / 2}
                            />
                          </G>
                        );
                      })}
                    {visibleLayers.activity ? (
                      <SvgText
                        fill={colors.textTertiary}
                        fontSize={8}
                        fontWeight="700"
                        x={PLOT_LEFT}
                        y={activityLaneY - 2}
                      >
                        ACTIVITY
                      </SvgText>
                    ) : null}
                    {visibleLayers.pause ? (
                      <SvgText
                        fill={colors.textTertiary}
                        fontSize={8}
                        fontWeight="700"
                        x={PLOT_LEFT}
                        y={pauseLaneY - 2}
                      >
                        PAUSES
                      </SvgText>
                    ) : null}
                    {visibleLayers.glucose
                      ? glucoseScale.ticks.map((tick) => (
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
                                ? "4 4"
                                : undefined
                            }
                          />
                        ))
                      : null}
                    {visibleLayers.glucose
                      ? glucoseScale.ticks.map((tick) => (
                          <SvgText
                            key={`label-${tick}`}
                            x={width - 2}
                            y={glucoseY(tick) + 4}
                            fill={colors.textTertiary}
                            fontSize={10}
                            textAnchor="end"
                          >
                            {formatRegionalNumber(
                              glucoseFromMmolL(tick, regional.glucoseUnit),
                              regional.locale,
                              {
                                maximumFractionDigits:
                                  regional.glucoseUnit === 'mgDl' ? 0 : 1,
                              },
                            )}
                          </SvgText>
                        ))
                      : null}
                    {visibleLayers.glucose
                      ? glucoseSegments.map((segment, index) => (
                          <Path
                            key={`glucose-${index}`}
                            d={segment.points
                              .map(
                                (point, pointIndex) =>
                                  `${pointIndex ? "L" : "M"} ${x(point.timestamp).toFixed(2)} ${glucoseY(point.mmolL).toFixed(2)}`,
                              )
                              .join(" ")}
                            fill="none"
                            stroke={
                              GLUCOSE_COLOR_PALETTE[
                                appearance.colors[segment.range]
                              ][dark ? "dark" : "light"]
                            }
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.4}
                          />
                        ))
                      : null}
                    {visibleLayers.glucose
                      ? glucoseMarkers.map((reading) => (
                          <Circle
                            key={`${reading.id}:marker`}
                            cx={x(reading.timestamp)}
                            cy={glucoseY(reading.mmolL)}
                            fill={rangeColor(reading.mmolL)}
                            r={1.7}
                            stroke={colors.surface}
                            strokeWidth={0.65}
                          />
                        ))
                      : null}

                    {visibleLayers.basal || visibleLayers.bolus ? (
                      <Line
                        x1={PLOT_LEFT}
                        x2={plotRight}
                        y1={insulinTop - 12}
                        y2={insulinTop - 12}
                        stroke={colors.divider}
                        strokeWidth={1}
                      />
                    ) : null}
                    {visibleLayers.basal || visibleLayers.bolus ? (
                      <SvgText
                        x={PLOT_LEFT}
                        y={insulinTop - 18}
                        fill={colors.textTertiary}
                        fontSize={10}
                        fontWeight="600"
                      >
                        {insulinAvailable
                          ? "INSULIN"
                          : "INSULIN — NOT CONNECTED"}
                      </SvgText>
                    ) : null}
                    {showDailyInsulinSummary ? (
                      dailyInsulin.flatMap((summary) => {
                        const startX = Math.max(PLOT_LEFT, x(summary.start));
                        const endX = Math.min(plotRight, x(summary.end));
                        const barWidth = Math.max(2, endX - startX - 1.5);
                        const basalHeight =
                          ((visibleLayers.basal ? summary.basalUnits : 0) /
                            maxDailyInsulin) *
                          (insulinBottom - insulinTop);
                        const bolusHeight =
                          ((visibleLayers.bolus ? summary.bolusUnits : 0) /
                            maxDailyInsulin) *
                          (insulinBottom - insulinTop);
                        const unsplitHeight =
                          ((visibleLayers.basal && visibleLayers.bolus
                            ? Math.max(0, summary.sourceMinusBreakdownUnits)
                            : 0) /
                            maxDailyInsulin) *
                          (insulinBottom - insulinTop);
                        const sourceTotalHeight =
                          (summary.totalUnits / maxDailyInsulin) *
                          (insulinBottom - insulinTop);
                        const barX = startX + 0.75;
                        if (
                          visibleLayers.basal &&
                          visibleLayers.bolus &&
                          summary.sourceMinusBreakdownUnits <= -0.05
                        ) {
                          return [
                            <Rect
                              key={`${summary.dateKey}:source-total-conflict`}
                              x={barX}
                              y={insulinBottom - sourceTotalHeight}
                              width={barWidth}
                              height={sourceTotalHeight}
                              fill={colors.warning}
                              fillOpacity={0.28}
                              stroke={colors.warning}
                              strokeOpacity={0.72}
                              strokeWidth={1}
                            />,
                          ];
                        }
                        return [
                          visibleLayers.basal ? (
                            <Rect
                              key={`${summary.dateKey}:basal`}
                              x={barX}
                              y={insulinBottom - basalHeight}
                              width={barWidth}
                              height={basalHeight}
                              fill={colors.insulin}
                              fillOpacity={0.58}
                            />
                          ) : null,
                          visibleLayers.bolus ? (
                            <Rect
                              key={`${summary.dateKey}:bolus`}
                              x={barX}
                              y={insulinBottom - basalHeight - bolusHeight}
                              width={barWidth}
                              height={bolusHeight}
                              fill={colors.primary}
                              fillOpacity={0.82}
                            />
                          ) : null,
                          unsplitHeight > 0 ? (
                            <Rect
                              key={`${summary.dateKey}:unsplit`}
                              x={barX}
                              y={
                                insulinBottom -
                                basalHeight -
                                bolusHeight -
                                unsplitHeight
                              }
                              width={barWidth}
                              height={unsplitHeight}
                              fill={colors.textTertiary}
                              fillOpacity={0.55}
                            />
                          ) : null,
                        ];
                      })
                    ) : (
                      <>
                        {visibleLayers.basal && basalPath ? (
                          <Path
                            d={basalPath}
                            fill="none"
                            stroke={colors.insulin}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.5}
                          />
                        ) : null}
                        {visibleLayers.basal && !basalPath
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
                                ((total.basalUnits ?? 0) / maxShortRangeBasal) *
                                  Math.max(1, insulinBottom - insulinTop - 12);
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
                                      {formatRegionalFixedNumber(
                                        total.basalUnits ?? 0,
                                        regional.locale,
                                        1,
                                      )} U
                                      basal
                                    </SvgText>
                                  ) : null}
                                </G>
                              );
                            })
                          : null}
                        {visibleLayers.bolus
                          ? data.boluses.map((delivery) => {
                              const deliveryX = x(delivery.timestamp);
                              const top =
                                insulinBottom -
                                (Math.min(MAX_BOLUS_UNITS, delivery.units) /
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
                            })
                          : null}
                        {visibleLayers.bolus
                          ? data.boluses.map((delivery) => {
                              const deliveryX = x(delivery.timestamp);
                              const top =
                                insulinBottom -
                                (Math.min(MAX_BOLUS_UNITS, delivery.units) /
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
                            })
                          : null}
                      </>
                    )}

                    {Array.from({ length: 4 }, (_, index) => {
                      const timestamp = timelineTickTimestamp(
                        data.range,
                        index,
                        4,
                      );
                      const tickX = x(timestamp);
                      return (
                        <SvgText
                          key={`x-${index}`}
                          x={tickX}
                          y={chartHeight - 3}
                          fill={colors.textTertiary}
                          fontSize={10}
                          textAnchor={
                            index === 0
                              ? "start"
                              : index === 3
                                ? "end"
                                : "middle"
                          }
                        >
                          {chartTick(timestamp, duration)}
                        </SvgText>
                      );
                    })}

                    {inspectedTimestamp !== undefined ? (
                      <>
                        <Line
                          x1={x(inspectedTimestamp)}
                          x2={x(inspectedTimestamp)}
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
                    accessibilityHint="Shows nearby data for each visible layer at the selected date and time."
                    accessibilityLabel="Inspect timeline"
                    accessibilityRole="button"
                    onPress={inspect}
                    style={StyleSheet.absoluteFill}
                  />
                </>
              ) : null}
            </View>
            {!expanded && !quiet ? (
              <Text style={[styles.footnote, { color: colors.textTertiary }]}>
                {insulinAvailable
                  ? showDailyInsulinSummary
                    ? "Gaps are missing readings. Drag across the chart for exact glucose and daily insulin data."
                    : hasDetailedBasal
                      ? "Gaps are missing readings. Drag across the chart for exact glucose, basal rate and bolus data."
                      : hasReportedBasal
                        ? "Drag across the chart for exact glucose, daily basal total and bolus data."
                        : "Drag across the chart for exact glucose and bolus data."
                  : "Gaps in the glucose line are missing readings. No synthetic insulin is mixed into this personal timeline."}
              </Text>
            ) : null}
          </>
        )}
      </SectionCard>
      {!expanded ? (
        <FullscreenChartModal
          detail={`${formatTimelineRange(data.range)} · Target ${formatGlucose(appearance.targetMin, regional, { withUnit: false })}–${formatGlucose(appearance.targetMax, regional)} · ${formatRegionalNumber(data.glucose.length, regional.locale, { maximumFractionDigits: 0 })} readings`}
          onClose={() => setShowExpanded(false)}
          title={title}
          visible={showExpanded}
        >
          <CombinedTimeline
            data={data}
            expanded
            layers={layers}
            onLayersChange={(next) => {
              if (controlledLayers) onLayersChange?.(next);
              else setLocalLayers(next);
            }}
            title={title}
          />
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
  quietCard: {
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 12,
  },
  expandedCard: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  headerAccessory: {
    marginTop: 13,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    marginTop: 14,
  },
  layerHeading: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 0.7,
    marginTop: 14,
  },
  layerControls: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 7,
  },
  layerControl: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  layerControlPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },
  layerControlText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  legendSymbol: {
    width: 18,
    height: 14,
    alignItems: "center",
    justifyContent: "center",
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
    fontWeight: "800",
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
    flexDirection: "row",
    alignItems: "center",
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
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  inspectorValue: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    marginTop: 1,
  },
  inspectorInsulin: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    marginTop: 1,
  },
  inspectorStates: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    marginTop: 1,
  },
  inspectorStateRow: {
    flexDirection: "row",
    flexWrap: "wrap",
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
