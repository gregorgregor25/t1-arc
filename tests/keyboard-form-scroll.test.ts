import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardFormScrollView } from '@/components/KeyboardFormScrollView';

const fixture = vi.hoisted(() => ({ visible: true, inputTop: 650, inputHeight: 48, keyboardTop: 600,
  focused: null as object | null, callbacks: new Map<string, () => void>(), remove: vi.fn() }));
vi.mock('react-native', () => ({
  Platform: { OS: 'android' }, ScrollView: 'ScrollView',
  TextInput: { State: { currentlyFocusedInput: () => fixture.focused } },
  Keyboard: { isVisible: () => fixture.visible, metrics: () => ({ screenY: fixture.keyboardTop }),
    addListener: (event: string, callback: () => void) => { fixture.callbacks.set(event, callback); return { remove: fixture.remove }; } },
}));
beforeEach(() => {
  vi.useFakeTimers(); fixture.visible = true; fixture.inputTop = 650; fixture.inputHeight = 48; fixture.keyboardTop = 600;
  fixture.callbacks.clear(); fixture.remove.mockClear();
  fixture.focused = { measureInWindow: (callback: (...values: number[]) => void) => callback(0, fixture.inputTop, 120, fixture.inputHeight) };
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
function form() {
  const component = new KeyboardFormScrollView({}); const rendered = component.render();
  const scroll = vi.fn(({ y }: { y: number }) => { const delta = y - offset; fixture.inputTop -= delta; offset = y; rendered.props.onScroll({ nativeEvent: { contentOffset: { y } } }); });
  let offset = 200;
  rendered.props.ref.current = { getNativeScrollRef: () => ({ measureInWindow: (callback: (...values: number[]) => void) => callback(0, 140, 400, 500) }), scrollTo: scroll };
  rendered.props.onScroll({ nativeEvent: { contentOffset: { y: offset } } });
  component.componentDidMount();
  return { component, rendered, scroll };
}
describe('keyboard form focus recovery', () => {
  it('reveals the whole input above the keyboard and does not repeatedly move an already visible field', () => {
    const { component, scroll } = form(); fixture.callbacks.get('keyboardDidShow')!(); vi.runAllTimers();
    expect(scroll).toHaveBeenCalledOnce(); expect(scroll).toHaveBeenCalledWith({ y: 314, animated: false });
    expect(fixture.inputTop + fixture.inputHeight).toBe(584);
    fixture.callbacks.get('keyboardDidChangeFrame')!(); vi.runAllTimers(); expect(scroll).toHaveBeenCalledOnce();
    component.componentWillUnmount(); expect(fixture.remove).toHaveBeenCalledTimes(2);
  });
  it('keeps space for the label when focus moves above the viewport', () => {
    fixture.inputTop = 150; const { component, rendered, scroll } = form(); rendered.props.onFocus({}); vi.runAllTimers();
    expect(scroll).toHaveBeenCalledWith({ y: 170, animated: false }); expect(fixture.inputTop - 40).toBe(140);
    component.componentWillUnmount();
  });
  it('rechecks after late keyboard resizing and cancels work after closure', () => {
    const { component, rendered, scroll } = form(); rendered.props.onLayout({}); vi.advanceTimersByTime(100);
    fixture.keyboardTop = 500; vi.runAllTimers(); expect(fixture.inputTop + fixture.inputHeight).toBe(484);
    scroll.mockClear(); rendered.props.onFocus({}); fixture.visible = false; vi.runAllTimers(); expect(scroll).not.toHaveBeenCalled();
    fixture.visible = true; fixture.focused = null; rendered.props.onFocus({}); vi.runAllTimers(); expect(scroll).not.toHaveBeenCalled();
    rendered.props.onLayout({}); component.componentWillUnmount(); vi.runAllTimers(); expect(scroll).not.toHaveBeenCalled();
  });
});
