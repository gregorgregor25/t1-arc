import { Alert } from '@/components/appAlert';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, Pressable, StyleSheet, Text } from 'react-native';
import { useAppTheme } from '@/theme/theme';

export const PRIVACY_POLICY_URL = 'https://t1arc.com/privacy/';

export function PrivacyPolicyLink() {
  const { colors } = useAppTheme();
  async function open() {
    try { await Linking.openURL(PRIVACY_POLICY_URL); }
    catch { Alert.alert('Could not open the privacy policy', `You can read it at ${PRIVACY_POLICY_URL} when a browser is available.`); }
  }
  return <Pressable accessibilityRole="link" accessibilityHint="Opens the T1 Arc privacy policy in your browser." onPress={() => void open()} style={({ pressed }) => [styles.link, { opacity: pressed ? 0.7 : 1 }]}>
    <Text style={[styles.text, { color: colors.primary }]}>Privacy policy</Text>
    <Ionicons name="open-outline" size={18} color={colors.primary} accessibilityElementsHidden />
  </Pressable>;
}

const styles = StyleSheet.create({
  link: { minHeight: 48, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  text: { flex: 1, fontSize: 14, lineHeight: 21, fontWeight: '600' },
});
