import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const expoRoot = dirname(require.resolve('expo/package.json'));
const cliRoot = dirname(require.resolve('@expo/cli/package.json', { paths: [expoRoot] }));
const zodRoot = dirname(require.resolve('zod/package.json', { paths: [cliRoot] }));
const zodPackage = require(join(zodRoot, 'package.json')) as { version: string };
const zod = require(require.resolve('zod', { paths: [cliRoot] })) as typeof import('zod');
const { PluginSchema, DevToolsPluginOutputSchema } = require(
  join(cliRoot, 'build/src/start/server/DevToolsPlugin.schema.js'),
) as {
  PluginSchema: { safeParse(value: unknown): { success: boolean } };
  DevToolsPluginOutputSchema: { safeParse(value: unknown): { success: boolean } };
};
const { createMCPDevToolsExtensionSchema } = require(
  join(cliRoot, 'build/src/start/server/createMCPDevToolsExtensionSchema.js'),
) as {
  createMCPDevToolsExtensionSchema(plugin: unknown): { safeParse(value: unknown): { success: boolean } };
};

describe('Expo CLI Zod compatibility', () => {
  it('resolves the patched Zod major for Expo CLI', () => {
    expect(zodPackage.version).toBe('4.6.7');
    for (const moduleName of ['DevToolsPlugin.schema.js', 'createMCPDevToolsExtensionSchema.js']) {
      const source = readFileSync(join(cliRoot, 'build/src/start/server', moduleName), 'utf8');
      expect(source).toContain('require("zod")');
      expect(source).not.toContain('zod/v3');
    }
  });

  it('stops an oversized constrained array before parsing its elements', () => {
    let parsedElements = 0;
    const schema = zod.z.array(zod.z.string().transform((value) => {
      parsedElements += 1;
      return value;
    })).max(2);
    expect(schema.safeParse(Array(10_000).fill('x')).success).toBe(false);
    expect(parsedElements).toBe(0);
  });

  it('validates plugin configuration and output with Expo CLI’s real schemas', () => {
    const plugin = {
      packageName: 'example', packageRoot: '/tmp/example',
      cliExtensions: {
        description: 'Example', entryPoint: './index.js',
        commands: [{ name: 'ask', title: 'Ask', environments: ['cli'], parameters: [{ name: 'text', type: 'text' }] }],
      },
    };
    expect(PluginSchema.safeParse(plugin).success).toBe(true);
    expect(PluginSchema.safeParse({}).success).toBe(false);
    expect(DevToolsPluginOutputSchema.safeParse([{ type: 'text', text: 'ok', level: 'info' }]).success).toBe(true);
    expect(DevToolsPluginOutputSchema.safeParse([{ type: 'text', text: 3 }]).success).toBe(false);
    const schema = createMCPDevToolsExtensionSchema(plugin);
    expect(schema.safeParse({ command: 'ask', text: 'hello' }).success).toBe(true);
    expect(schema.safeParse({ command: 'unknown' }).success).toBe(false);
  });
});
