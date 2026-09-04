import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

describe('Metro production performance configuration', () => {
  it('extends Expo Metro and defers module evaluation at startup', async () => {
    const filename = path.join(process.cwd(), 'metro.config.js');
    const source = readFileSync(filename, 'utf8');
    const getDefaultConfig = vi.fn(() => ({ transformer: {} }));
    const module = { exports: {} as Record<string, unknown> };

    vm.runInNewContext(source, {
      __dirname: process.cwd(),
      module,
      require: (specifier: string) => {
        expect(specifier).toBe('expo/metro-config');
        return { getDefaultConfig };
      },
    }, { filename });

    expect(getDefaultConfig).toHaveBeenCalledWith(process.cwd());
    const config = module.exports as {
      transformer: {
        getTransformOptions: () => Promise<{
          transform: Record<string, boolean>;
        }>;
      };
    };
    await expect(config.transformer.getTransformOptions()).resolves.toEqual({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    });
  });
});
