import Ionicons from "@expo/vector-icons/Ionicons";
import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { exportNotebookReport } from "@/data/notebook/exportNotebookReport";
import { buildNotebookReport, type NotebookReport } from "@/data/notebook/notebookReport";
import { deleteNotebookEntry, loadNotebook, saveNotebookEntry, updateNotebookNote, type NotebookSections } from "@/data/notebook/notebookRepository";
import { notebookEntryDateLabel, type NotebookEntry } from "@/domain/personalNotebook";
import { notebookTracePlot } from "@/domain/notebookTrace";
import { NotebookTrace } from "@/components/NotebookTrace";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { notebookSaveError } from "@/data/notebook/answerSnapshot";
import { getRuntimeRegionalDefaults } from "@/domain/regionalProfileRuntime";
import { useAppTheme } from "@/theme/theme";

interface Props {
  visible: boolean;
  onClose(): void;
  ownerIdentity: string;
  dataMode: string;
  seed?: NotebookEntry;
}
interface Editor { entry: NotebookEntry; title: string; note: string; isNew: boolean }

export function PersonalNotebook(props: Props) {
  if (!props.visible) return null;
  return <NotebookContent key={`${props.ownerIdentity}\0${props.dataMode}\0${props.seed?.id ?? ""}`} {...props} />;
}

function NotebookContent({ visible, onClose, ownerIdentity, dataMode, seed }: Props) {
  const { colors } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const [records, setRecords] = useState<NotebookSections>({ active: [], archived: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [expanded, setExpanded] = useState<string>();
  const [showArchive, setShowArchive] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<NotebookReport>();
  const [editor, setEditor] = useState<Editor>();
  const [notice, setNotice] = useState<string>();
  const generation = useRef(0);
  const scopeKey = `${ownerIdentity}\0${dataMode}`;
  const [loadedScope, setLoadedScope] = useState<string>();
  const regional = getRuntimeRegionalDefaults();
  const date = (time: number) => new Intl.DateTimeFormat(regional.locale, { timeZone: regional.timeZone, dateStyle: "medium" }).format(time);

  const refresh = useCallback(async (token: number) => {
    const next = await loadNotebook({ ownerIdentity, dataMode });
    if (token === generation.current) {
      setRecords(next);
      setLoadedScope(`${ownerIdentity}\0${dataMode}`);
    }
  }, [ownerIdentity, dataMode]);

  useEffect(() => {
    const token = ++generation.current;
    void refresh(token).then(() => {
      if (token !== generation.current || !seed || seed.ownerIdentity !== ownerIdentity || seed.dataMode !== dataMode) return;
      setExpanded(seed.id);
    }).catch(() => {
      if (token === generation.current) setError("Your notebook could not be opened. Close it and try again. Existing items have not been changed.");
    }).finally(() => { if (token === generation.current) setLoading(false); });
    return () => { generation.current += 1; };
  }, [visible, refresh, ownerIdentity, dataMode, seed]);

  function leaveEditor(next: () => void) {
    if (busy) return;
    if (editor && (editor.note !== editor.entry.note || editor.title !== editor.entry.title)) {
      Alert.alert("Discard this note?", "Your unsaved changes will be lost.", [
        { text: "Keep editing", style: "cancel" }, { text: "Discard", style: "destructive", onPress: next },
      ]);
    } else next();
  }

  function back() {
    if (busy) return;
    if (editor) leaveEditor(() => setEditor(undefined));
    else if (preview) setPreview(undefined);
    else if (choosing) { setChoosing(false); setSelected([]); }
    else onClose();
  }

  function addQuestion() {
    const entry: NotebookEntry = {
      id: `note-${randomUUID()}`, ownerIdentity, dataMode, createdAt: Date.now(),
      title: "Question for my next appointment", note: "", answer: "", limitations: [], evidence: [],
    };
    setEditor({ entry, title: entry.title, note: "", isNew: true });
    setError(undefined);
  }

  async function saveNote() {
    if (!editor || busy) return;
    if ((editor.isNew && !editor.note.trim()) || !editor.title.trim()) { setError("Add a title and a note or question before saving."); return; }
    const token = generation.current;
    setBusy(true);
    setError(undefined);
    try {
      if (editor.isNew) await saveNotebookEntry({ ...editor.entry, title: editor.title.trim(), note: editor.note.trim() }, { ownerIdentity, dataMode });
      else await updateNotebookNote(editor.entry.id, editor.note.trim(), { ownerIdentity, dataMode });
      if (token !== generation.current) return;
      setEditor(undefined);
      setNotice("Saved on your phone.");
      await refresh(token);
    } catch (reason) { if (token === generation.current) setError(notebookSaveError(reason, "note")); }
    finally { if (token === generation.current) setBusy(false); }
  }

  function remove(entry: NotebookEntry, archived = false) {
    Alert.alert("Remove this saved item?", "This removes it from your notebook, not from your conversations or health history.", [
      { text: "Keep", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => {
        const token = generation.current;
        setBusy(true);
        void deleteNotebookEntry(entry.id, { ownerIdentity, dataMode }, { allowArchived: archived }).then(() => refresh(token))
          .catch(() => { if (token === generation.current) setError("This item could not be removed. Try again."); })
          .finally(() => { if (token === generation.current) setBusy(false); });
      } },
    ]);
  }

  function choose(id: string) {
    setError(undefined);
    setSelected((previous) => {
      if (previous.includes(id)) return previous.filter((value) => value !== id);
      if (previous.length >= 5) { setError("Choose up to five items for this summary."); return previous; }
      return [...previous, id];
    });
  }

  function prepareReport() {
    try {
      const available = [...records.active, ...(showArchive ? records.archived : [])];
      const items = selected.map((id) => available.find((item) => item.id === id)).filter((item): item is NotebookEntry => !!item);
      setPreview(buildNotebookReport(items, { ownerIdentity, dataMode }, { locale: regional.locale, timeZone: regional.timeZone, glucoseUnit: regional.glucoseUnit, includeArchives: showArchive }));
      setError(undefined);
    } catch { setError("Choose between one and five visible items to preview."); }
  }

  async function deliver(format: "text" | "html") {
    if (!preview || busy) return;
    const token = generation.current;
    setBusy(true);
    setError(undefined);
    try {
      if (format === "text") await Share.share({ title: "T1 Arc appointment notes", message: preview.text });
      else {
        const saved = await exportNotebookReport(preview);
        if (token === generation.current && saved === "saved") setNotice("Summary saved. Open the HTML file in a browser to read or print it.");
      }
    } catch { if (token === generation.current) setError("The summary could not be shared or saved. Your notebook is unchanged. Try again."); }
    finally { if (token === generation.current) setBusy(false); }
  }

  const ready = loadedScope === scopeKey && !loading;
  return <Modal visible={visible} animationType={reducedMotion ? "none" : "slide"} onRequestClose={back} presentationStyle="pageSheet">
    <SafeAreaView style={[styles.page, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{editor ? "My note" : preview ? "Preview summary" : "My notebook"}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={editor || preview || choosing ? "Back to notebook" : "Close notebook"} accessibilityState={{ disabled: busy }} disabled={busy} onPress={back} style={styles.close}>
          <Ionicons name={editor || preview || choosing ? "arrow-back" : "close"} size={24} color={colors.text} />
        </Pressable>
      </View>
      <KeyboardAvoidingView style={styles.grow} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {!ready ? <View style={styles.loading}>{loading ? <><ActivityIndicator color={colors.primary} /><Text style={[styles.body, { color: colors.textSecondary }]}>Opening your notebook…</Text></> : null}</View>
            : editor ? <View style={styles.editor}>
              {editor.isNew ? <><Text style={[styles.label, { color: colors.text }]}>Title</Text><TextInput accessibilityLabel="Note title" value={editor.title} onChangeText={(title) => setEditor({ ...editor, title })} maxLength={1000} style={[styles.input, { color: colors.text, borderColor: colors.border }]} /></> : <Text style={[styles.entryTitle, { color: colors.text }]}>{editor.title}</Text>}
              <Text style={[styles.label, { color: colors.text }]}>My note or question</Text>
              <TextInput accessibilityLabel="My note or question" value={editor.note} onChangeText={(note) => setEditor({ ...editor, note })} multiline maxLength={4000} textAlignVertical="top"
                style={[styles.input, styles.noteInput, { color: colors.text, borderColor: colors.border }]} />
              <NotebookAction label={busy ? "Saving…" : "Save note"} onPress={() => void saveNote()} disabled={busy} primary />
            </View>
              : preview ? <View style={styles.editor}>
                <Text style={[styles.body, { color: colors.textSecondary }]}>Review what is included before sharing. The text and HTML file contain health information and are not encrypted. Nothing is sent until you choose a destination.</Text>
                <Text selectable style={[styles.body, { color: colors.text }]}>{preview.text}</Text>
                {preview.charts?.map((chart, index) => <NotebookTrace key={index} plot={chart.plot} title={chart.title} />)}
                <NotebookAction label="Share this text" onPress={() => void deliver("text")} disabled={busy} primary />
                <NotebookAction label="Save printable HTML" onPress={() => void deliver("html")} disabled={busy} />
              </View> : <>
                <Text style={[styles.body, { color: colors.textSecondary }]}>{choosing ? "Choose up to five items, then review your summary before sharing." : "Keep useful answers and questions in one place. Saved privately on your phone."}</Text>
                {!choosing ? <View style={styles.toolbar}><NotebookAction label="Add a question or note" onPress={addQuestion} disabled={busy} />{records.active.length || records.archived.length ? <NotebookAction label="Prepare appointment notes" onPress={() => { setChoosing(true); setNotice(undefined); }} disabled={busy} /> : null}</View> : null}
                {!records.active.length ? <Text style={[styles.body, { color: colors.textSecondary }]}>No saved items for this connection yet. Save a useful Tarv1s answer, or add your own question.</Text> : null}
                {records.active.map((entry) => <NotebookItem key={entry.id} entry={entry} archived={false} open={expanded === entry.id} choosing={choosing} checked={selected.includes(entry.id)} busy={busy} date={date}
                  onToggle={() => choosing ? choose(entry.id) : setExpanded(expanded === entry.id ? undefined : entry.id)}
                  onEdit={() => { setEditor({ entry, title: entry.title, note: entry.note, isNew: false }); setError(undefined); }} onRemove={() => remove(entry)} />)}
                {records.archived.length ? <>
                  <Pressable accessibilityRole="button" accessibilityState={{ expanded: showArchive }} onPress={() => {
                    if (showArchive) setSelected((previous) => previous.filter((id) => records.active.some((entry) => entry.id === id)));
                    setShowArchive(!showArchive);
                  }} style={styles.action}>
                    <Text style={[styles.actionText, { color: colors.primary }]}>{showArchive ? "Hide other saved records" : `Other saved records (${records.archived.length})`}</Text>
                  </Pressable>
                  {showArchive ? <><Text style={[styles.body, { color: colors.textSecondary }]}>From another connection or restored backup. Read these separately and only include them in a summary if they belong to you.</Text>{records.archived.map((entry) => <NotebookItem key={entry.id} entry={entry} archived open={expanded === entry.id} choosing={choosing} checked={selected.includes(entry.id)} busy={busy} date={date}
                    onToggle={() => choosing ? choose(entry.id) : setExpanded(expanded === entry.id ? undefined : entry.id)} onRemove={() => remove(entry, true)} />)}</> : null}
                </> : null}
                {choosing ? <NotebookAction label={`Preview summary (${selected.length}/5)`} onPress={prepareReport} disabled={busy || !selected.length} primary /> : null}
              </>}
          {error ? <Text accessibilityRole="alert" style={[styles.body, { color: colors.warning }]}>{error}</Text> : null}
          {notice ? <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.textSecondary }]}>{notice}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

function NotebookAction({ label, onPress, disabled = false, primary = false }: { label: string; onPress(): void; disabled?: boolean; primary?: boolean }) {
  const { colors, radius } = useAppTheme();
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.action, { borderRadius: radius.md, backgroundColor: primary ? colors.primary : colors.surfaceMuted, opacity: disabled || pressed ? 0.55 : 1 }]}>
    <Text style={[styles.actionText, { color: primary ? colors.onPrimary : colors.primary }]}>{label}</Text>
  </Pressable>;
}

function NotebookItem({ entry, archived, open, choosing, checked, busy, date, onToggle, onEdit, onRemove }: {
  entry: NotebookEntry; archived: boolean; open: boolean; choosing: boolean; checked: boolean; busy: boolean;
  date(timestamp: number): string; onToggle(): void; onEdit?(): void; onRemove?(): void;
}) {
  const { colors, radius } = useAppTheme();
  const plot = entry.glucoseTrace ? notebookTracePlot(entry.glucoseTrace, getRuntimeRegionalDefaults()) : undefined;
  return <View style={[styles.card, { borderColor: colors.border, borderRadius: radius.md }]}>
    <Pressable accessibilityRole={choosing ? "checkbox" : "button"} accessibilityState={choosing ? { checked } : { expanded: open }}
      accessibilityLabel={`${entry.title}, ${notebookEntryDateLabel(entry)} ${date(entry.createdAt)}`} disabled={busy} onPress={onToggle}
      style={({ pressed }) => [styles.entryHeader, { opacity: pressed ? 0.7 : 1 }]}>
      <View style={styles.grow}>
        <Text style={[styles.entryTitle, { color: colors.text }]}>{entry.title}</Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>{notebookEntryDateLabel(entry)} {date(entry.createdAt)}{archived ? " · Other saved records" : ""}</Text>
      </View>
      <Ionicons accessibilityElementsHidden name={choosing ? checked ? "checkbox" : "square-outline" : open ? "chevron-up" : "chevron-down"} size={22} color={colors.primary} />
    </Pressable>
    {open && !choosing ? <View style={styles.entryBody}>
      {entry.answer ? <Text selectable style={[styles.body, { color: colors.text }]}>{entry.answer}</Text> : null}
      {plot ? <NotebookTrace plot={plot} /> : null}
      {entry.note ? <><Text style={[styles.label, { color: colors.text }]}>My note / question</Text><Text selectable style={[styles.body, { color: colors.text }]}>{entry.note}</Text></> : null}
      {entry.limitations.map((limitation, index) => <Text key={index} style={[styles.body, { color: colors.textSecondary }]}>{limitation}</Text>)}
      {entry.evidence.map((item, index) => <View key={index} style={styles.evidence}>
        <Text style={[styles.label, { color: colors.text }]}>{item.label}</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>{date(item.range.start)} to {date(item.range.end - 1)} · {item.recordCount} records</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>{item.description}</Text>
      </View>)}
      {archived ? <Text style={[styles.body, { color: colors.textSecondary }]}>From another connection or restored backup. These saved records are not used to analyse your current data.</Text> : <>
        {onEdit ? <NotebookAction label={entry.note ? "Edit my note" : "Add my note"} onPress={onEdit} disabled={busy} /> : null}
      </>}
      {onRemove ? <NotebookAction label={archived ? "Remove archived item" : "Remove saved item"} onPress={onRemove} disabled={busy} /> : null}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1 }, grow: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  title: { flex: 1, fontSize: 25, lineHeight: 33, fontWeight: "700" },
  close: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  content: { padding: 20, paddingBottom: 32, gap: 16 },
  loading: { gap: 12, alignItems: "center", paddingVertical: 28 },
  body: { fontSize: 15, lineHeight: 23 }, meta: { fontSize: 13, lineHeight: 20, marginTop: 4 },
  label: { fontSize: 15, lineHeight: 23, fontWeight: "600" },
  toolbar: { gap: 8 }, editor: { gap: 14 },
  card: { borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  entryHeader: { minHeight: 64, flexDirection: "row", padding: 14, gap: 12, alignItems: "center" },
  entryTitle: { fontSize: 16, lineHeight: 24, fontWeight: "600" },
  entryBody: { padding: 14, paddingTop: 0, gap: 12 }, evidence: { gap: 5 },
  action: { minHeight: 48, padding: 12, alignItems: "center", justifyContent: "center" },
  actionText: { fontSize: 14, lineHeight: 21, fontWeight: "600", textAlign: "center" },
  input: { borderWidth: 1, borderRadius: 12, minHeight: 48, padding: 12, fontSize: 16, lineHeight: 24 },
  noteInput: { minHeight: 160 },
});
