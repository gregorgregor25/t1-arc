import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Tarv1s settings discovery contract', () => {
  it('links the main settings menu to the existing Tarv1s settings without sending a question', () => {
    const sources = readFileSync('src/screens/SourcesScreen.tsx', 'utf8');
    expect(sources).toContain('accessibilityLabel="Open Tarv1s settings"');
    expect(sources).toContain("navigation.navigate('Insights', { settings: true })");
    const parent = readFileSync('src/screens/InsightsScreen.tsx', 'utf8');
    expect(parent).toContain('settingsRequested={route.params?.settings === true}');
    expect(parent).toContain('onSettingsRequestHandled={consumeSettingsRequest}');
    expect(parent).toContain('navigation.setParams({ settings: undefined })');
    expect(parent).toContain("navigation.navigate('Sources', { focused: false, source: undefined })");
  });

  it('offers settings on Tarv1s home without visiting conversation history', () => {
    const source = readFileSync('src/screens/TarvisScreen.tsx', 'utf8');
    expect(source).toContain('historyVisible || !conversationVisible ? "Open Tarv1s settings"');
    expect(source).toContain('if (settingsVisible) {\n      closeTarvisSettings();');
    expect(source).toContain('settingsOpenedFromMenu.current = false;');
    expect(source).toContain('onReturnToSettings?.();');
    expect(source).toContain('settingsOpenedFromMenu.current ? "Back to Settings" : "Back to Tarv1s"');
  });
});
