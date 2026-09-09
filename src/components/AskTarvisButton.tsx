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
    let context: TarvisEntry;
    try {
      context = bindTarvisEntryToOwner(entry(), ownerIdentity);
    } catch {
      Alert.alert('Could not prepare this question', 'Select the period or record again and retry. Your saved health data has not been changed.');
      return;
    }
    try {
      onOpen?.();
      navigation.navigate('Insights', { entry: context });
    } catch {
      Alert.alert('Could not open Tarv1s', 'Please open the Tarv1s tab and try again. No question was sent.');
    }
  }} style={({ pressed }) => [styles.button, { opacity: pressed ? 0.65 : 1 }]}>
    <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.primary} accessibilityElementsHidden />
    <Text style={[styles.label, { color: colors.primary }]}>{label}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({ button: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingVertical: 10 }, label: { fontSize: 14, fontWeight: '600', flexShrink: 1 } });
