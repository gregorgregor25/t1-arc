import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SectionCard } from '@/components/SectionCard';
import {
  APP_THEME_MODES,
  AppThemeMode,
} from '@/domain/themePreference';
import { useAppTheme } from '@/theme/theme';

const OPTIONS: Record<
  AppThemeMode,
  {
    label: string;
    detail: string;
    icon: keyof typeof Ionicons.glyphMap;
  }
> = {
  system: {
    label: 'System',
    detail: 'Match this phone',
    icon: 'phone-portrait-outline',
  },
  light: {
    label: 'Light',
    detail: 'Soft daylight',
    icon: 'sunny-outline',
  },
  dark: {
    label: 'Dark',
    detail: 'Low-light calm',
    icon: 'moon-outline',
  },
};

export function ThemePreferenceCard() {
  const { colors, mode, radius, setMode } = useAppTheme();
  const [saving, setSaving] = useState(false);

  async function choose(nextMode: AppThemeMode) {
    if (saving || nextMode === mode) return;
    setSaving(true);
    try {
      await setMode(nextMode);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard>
      <Text style={[styles.title, { color: colors.text }]}>Choose your theme</Text>
      <Text style={[styles.detail, { color: colors.textSecondary }]}>
        Use the phone setting automatically, or keep T1 Arc in the theme that
        feels clearest to you.
      </Text>
      <View accessibilityRole="radiogroup" style={styles.options}>
        {APP_THEME_MODES.map((option) => {
          const selected = option === mode;
          const copy = OPTIONS[option];
          return (
            <Pressable
              accessibilityLabel={`${copy.label}. ${copy.detail}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled: saving }}
              disabled={saving}
              key={option}
              onPress={() => void choose(option)}
              style={({ pressed }) => [
                styles.option,
                {
                  backgroundColor: selected
                    ? `${colors.primary}18`
                    : colors.surfaceMuted,
                  borderColor: selected ? colors.primary : colors.border,
                  borderRadius: radius.md,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={selected ? colors.primary : colors.textSecondary}
                name={copy.icon}
                size={22}
              />
              <View style={styles.optionCopy}>
                <Text
                  style={[
                    styles.optionLabel,
                    { color: selected ? colors.primary : colors.text },
                  ]}
                >
                  {copy.label}
                </Text>
                <Text
                  style={[styles.optionDetail, { color: colors.textSecondary }]}
                >
                  {copy.detail}
                </Text>
              </View>
              <Ionicons
                accessibilityElementsHidden
                color={selected ? colors.primary : colors.textTertiary}
                name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                size={18}
              />
            </Pressable>
          );
        })}
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '700',
  },
  detail: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 20,
  },
  options: {
    marginTop: 18,
    gap: 9,
  },
  option: {
    minHeight: 60,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  optionCopy: {
    flex: 1,
    minWidth: 0,
  },
  optionLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  optionDetail: {
    fontSize: 12,
    lineHeight: 18,
  },
});
