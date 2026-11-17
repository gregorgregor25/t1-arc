import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  ListGroup,
  type ListGroupProps,
  ListRow,
  listRowAccessibilityLabel,
  NavCard,
  ScreenHeader,
  StatusIndicator,
  StatusLine,
  statusLineAccessibilityLabel,
  statusToneColor,
  statusToneWord,
  type StatusTone,
} from '@/components/ui';

const theme = vi.hoisted(() => ({
  current: {
    dark: true,
    colors: {
      accent: '#A7C978',
      border: '#3F424E',
      danger: '#FF8DA2',
      primary: '#8EA7FF',
      surface: '#1B1D24',
      surfaceElevated: '#252731',
      text: '#F8F5EE',
      textSecondary: '#C4C1BC',
      textTertiary: '#A09FA4',
      warning: '#F2B66E',
    },
    radius: { sm: 8, md: 13, lg: 17, xl: 22, pill: 999 },
    type: {
      micro: 11,
      caption: 12,
      footnote: 13,
      callout: 14,
      body: 15,
      bodyLarge: 16,
      title: 17,
      titleLarge: 20,
      headline: 24,
      screenTitle: 28,
      display: 32,
    },
  },
}));

const lightColors = {
  accent: '#506E37',
  border: '#DDD5CB',
  danger: '#B4233E',
  primary: '#3156B8',
  surface: '#FFFDF9',
  surfaceElevated: '#FFFFFF',
  text: '#1B1D24',
  textSecondary: '#50535E',
  textTertiary: '#63656D',
  warning: '#8A4B07',
};

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/theme/theme', () => ({ useAppTheme: () => theme.current }));

type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;

/** Expands function components (these primitives only use the mocked theme hook). */
function render(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(render);
  if (!isValidElement(node)) return node;
  const element = node as Node;
  if (typeof element.type === 'function') {
    return render((element.type as (props: object) => ReactNode)(element.props));
  }
  if (element.props.children === undefined) return element;
  return { ...element, props: { ...element.props, children: render(element.props.children) } };
}

function all(node: ReactNode, predicate: (element: Node) => boolean): Node[] {
  const found: Node[] = [];
  const visit = (value: ReactNode) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!isValidElement(value)) return;
    const element = value as Node;
    if (predicate(element)) found.push(element);
    visit(element.props.children);
  };
  visit(node);
  return found;
}

function first(node: ReactNode, predicate: (element: Node) => boolean): Node {
  const [match] = all(node, predicate);
  if (!match) throw new Error('No matching element');
  return match;
}

const ofType = (type: string) => (element: Node) => element.type === type;
const textOf = (element: Node) => String(element.props.children);
const flatStyle = (style: unknown): Record<string, unknown> =>
  Array.isArray(style)
    ? Object.assign({}, ...style.map(flatStyle))
    : ((style as Record<string, unknown> | undefined) ?? {});
const pressableStyle = (element: Node, pressed = false) =>
  flatStyle((element.props.style as (state: { pressed: boolean }) => unknown)({ pressed }));

describe('StatusIndicator', () => {
  it('uses a different shape and word for every tone', () => {
    const tones: StatusTone[] = ['ok', 'attention', 'problem', 'off'];
    const shapes = tones.map((tone) => {
      const box = render(createElement(StatusIndicator, { tone })) as Node;
      expect(box.props.accessibilityElementsHidden).toBe(true);
      return JSON.stringify(flatStyle((box.props.children as Node).props.style), (key, value) =>
        key.endsWith('Color') || key === 'backgroundColor' ? undefined : value,
      );
    });
    expect(new Set(shapes).size).toBe(tones.length);
    expect(new Set(tones.map((tone) => statusToneWord(tone))).size).toBe(tones.length);
    expect(statusToneWord('attention', '  Backup due ')).toBe('Backup due');
  });

  it('takes colours from the theme in light and dark mode', () => {
    expect(statusToneColor('ok', theme.current.colors as never)).toBe('#A7C978');
    expect(statusToneColor('problem', lightColors as never)).toBe('#B4233E');
    expect(statusToneColor('off', lightColors as never)).toBe('#63656D');
  });
});

describe('ListRow', () => {
  it('is a 48 dp button that speaks status, title, detail and value', () => {
    const onPress = vi.fn();
    const row = render(
      createElement(ListRow, {
        title: 'Units and region',
        detail: 'Glucose and food units',
        value: 'mmol/L',
        status: 'ok',
        onPress,
      }),
    ) as Node;
    expect(row.type).toBe('Pressable');
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityLabel).toBe(
      'Working, Units and region, Glucose and food units, mmol/L',
    );
    expect(pressableStyle(row).minHeight).toBeGreaterThanOrEqual(48);
    expect(pressableStyle(row, true).opacity).toBeLessThan(1);
    expect(first(row, ofType('Ionicons')).props.name).toBe('chevron-forward');
    expect(all(row, ofType('Text')).map(textOf)).toEqual([
      'Units and region',
      'Glucose and food units',
      'mmol/L',
    ]);
    (row.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('is plain grouped text without onPress, and has no chevron', () => {
    const row = render(createElement(ListRow, { title: 'Version', value: '1.7.21' })) as Node;
    expect(row.type).toBe('View');
    expect(row.props.accessible).toBe(true);
    expect(row.props.accessibilityLabel).toBe('Version, 1.7.21');
    expect(all(row, ofType('Ionicons'))).toHaveLength(0);
  });

  it('keeps a trailing control reachable by screen readers', () => {
    const row = render(
      createElement(ListRow, { title: 'Alarm sounds', trailing: createElement('Switch') }),
    ) as Node;
    expect(row.props.accessible).toBe(false);
    expect(all(row, ofType('Switch'))).toHaveLength(1);
  });

  it('reports disabled state and lets the caller override the label', () => {
    const row = render(
      createElement(ListRow, {
        title: 'Export',
        onPress: vi.fn(),
        disabled: true,
        accessibilityLabel: 'Export records',
      }),
    ) as Node;
    expect(row.props.accessibilityState).toEqual({ disabled: true });
    expect(row.props.accessibilityLabel).toBe('Export records');
    expect(listRowAccessibilityLabel({ title: 'Backup', status: 'attention', statusLabel: 'Due' })).toBe(
      'Due, Backup',
    );
  });
});

describe('ListGroup', () => {
  it('shows a heading label and puts dividers only between rows', () => {
    const group = render(
      createElement(
        ListGroup,
        { label: 'Privacy' } as ListGroupProps,
        createElement(ListRow, { key: 'a', title: 'Privacy policy', onPress: vi.fn() }),
        null,
        false,
        createElement(ListRow, { key: 'b', title: 'Usage counts', onPress: vi.fn() }),
        createElement(ListRow, { key: 'c', title: 'Erase data', onPress: vi.fn() }),
      ),
    ) as Node;
    const heading = first(group, (element) => element.props.accessibilityRole === 'header');
    expect(textOf(heading)).toBe('Privacy');
    expect(flatStyle(heading.props.style).textTransform).toBe('uppercase');
    expect(all(group, (element) => element.props.testID === 'list-group-divider')).toHaveLength(2);
    expect(all(group, ofType('Pressable'))).toHaveLength(3);
    const card = first(group, (element) => flatStyle(element.props.style).borderRadius === 17);
    expect(flatStyle(card.props.style)).toMatchObject({ backgroundColor: '#1B1D24', borderColor: '#3F424E' });
  });

  it('omits the label when none is given', () => {
    const group = render(createElement(ListGroup, {} as ListGroupProps, createElement(ListRow, { title: 'One' }))) as Node;
    expect(all(group, (element) => element.props.accessibilityRole === 'header')).toHaveLength(0);
  });
});

describe('StatusLine', () => {
  it('reads the words as one item and keeps the action a separate button', () => {
    const onPress = vi.fn();
    const line = render(
      createElement(StatusLine, {
        tone: 'attention',
        title: 'Backup due',
        detail: 'Last backup 19 days ago',
        action: { label: 'Back up', onPress },
      }),
    ) as Node;
    const summary = first(line, (element) => element.props.accessible === true);
    expect(summary.props.accessibilityLabel).toBe(
      'Needs attention: Backup due. Last backup 19 days ago',
    );
    expect(all(summary, ofType('Pressable'))).toHaveLength(0);
    const action = first(line, ofType('Pressable'));
    expect(action.props.accessibilityRole).toBe('button');
    expect(action.props.accessibilityLabel).toBe('Back up');
    expect(pressableStyle(action).minHeight).toBeGreaterThanOrEqual(48);
    (action.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledOnce();
    expect(statusLineAccessibilityLabel({ tone: 'ok', title: 'Alarms on' })).toBe('Working: Alarms on');
  });
});

describe('NavCard', () => {
  it('is a large button with icon, title, detail and chevron', () => {
    const onPress = vi.fn();
    const card = render(
      createElement(NavCard, {
        icon: 'pulse-outline',
        title: 'Glucose source',
        detail: 'Where your readings come from',
        onPress,
      }),
    ) as Node;
    expect(card.props.accessibilityRole).toBe('button');
    expect(card.props.accessibilityLabel).toBe('Glucose source, Where your readings come from');
    expect(pressableStyle(card).minHeight).toBeGreaterThanOrEqual(68);
    expect(pressableStyle(card, true).backgroundColor).toBe('#252731');
    expect(all(card, ofType('Ionicons')).map((icon) => icon.props.name)).toEqual([
      'pulse-outline',
      'chevron-forward',
    ]);
    expect(all(card, ofType('Ionicons')).every((icon) => icon.props.accessibilityElementsHidden)).toBe(true);
  });
});

describe('ScreenHeader', () => {
  it('has a heading title, a labelled back link and labelled round buttons', () => {
    const back = vi.fn();
    const share = vi.fn();
    const header = render(
      createElement(ScreenHeader, {
        title: 'Alarms',
        subtitle: 'Checked on this phone',
        back: { label: 'Settings', onPress: back },
        actions: [{ icon: 'share-outline', accessibilityLabel: 'Share or export', onPress: share }],
        trailing: createElement('AppMenuButton'),
      }),
    ) as Node;
    const title = first(header, (element) => element.props.accessibilityRole === 'header');
    expect(textOf(title)).toBe('Alarms');
    expect(flatStyle(title.props.style).fontSize).toBe(28);
    const buttons = all(header, ofType('Pressable'));
    expect(buttons.map((button) => button.props.accessibilityLabel)).toEqual([
      'Back to Settings',
      'Share or export',
    ]);
    const [backLink, shareButton] = buttons as [Node, Node];
    expect(pressableStyle(backLink).minHeight).toBeGreaterThanOrEqual(44);
    expect(pressableStyle(shareButton)).toMatchObject({ width: 48, height: 48, borderRadius: 24 });
    (backLink.props.onPress as () => void)();
    expect(back).toHaveBeenCalledOnce();
    expect(all(header, ofType('AppMenuButton'))).toHaveLength(1);
    expect(all(header, ofType('Text')).map(textOf)).toContain('Checked on this phone');
  });

  it('renders only the title when nothing else is given', () => {
    const header = render(createElement(ScreenHeader, { title: 'Settings' })) as Node;
    expect(all(header, ofType('Pressable'))).toHaveLength(0);
    expect(all(header, ofType('Text')).map(textOf)).toEqual(['Settings']);
  });
});
