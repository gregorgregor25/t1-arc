import { PropsWithChildren } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleProp, StyleSheet, ViewStyle } from 'react-native';

import { useAppTheme } from '@/theme/theme';

import { SurfaceSheen } from './SurfaceSheen';

interface SectionCardProps extends PropsWithChildren {
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function SectionCard({
  children,
  style,
  accessibilityLabel,
}: SectionCardProps) {
  const { colors, radius } = useAppTheme();
  return (
    <LinearGradient
      accessibilityLabel={accessibilityLabel}
      colors={[
        colors.surfaceGradientStart,
        colors.surfaceGradientMiddle,
        colors.surfaceGradientEnd,
      ]}
      end={{ x: 0.92, y: 1 }}
      locations={[0, 0.48, 1]}
      start={{ x: 0.04, y: 0 }}
      style={[
        styles.card,
        {
          borderColor: colors.surfaceBorder,
          borderRadius: radius.lg,
          shadowColor: colors.surfaceShadow,
        },
        style,
      ]}
    >
      <SurfaceSheen radius={radius.lg} />
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 6,
  },
});
