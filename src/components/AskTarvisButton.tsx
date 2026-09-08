import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';
import type { RootTabParamList } from '@/navigation/AppNavigator';
import { useAppTheme } from '@/theme/theme';
import { bindTarvisEntryToOwner, type TarvisEntry } from '@/domain/tarvisEntry';
import { useDataContext } from '@/providers/DataProvider';

export function AskTarvisButton({ entry, onOpen, label = 'Ask Tarv1s about this' }: { entry: () => TarvisEntry; onOpen?(): void; label?: string }) {
  const navigation = useNavigation<NavigationProp<RootTabParamList>>();
  const { ownerIdentity } = useDataContext();
  const { colors } = useAppTheme();
  return <Pressable accessibilityRole="button" accessibilityHint="Opens an editable question. Nothing is sent until you tap Send." onPress={() => {
    try {
      const context = bindTarvisEntryToOwner(entry(), ownerIdentity);
      onOpen?.();
      navigation.navigate('Insights', { entry: context });
    } catch {
      Alert.alert('These records are not available', 'Reopen this period and try again. You can still write a question in Tarv1s.');
    }
  }} style={({ pressed }) => [styles.button, { opacity: pressed ? 0.65 : 1 }]}>
    <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.primary} accessibilityElementsHidden />
    <Text style={[styles.label, { color: colors.primary }]}>{label}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({ button: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingVertical: 10 }, label: { fontSize: 14, fontWeight: '600', flexShrink: 1 } });
