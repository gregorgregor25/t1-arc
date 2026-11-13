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
  join(cliRoot, 'build/src/start/server/devtools/DevToolsPlugin.schema.js'),
) as {
  PluginSchema: { type: string; required: string[] };
  DevToolsPluginOutputSchema: { type: string };
};
const { createMCPDevToolsExtensionSchema } = require(
  join(cliRoot, 'build/src/start/server/mcp/createMCPDevToolsExtensionSchema.js'),
) as {
  createMCPDevToolsExtensionSchema(plugin: unknown, z: unknown): { safeParse(value: unknown): { success: boolean } };
};

describe('Expo CLI Zod compatibility', () => {
  it('resolves the patched Zod major for Expo CLI', () => {
    expect(zodPackage.version).toBe('4.6.7');
    for (const moduleName of ['devtools/DevToolsPlugin.schema.js', 'mcp/createMCPDevToolsExtensionSchema.js']) {
      const source = readFileSync(join(cliRoot, 'build/src/start/server', moduleName), 'utf8');
      // Expo CLI 57.0.34 no longer bundles Zod schemas: plugin configuration is plain JSON Schema
      // and the MCP schema receives Zod from the caller. Neither may pull in the v3 compatibility layer.
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
    expect(PluginSchema).toMatchObject({ type: 'object' });
    expect(PluginSchema.required).toEqual(expect.arrayContaining(['packageName', 'packageRoot']));
    expect(DevToolsPluginOutputSchema).toMatchObject({ type: 'array' });
    const schema = createMCPDevToolsExtensionSchema(plugin, zod.z);
    expect(schema.safeParse({ command: 'ask', text: 'hello' }).success).toBe(true);
    expect(schema.safeParse({ command: 'unknown' }).success).toBe(false);
  });
});
