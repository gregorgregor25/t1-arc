import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { DeleteManualEntryButton } from '@/components/DeleteManualEntryButton';

const state = vi.hoisted(() => ({
  alert: vi.fn(), context: vi.fn(), insulin: vi.fn(),
  cleanups: [] as (() => void)[],
}));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => () => void) => { state.cleanups.push(effect()); },
  useRef: (value: unknown) => ({ current: value }),
  useState: () => [false, vi.fn()],
}));
vi.mock('react-native', () => ({ Alert: { alert: state.alert }, Pressable: 'Pressable', Text: 'Text', StyleSheet: { create: (value: unknown) => value } }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/providers/DataProvider', () => ({ useDataContext: () => ({ ownerIdentity: 'owner', deleteManualContext: state.context, deleteManualInsulin: state.insulin }) }));
vi.mock('@/theme/theme', () => ({ useAppTheme: () => ({ colors: { danger: '#b00020', border: '#888' }, radius: { md: 12 } }) }));

beforeEach(() => { vi.clearAllMocks(); state.cleanups = []; state.context.mockResolvedValue(true); state.insulin.mockResolvedValue(true); });

function setup(insulin = false, disabled = false) {
  const onDeleted = vi.fn();
  const onBusyChange = vi.fn();
  const button = DeleteManualEntryButton({ id: 'manual-one', insulin, disabled, onDeleted, onBusyChange });
  return { button, onDeleted, onBusyChange, confirm: () => state.alert.mock.calls[0]![2][1].onPress() };
}

describe('manual entry deletion', () => {
  it('requires explicit confirmation, and cancel never changes data', () => {
    const { button } = setup();
    button.props.onPress();
    expect(state.alert).toHaveBeenCalledWith('Delete this entry?', expect.any(String), expect.any(Array));
    expect(state.alert.mock.calls[0]![2][0]).toMatchObject({ text: 'Cancel', style: 'cancel' });
    expect(state.context).not.toHaveBeenCalled();
  });

  it.each([false, true])('deletes through the correct existing repository callback (insulin=%s)', async (insulin) => {
    const { button, confirm, onDeleted, onBusyChange } = setup(insulin);
    button.props.onPress(); confirm();
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(insulin ? state.insulin : state.context).toHaveBeenCalledExactlyOnceWith('manual-one');
    expect(insulin ? state.context : state.insulin).not.toHaveBeenCalled();
    expect(onBusyChange.mock.calls.map(call => call[0])).toEqual([true, false]);
  });

  it('does not duplicate a deletion while it is pending', async () => {
    let resolve!: (value: boolean) => void;
    state.context.mockReturnValueOnce(new Promise<boolean>(done => { resolve = done; }));
    const { button, confirm, onDeleted } = setup();
    button.props.onPress(); confirm(); confirm(); button.props.onPress();
    expect(state.context).toHaveBeenCalledOnce();
    expect(state.alert).toHaveBeenCalledOnce();
    resolve(true);
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
  });

  it('rejects a confirmation captured before its editor unmounted', () => {
    const { button, confirm } = setup();
    button.props.onPress(); state.cleanups.forEach(cleanup => cleanup()); confirm();
    expect(state.context).not.toHaveBeenCalled();
  });

  it.each(['missing', 'failed'])('keeps the editor open when deletion is %s', async (result) => {
    if (result === 'missing') state.context.mockResolvedValueOnce(false);
    else state.context.mockRejectedValueOnce(new Error('storage failure'));
    const { button, confirm, onDeleted, onBusyChange } = setup();
    button.props.onPress(); confirm();
    await vi.waitFor(() => expect(state.alert).toHaveBeenCalledTimes(2));
    expect(state.alert.mock.calls[1]![0]).toBe(result === 'missing' ? 'Entry not found' : 'Entry not deleted');
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it('does not permit deletion while a save is in progress', () => {
    const { button } = setup(false, true);
    button.props.onPress();
    expect(button.props.disabled).toBe(true);
    expect(state.alert).not.toHaveBeenCalled();
  });

  it('only exposes deletion for manual records and locks conflicting editor actions', () => {
    const source = readFileSync('src/components/ManualContextCard.tsx', 'utf8');
    expect(source).toContain('editingEvent?.sourceId === MANUAL_CONTEXT_SOURCE_ID');
    expect(source).toContain('isManualInsulinDelivery(editingInsulin)');
    expect(source).toContain('if (saving || deleting) return;');
    expect(source).toContain('disabled={saving || deleting}');
  });
});
