import { Image, type ImageSourcePropType, StyleSheet, Text, View } from 'react-native';

import type { WatchFaceId } from '../../modules/t1arc-glucose-display';
import { formatGlucose, glucoseUnitLabel } from '@/domain/regionalFormat';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';

type PreviewFormat = 'mmol' | 'comma' | 'mgdl';

/** Real emulator renders, with synthetic data. See assets/watch-faces/README.md. */
const PREVIEWS: Record<WatchFaceId, Record<PreviewFormat, ImageSourcePropType>> = {
  meridian: {
    mmol: require('../../assets/watch-faces/meridian-mmol.png'),
    comma: require('../../assets/watch-faces/meridian-comma.png'),
    mgdl: require('../../assets/watch-faces/meridian-mgdl.png'),
  },
  chronograph: {
    mmol: require('../../assets/watch-faces/chronograph-mmol.png'),
    comma: require('../../assets/watch-faces/chronograph-comma.png'),
    mgdl: require('../../assets/watch-faces/chronograph-mgdl.png'),
  },
  atelier: {
    mmol: require('../../assets/watch-faces/atelier-mmol.png'),
    comma: require('../../assets/watch-faces/atelier-comma.png'),
    mgdl: require('../../assets/watch-faces/atelier-mgdl.png'),
  },
  pace: {
    mmol: require('../../assets/watch-faces/pace-mmol.png'),
    comma: require('../../assets/watch-faces/pace-comma.png'),
    mgdl: require('../../assets/watch-faces/pace-mgdl.png'),
  },
  summit: {
    mmol: require('../../assets/watch-faces/summit-mmol.png'),
    comma: require('../../assets/watch-faces/summit-comma.png'),
    mgdl: require('../../assets/watch-faces/summit-mgdl.png'),
  },
};

export function WatchFacePreview({ id, size = 128 }: { id: WatchFaceId; size?: number }) {
  const { defaults: regional } = useRegionalProfile();
  const { colors } = useAppTheme();
  const format: PreviewFormat = regional.glucoseUnit === 'mgDl' ? 'mgdl'
    : formatGlucose(6.8, regional, { withUnit: false }).includes(',') ? 'comma' : 'mmol';
  const name = id.charAt(0).toUpperCase() + id.slice(1);
  return (
    <View accessible accessibilityRole="image"
      accessibilityLabel={name + ' watch face. Example ' + glucoseUnitLabel(regional.glucoseUnit) + ' display, not live glucose.'}
      style={[styles.root, { width: size }]}>
      <Image source={PREVIEWS[id][format]} accessible={false} importantForAccessibility="no"
        resizeMode="contain"
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#000000',
          borderColor: colors.border, borderWidth: 1 }} />
      <Text style={[styles.caption, { color: colors.textSecondary }]}>EXAMPLE</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: 5 },
  caption: { fontSize: 10, fontWeight: '600', letterSpacing: 1, textAlign: 'center' },
});
