import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Tarv1s settings discovery contract', () => {
  it('links the main settings menu to the existing Tarv1s settings without sending a question', () => {
    const pages = readFileSync('src/screens/settings/SettingsPages.tsx', 'utf8');
    expect(pages).toContain('accessibilityLabel="Open Tarv1s settings"');
    expect(pages).toContain('onPress={() => openScreen("TarvisSettings")}');
    const sources = readFileSync('src/screens/SourcesScreen.tsx', 'utf8');
    expect(sources).toContain("navigation.navigate('Insights', { settings: true })");
    const parent = readFileSync('src/screens/InsightsScreen.tsx', 'utf8');
    expect(parent).toContain('settingsRequested={route.params?.settings === true}');
    expect(parent).toContain('onSettingsRequestHandled={consumeSettingsRequest}');
    expect(parent).toContain('navigation.setParams({ settings: undefined })');
    expect(parent).toContain("navigation.navigate('Sources', { focused: false, source: undefined })");
  });

  it('offers settings from the Tarv1s header menu by linking to Settings, Tarv1s', () => {
    const source = readFileSync('src/screens/TarvisScreen.tsx', 'utf8');
    expect(source).toContain('navigation.navigate("Sources", sourceSettingsRouteParams("tarvis"))');
    expect(source).toMatch(/case "settings":\s*openTarvisSettingsPage\(\);/);
    expect(source).toContain('<TarvisHeaderMenu items={headerMenuItems} onSelect={chooseHeaderMenuItem} />');
    expect(source).toMatch(/if \(settingsVisible\) \{[\s\S]{0,500}?closeTarvisSettings\(\);/);
    expect(source).toContain('settingsOpenedFromMenu.current = false;');
    expect(source).toContain('onReturnToSettings?.();');
    expect(source).toContain('settingsOpenedFromMenu.current ? "Back to Settings" : "Back to Tarv1s"');
  });
});
