import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FoodToolsPage, type FoodToolsPageProps } from '@/components/foodLogger/FoodToolsPage';

const fixture = vi.hoisted(() => ({
  platform: { OS: 'android' },
  colors: { background: 'light-background', text: 'light-text', primary: 'light-primary',
    surfaceMuted: 'light-muted', divider: 'light-divider' },
}));
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', KeyboardAvoidingView: 'KeyboardAvoidingView',
  Modal: 'Modal', Platform: fixture.platform, Pressable: 'Pressable', ScrollView: 'ScrollView',
  StyleSheet: { create: <T>(styles: T) => styles, hairlineWidth: 1 }, Text: 'Text', View: 'View',
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('@/theme/theme', () => ({ useAppTheme: () => ({ colors: fixture.colors, radius: { md: 12 } }) }));

type Element = ReactElement<Record<string, unknown>>;
function descendants(node: ReactNode): Element[] {
  return Children.toArray(node).flatMap(child => isValidElement<Record<string, unknown>>(child)
    ? [child, ...descendants(child.props.children as ReactNode)] : []);
}
function render(overrides: Partial<FoodToolsPageProps> = {}) {
  const props: FoodToolsPageProps = { visible: true, title: 'Add a personal food',
    onBack: vi.fn(), children: createElement('Form', { draft: 'untouched' }), ...overrides };
  const elements = descendants(FoodToolsPage(props));
  return { props, elements, find: (type: string) => elements.find(element => element.type === type)! };
}
function style(value: unknown): Record<string, unknown> {
  return Array.isArray(value) ? Object.assign({}, ...value.map(style)) : value as Record<string, unknown>;
}

beforeEach(() => {
  fixture.platform.OS = 'android';
  Object.assign(fixture.colors, { background: 'light-background', text: 'light-text',
    primary: 'light-primary', surfaceMuted: 'light-muted', divider: 'light-divider' });
});

describe('food tools page wrapper', () => {
  it('routes visible and Android Back through the same callback without changing children', () => {
    const view = render();
    const onPress = view.find('Pressable').props.onPress as () => void;
    const onClose = view.find('Modal').props.onRequestClose as () => void;
    expect(onPress).toBe(onClose);
    onPress(); onClose();
    expect(view.props.onBack).toHaveBeenCalledTimes(2);
    expect(view.find('ScrollView').props.children).toBe(view.props.children);
    expect(view.find('Pressable').props).toMatchObject({ accessibilityRole: 'button', accessibilityLabel: 'Back to meal' });
    expect(view.elements.filter(element => element.type === 'Pressable')).toHaveLength(1);
  });

  it('guards both exit routes while busy and enables them again when work settles', () => {
    const onBack = vi.fn();
    const working = render({ busy: true, onBack });
    expect(working.find('Pressable').props).toMatchObject({ disabled: true, accessibilityState: { disabled: true, busy: true } });
    (working.find('Pressable').props.onPress as () => void)();
    (working.find('Modal').props.onRequestClose as () => void)();
    expect(onBack).not.toHaveBeenCalled();
    expect(working.find('ActivityIndicator').props.accessibilityLabel).toBe('Working');
    const ready = render({ onBack });
    (ready.find('Modal').props.onRequestClose as () => void)();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('forwards visibility and custom Back labels without owning draft state or dismiss effects', () => {
    const onBack = vi.fn();
    const child = createElement('Form', { draft: 'still present' });
    const hidden = render({ visible: false, onBack, children: child, backLabel: 'Back to food options' });
    expect(hidden.find('Modal').props.visible).toBe(false);
    (hidden.find('Modal').props.onRequestClose as () => void)();
    expect(onBack).not.toHaveBeenCalled();
    const reopened = render({ onBack, children: child, backLabel: 'Back to food options' });
    expect(reopened.find('ScrollView').props.children).toBe(child);
    expect(reopened.find('Pressable').props.accessibilityLabel).toBe('Back to food options');
  });

  it.each(['android', 'ios'])('keeps scrollable content inside safe areas and uses %s keyboard behavior', platform => {
    fixture.platform.OS = platform;
    const view = render();
    expect(view.find('Modal').props).toMatchObject({ presentationStyle: 'fullScreen', animationType: 'none' });
    expect(view.find('SafeAreaView').props).toMatchObject({ accessibilityViewIsModal: true, edges: ['top', 'bottom', 'left', 'right'] });
    expect(view.find('KeyboardAvoidingView').props.behavior).toBe(platform === 'ios' ? 'padding' : undefined);
    expect(view.find('ScrollView').props.keyboardShouldPersistTaps).toBe('handled');
    expect(style(view.find('ScrollView').props.contentContainerStyle)).toMatchObject({ flexGrow: 1, width: '100%', maxWidth: 720 });
  });

  it.each(['light', 'dark'])('uses %s theme tokens and permits large text to wrap without fixed heights', mode => {
    Object.assign(fixture.colors, { background: `${mode}-background`, text: `${mode}-text`, primary: `${mode}-primary` });
    const view = render({ title: 'A long food tools page title that can wrap onto multiple lines',
      backLabel: 'Back to the unfinished meal draft' });
    const title = view.elements.find(element => element.props.accessibilityRole === 'header')!;
    expect(style(title.props.style)).toMatchObject({ color: `${mode}-text`, flex: 1, flexShrink: 1, minWidth: 0 });
    expect(title.props.numberOfLines).toBeUndefined();
    expect(title.props.maxFontSizeMultiplier).toBeUndefined();
    expect(title.props.allowFontScaling).not.toBe(false);
    const back = view.find('Pressable');
    const backStyle = style((back.props.style as (state: { pressed: boolean }) => unknown)({ pressed: false }));
    expect(backStyle).toMatchObject({ minHeight: 48, minWidth: 48, maxWidth: '100%' });
    expect(backStyle.height).toBeUndefined();
    const label = descendants(back.props.children as ReactNode)[0]!;
    expect(label.props.numberOfLines).toBeUndefined();
    expect(style(label.props.style)).toMatchObject({ flexShrink: 1, color: `${mode}-primary` });
    expect(style(view.find('SafeAreaView').props.style).backgroundColor).toBe(`${mode}-background`);
  });
});
