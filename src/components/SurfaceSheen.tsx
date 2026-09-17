import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '@/theme/theme';

export function SurfaceSheen({ radius }: { radius: number }) {
  const { dark } = useAppTheme();

  return (
    <View
      accessibilityElementsHidden
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
    >
      <LinearGradient
        colors={
          dark
            ? [
                'rgba(255,255,255,0.065)',
                'rgba(142,167,255,0.028)',
                'rgba(255,255,255,0)',
              ]
            : [
                'rgba(255,255,255,0.92)',
                'rgba(255,255,255,0.2)',
                'rgba(255,255,255,0)',
              ]
        }
        end={{ x: 0.82, y: 0.7 }}
        locations={[0, 0.34, 0.72]}
        start={{ x: 0, y: 0 }}
        style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
      />
      <View
        style={[
          styles.topEdge,
          {
            backgroundColor: dark
              ? 'rgba(255,255,255,0.10)'
              : 'rgba(255,255,255,0.94)',
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  topEdge: {
    position: 'absolute',
    top: 0,
    left: 22,
    right: 22,
    height: StyleSheet.hairlineWidth,
  },
});
