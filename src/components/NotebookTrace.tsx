import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";

import type { NotebookTracePlot } from "@/domain/notebookTrace";
import { useAppTheme } from "@/theme/theme";

export function NotebookTrace({ plot, title = "Saved glucose readings" }: { plot: NotebookTracePlot; title?: string }) {
  const { colors } = useAppTheme();
  return <View style={styles.figure}>
    <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
    <View accessible accessibilityRole="image" accessibilityLabel={`${title}. ${plot.period}. ${plot.description}`}>
      <Svg width="100%" height={180} viewBox="0 0 360 166" accessible={false}>
        <SvgText x={52} y={12} fill={colors.textSecondary} fontSize={11}>{plot.unit}</SvgText>
        {plot.ticks.map((tick) => <Line key={`line-${tick.y}`} x1={52} x2={348} y1={tick.y} y2={tick.y} stroke={colors.border} strokeWidth={1} />)}
        {plot.ticks.map((tick) => <SvgText key={tick.y} x={46} y={tick.y + 4} textAnchor="end" fill={colors.textSecondary} fontSize={11}>{tick.label}</SvgText>)}
        {plot.paths.map((path, index) => <Path key={index} d={path} fill="none" stroke={colors.primary} strokeWidth={2} />)}
        {plot.isolated.map((point, index) => <Circle key={index} cx={point.x} cy={point.y} r={2.5} fill={colors.primary} />)}
        <SvgText x={52} y={155} fill={colors.textSecondary} fontSize={11}>{plot.startLabel}</SvgText>
        <SvgText x={348} y={155} textAnchor="end" fill={colors.textSecondary} fontSize={11}>{plot.endLabel}</SvgText>
      </Svg>
    </View>
    <Text style={[styles.caption, { color: colors.textSecondary }]}>{plot.period}</Text>
    <Text style={[styles.caption, { color: colors.textSecondary }]}>{plot.description}</Text>
  </View>;
}

const styles = StyleSheet.create({
  figure: { gap: 6, marginVertical: 8 }, title: { fontSize: 15, lineHeight: 22, fontWeight: "600" },
  caption: { fontSize: 13, lineHeight: 20 },
});
