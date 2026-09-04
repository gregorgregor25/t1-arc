import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';

import {
  DateKey,
  formatDate,
} from '@/domain/time';
import { useAppTheme } from '@/theme/theme';

import {
  dateKeyFromPickerDate,
  pickerDateForDateKey,
} from './zonedDateTimePicker';

export function DateNavigator({
  date,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onDateChange,
  earliestDate,
  latestDate,
  isToday,
  caption,
}: {
  date: DateKey;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onDateChange?: (date: DateKey) => void;
  earliestDate?: DateKey;
  latestDate?: DateKey;
  isToday: boolean;
  caption?: string;
}) {
  const { colors, radius } = useAppTheme();
  const [pickerVisible, setPickerVisible] = useState(false);
  const pickerDate = pickerDateForDateKey(date);

  function chooseDate(event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === 'android' || event.type === 'dismissed') {
      setPickerVisible(false);
    }
    if (event.type === 'set' && selected) {
      onDateChange?.(dateKeyFromPickerDate(selected));
    }
  }
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
      <Pressable
        accessibilityHint={
          onDateChange ? 'Opens a calendar to jump to another date.' : undefined
        }
        accessibilityLabel={`Selected date ${formatDate(date)}${isToday ? ', today' : ''}`}
        accessibilityRole={onDateChange ? 'button' : undefined}
        disabled={!onDateChange}
        onPress={() => setPickerVisible(true)}
        style={({ pressed }) => [
          styles.dateCopy,
          { opacity: pressed && onDateChange ? 0.65 : 1 },
        ]}
      >
        <Text style={[styles.date, { color: colors.text }]}>
          {formatDate(date, { weekday: 'short', day: 'numeric', month: 'long' })}
        </Text>
        <Text style={[styles.today, { color: colors.primary }]}>
          {caption
            ? caption.toUpperCase()
            : isToday
            ? onDateChange
              ? 'TODAY · TAP TO CHOOSE'
              : 'TODAY'
            : onDateChange
              ? 'TAP TO CHOOSE DATE'
              : date}
        </Text>
      </Pressable>
      {arrow('forward', canGoForward, onForward)}
      {pickerVisible ? (
        <DateTimePicker
          display="default"
          maximumDate={
            latestDate
              ? pickerDateForDateKey(latestDate)
              : undefined
          }
          minimumDate={
            earliestDate
              ? pickerDateForDateKey(earliestDate)
              : undefined
          }
          mode="date"
          onChange={chooseDate}
          value={pickerDate}
        />
      ) : null}
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
