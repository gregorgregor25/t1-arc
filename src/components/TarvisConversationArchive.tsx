import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { loadTarvisConversationState, type TarvisConversationScope } from '@/data/tarvis/conversationStore';
import { archivedConversationThreads } from '@/data/tarvis/conversationArchive';
import { getRuntimeRegionalDefaults } from '@/domain/regionalProfileRuntime';
import { useAppTheme } from '@/theme/theme';

export function TarvisConversationArchive({ scope }: { scope: TarvisConversationScope }) {
  const { colors, radius } = useAppTheme();
  const [visible, setVisible] = useState(false);
  const [threads, setThreads] = useState<ReturnType<typeof archivedConversationThreads>>([]);
  const [selected, setSelected] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);
  function open() {
    const token = ++generation.current;
    setVisible(true); setSelected(undefined); setThreads([]);
    setLoading(true); setError(false);
    void loadTarvisConversationState().then(result => {
      if (token !== generation.current) return;
      if (result.status === 'corrupt') setError(true);
      else setThreads(archivedConversationThreads(result.exchanges, scope));
    }).catch(() => { if (token === generation.current) setError(true); })
      .finally(() => { if (token === generation.current) setLoading(false); });
  }
  const close = () => { generation.current += 1; setVisible(false); setSelected(undefined); setThreads([]); };
  const current = threads.find(thread => thread.id === selected);
  const regional = getRuntimeRegionalDefaults();
  const date = (timestamp: number) => new Date(timestamp).toLocaleString(regional.locale, { timeZone: regional.timeZone });
  return <>
    <ArchiveButton label="Earlier connections and reviews" onPress={open} />
    <Modal visible={visible} animationType="slide" onRequestClose={() => current ? setSelected(undefined) : close()}>
      <SafeAreaView style={[styles.fill, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Saved conversation history</Text>
          <ArchiveButton label="Close history" onPress={close} />
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.body, { color: colors.textSecondary }]}>Saved under an earlier connection, installation or review. These answers are read-only and are not used in new replies.</Text>
          {loading ? <ActivityIndicator accessibilityLabel="Loading earlier conversations" color={colors.primary} /> : error ?
            <Text style={[styles.body, { color: colors.danger }]}>Saved history could not be opened. Close this view and try again.</Text> : current ? <>
              <ArchiveButton label="Back to saved history" onPress={() => setSelected(undefined)} />
              {current.exchanges.map(exchange => <View key={exchange.id} style={[styles.entry, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md }]}>
                <Text style={[styles.body, { color: colors.textSecondary }]}>{date(exchange.createdAt)}</Text>
                <Text selectable style={[styles.question, { color: colors.text }]}>{exchange.question}</Text>
                <Text selectable style={[styles.question, { color: colors.text }]}>{exchange.answer.headline}</Text>
                <Text selectable style={[styles.body, { color: colors.text }]}>{exchange.answer.answer}</Text>
                {exchange.answer.limitations.map((limitation, i) => <Text key={i} style={[styles.body, { color: colors.textSecondary }]}>{limitation}</Text>)}
              </View>)}
            </> : threads.length ? threads.map(thread => <View key={thread.id}>
              <ArchiveButton label={thread.title} onPress={() => setSelected(thread.id)} />
              <Text style={[styles.body, { color: colors.textSecondary }]}>{date(thread.updatedAt)}</Text>
            </View>) : <Text style={[styles.body, { color: colors.textSecondary }]}>No earlier conversations are saved on this phone.</Text>}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  </>;
}

function ArchiveButton({ label, onPress }: { label: string; onPress(): void }) {
  const { colors, radius } = useAppTheme();
  return <Pressable accessibilityRole="button" onPress={onPress}
    style={({ pressed }) => [styles.button, { borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, opacity: pressed ? .7 : 1 }]}>
    <Text style={[styles.buttonText, { color: colors.primary }]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 }, header: { padding: 20, gap: 12 }, title: { fontSize: 23, fontWeight: '700' },
  content: { padding: 20, paddingBottom: 40, gap: 18 }, body: { fontSize: 16, lineHeight: 24 },
  button: { minHeight: 48, borderWidth: 1, padding: 14, justifyContent: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600' }, question: { fontSize: 18, lineHeight: 26, fontWeight: '600' },
  entry: { padding: 16, borderWidth: 1, gap: 12 },
});
