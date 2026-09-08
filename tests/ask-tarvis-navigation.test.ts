import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AskTarvisButton } from '@/components/AskTarvisButton';
import { createTarvisPeriodEntry } from '@/domain/tarvisEntry';

const state = vi.hoisted(() => ({ ownerIdentity: 'owner:current', navigate: vi.fn(), alert: vi.fn() }));
vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: state.navigate }) }));
vi.mock('@/providers/DataProvider', () => ({ useDataContext: () => ({ ownerIdentity: state.ownerIdentity }) }));
vi.mock('@/theme/theme', () => ({ useAppTheme: () => ({ colors: { primary: '#aabbff' } }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('react-native', () => ({ Alert: { alert: state.alert }, Pressable: 'Pressable', Text: 'Text', StyleSheet: { create: (value: unknown) => value } }));

beforeEach(() => { vi.clearAllMocks(); state.ownerIdentity = 'owner:current'; });

describe('contextual Tarv1s entry', () => {
  it('only prepares an owner-bound draft after an explicit press, closing detail before navigation', () => {
    const entry = vi.fn(() => createTarvisPeriodEntry({ start: 1_783_000_000_000, end: 1_783_003_600_000 }));
    const onOpen = vi.fn();
    const button = AskTarvisButton({ entry, onOpen });
    expect(entry).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
    button.props.onPress();
    expect(entry).toHaveBeenCalledOnce();
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith('Insights', {
      entry: expect.objectContaining({ ownerIdentity: 'owner:current', range: { start: 1_783_000_000_000, end: 1_783_003_600_000 } }),
    });
    expect(onOpen.mock.invocationCallOrder[0]).toBeLessThan(state.navigate.mock.invocationCallOrder[0]!);
    expect(button.props.accessibilityHint).toContain('Nothing is sent until you tap Send');
  });

  it('keeps the current detail open when an imported record cannot form a valid question', () => {
    const onOpen = vi.fn();
    AskTarvisButton({ entry: () => { throw new Error('unusable provider record'); }, onOpen }).props.onPress();
    expect(state.navigate).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(state.alert).toHaveBeenCalledWith('These records are not available', expect.any(String));
  });

  it('does not navigate without a current data owner', () => {
    state.ownerIdentity = '';
    AskTarvisButton({ entry: () => createTarvisPeriodEntry({ start: 1_783_000_000_000, end: 1_783_003_600_000 }) }).props.onPress();
    expect(state.navigate).not.toHaveBeenCalled();
    expect(state.alert).toHaveBeenCalledOnce();
  });
});
