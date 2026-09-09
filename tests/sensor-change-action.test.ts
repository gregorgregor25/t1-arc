import { describe, expect, it, vi } from 'vitest';
import { SensorChangeStatus } from '@/components/SensorChangeStatus';

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: vi.fn(),
  useMemo: (factory: () => unknown) => factory(),
  useState: () => [undefined, vi.fn()],
}));
vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() }, Pressable: 'Pressable', Text: 'Text', View: 'View',
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/data/persistence/SqliteHealthRecordStore', () => ({ SqliteHealthRecordStore: class {} }));
vi.mock('@/providers/DataProvider', () => ({ useDataContext: () => ({ demoMode: false, ownerIdentity: 'test-owner', now: 1_783_000_000_000 }) }));
vi.mock('@/theme/theme', () => ({ useAppTheme: () => ({
  colors: { primary: '#3156B8', surface: '#FFFDF9', surfaceMuted: '#ECE7DE' }, radius: { md: 16 },
}) }));
vi.mock('@/components/ManualContextCard', () => ({ ManualContextCard: 'ManualContextCard' }));

describe('sensor-change launcher', () => {
  it('offers an action rather than claiming a sensor has already started', () => {
    const onRecord = vi.fn();
    const view = SensorChangeStatus({ sourceId: 'live-cgm', onRecord });
    const action = view.props.children[1];
    expect(action.props.accessibilityRole).toBe('button');
    expect(action.props.accessibilityLabel).toBe('Record sensor change');
    expect(action.props.children[1].props.children).toBe('Record sensor change');
    expect(action.props.accessibilityHint).toContain('Nothing is saved until you confirm');
    expect(action.props.accessibilityHint).toContain('does not start a sensor or change alerts');
    expect(onRecord).not.toHaveBeenCalled();
    action.props.onPress();
    expect(onRecord).toHaveBeenCalledOnce();
    expect(view.props.children[2].props.glucoseSourceId).toBe('live-cgm');
  });

  it('has a visible boundary, a full touch target, press feedback and wrapping text', () => {
    const action = SensorChangeStatus({ onRecord: vi.fn() }).props.children[1];
    const idle = action.props.style({ pressed: false });
    const pressed = action.props.style({ pressed: true });
    expect(idle[0]).toMatchObject({ minHeight: 48, borderWidth: 1, maxWidth: '100%' });
    expect(idle[1]).toMatchObject({ borderColor: '#3156B8', borderRadius: 16 });
    expect(pressed[1].backgroundColor).not.toBe(idle[1].backgroundColor);
    expect(action.props.children[1].props.style[0]).toMatchObject({ flexShrink: 1 });
    expect(action.props.children[1].props.numberOfLines).toBeUndefined();
  });
});
