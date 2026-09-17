import { Component, createRef } from 'react';
import { Keyboard, Platform, ScrollView, TextInput, type EmitterSubscription, type ScrollViewProps } from 'react-native';

/** Keep the focused field and its label inside the resized modal viewport. */
export class KeyboardFormScrollView extends Component<ScrollViewProps> {
  private scroll = createRef<ScrollView>();
  private subscriptions: EmitterSubscription[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private offset = 0;
  private generation = 0;

  componentDidMount() {
    if (Platform.OS !== 'android') return;
    this.subscriptions = ['keyboardDidShow', 'keyboardDidChangeFrame'].map(event =>
      Keyboard.addListener(event as 'keyboardDidShow', this.revealFocus));
  }

  componentWillUnmount() {
    this.subscriptions.forEach(subscription => subscription.remove());
    this.timers.forEach(clearTimeout);
    this.generation++;
  }

  private revealFocus = () => {
    if (Platform.OS !== 'android') return;
    this.timers.forEach(clearTimeout);
    const generation = ++this.generation;
    const measure = () => {
      const input = TextInput.State.currentlyFocusedInput();
      const scroll = this.scroll.current;
      if (!input || !scroll || !Keyboard.isVisible()) return;
      scroll.getNativeScrollRef()?.measureInWindow((_x, top, _width, height) => {
        input.measureInWindow((_inputX, inputTop, _inputWidth, inputHeight) => {
          if (generation !== this.generation || input !== TextInput.State.currentlyFocusedInput() || !Keyboard.isVisible() || height <= 0 || inputHeight <= 0) return;
          const bottom = Math.min(top + height, Keyboard.metrics()?.screenY ?? Infinity) - 16;
          // Leave room above the input for its label, including larger text.
          const labelTop = inputTop - 40;
          const delta = inputTop + inputHeight > bottom ? inputTop + inputHeight - bottom
            : labelTop < top ? labelTop - top : 0;
          if (Math.abs(delta) > 1) scroll.scrollTo({ y: Math.max(0, this.offset + delta), animated: false });
        });
      });
    };
    // Modal layout and the IME can settle on different frames (including Gboard banners).
    this.timers = [setTimeout(measure, 80), setTimeout(measure, 320)];
  };

  render() {
    return <ScrollView {...this.props} ref={this.scroll} scrollEventThrottle={16}
      onScroll={event => { this.offset = event.nativeEvent.contentOffset.y; this.props.onScroll?.(event); }}
      onFocus={event => { this.props.onFocus?.(event); this.revealFocus(); }}
      onLayout={event => { this.props.onLayout?.(event); this.revealFocus(); }} />;
  }
}
