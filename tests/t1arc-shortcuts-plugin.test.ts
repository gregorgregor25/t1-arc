import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const root = process.cwd();
const pluginPath = path.join(root, 'plugins', 'with-t1arc-shortcuts.js');

describe('T1 Arc shortcuts Expo plugin identity', () => {
  it('uses only the T1 Arc plugin path in Expo configuration', () => {
    const appConfig = JSON.parse(
      readFileSync(path.join(root, 'app.json'), 'utf8'),
    ) as { expo: { plugins: (string | [string, object])[] } };
    const pluginNames = appConfig.expo.plugins.map((plugin) =>
      Array.isArray(plugin) ? plugin[0] : plugin,
    );

    expect(
      pluginNames.filter(
        (plugin) => plugin === './plugins/with-t1arc-shortcuts',
      ),
    ).toHaveLength(1);
    expect(existsSync(pluginPath)).toBe(true);
  });

  it('keeps a callable T1 Arc plugin that emits canonical app links', () => {
    const shortcutsPlugin = require(pluginPath) as (config: object) => object;
    const pluginSource = readFileSync(pluginPath, 'utf8');

    expect(typeof shortcutsPlugin).toBe('function');
    expect(shortcutsPlugin.name).toBe('withT1ArcShortcuts');
    expect(pluginSource).toContain('android:data="t1arc://today/log-food"');
    expect(pluginSource).toContain(
      'android:data="t1arc://today/log-context"',
    );
    expect(pluginSource).toContain("'android:resource': '@xml/t1arc_shortcuts'");
    expect(pluginSource).toContain("path.join(xmlRoot, 't1arc_shortcuts.xml')");
    expect(pluginSource).toContain(
      "path.join(valuesRoot, 't1arc_shortcut_strings.xml')",
    );
    expect(pluginSource).toContain('android:shortcutId="log_food"');
    expect(pluginSource).toContain('android:shortcutId="log_context"');
    for (const stringId of [
      't1arc_shortcut_log_food_short',
      't1arc_shortcut_log_food_long',
      't1arc_shortcut_log_context_short',
      't1arc_shortcut_log_context_long',
    ]) {
      expect(pluginSource).toContain(stringId);
    }
    expect(pluginSource).toContain(
      'android:targetPackage="@string/t1arc_application_id"',
    );
    expect(pluginSource).toContain(
      'android:targetClass="${androidConfig.android?.package}.MainActivity"',
    );
  });
});
