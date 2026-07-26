import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DateKey, formatDate } from '@/domain/time';
import { useAppTheme } from '@/theme/theme';

export function DateNavigator({
  date,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  isToday,
}: {
  date: DateKey;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  isToday: boolean;
}) {
  const { colors, radius } = useAppTheme();
  const arrow = (
    direction: 'back' | 'forward',
    enabled: boolean,
    onPress: () => void,
  ) => (
    <Pressable
      accessibilityLabel={direction === 'back' ? 'Previous day' : 'Next day'}
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.arrow,
        {
          backgroundColor: colors.surfaceMuted,
          borderRadius: radius.md,
          opacity: !enabled ? 0.35 : pressed ? 0.65 : 1,
        },
      ]}
    >
      <Ionicons
        accessibilityElementsHidden
        name={direction === 'back' ? 'chevron-back' : 'chevron-forward'}
        size={22}
        color={colors.text}
      />
    </Pressable>
  );

  return (
    <View
      accessibilityLabel={`Selected date ${formatDate(date)}${isToday ? ', today' : ''}`}
      style={styles.container}
    >
      {arrow('back', canGoBack, onBack)}
      <View style={styles.dateCopy}>
        <Text style={[styles.date, { color: colors.text }]}>
          {formatDate(date, { weekday: 'short', day: 'numeric', month: 'long' })}
        </Text>
        <Text style={[styles.today, { color: colors.primary }]}>
          {isToday ? 'TODAY' : date}
        </Text>
      </View>
      {arrow('forward', canGoForward, onForward)}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  arrow: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateCopy: {
    alignItems: 'center',
    flex: 1,
    paddingHorizontal: 8,
  },
  date: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  today: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 0.9,
    marginTop: 2,
  },
});
