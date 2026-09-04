import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

type XdripNetworkPlugin = ((config: unknown) => unknown) & {
  DEVELOPMENT_CONFIG: string;
  NETWORK_RESOURCE_REFERENCE: string;
  RELEASE_CONFIG: string;
  RESOURCE_NAME: string;
  writeNetworkConfig: (
    root: string,
    sourceSet: string,
    contents: string,
  ) => void;
};

const require = createRequire(import.meta.url);
const plugin = require(
  '../plugins/with-xdrip-local-network.js',
) as XdripNetworkPlugin;

const EXPECTED_RELEASE_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">127.0.0.1</domain>
    <domain includeSubdomains="false">localhost</domain>
  </domain-config>
</network-security-config>
`;

const EXPECTED_DEVELOPMENT_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true" />
</network-security-config>
`;

describe('xDrip local-network Android policy', () => {
  it('uses the T1 Arc developer resource name without changing its policy', () => {
    expect(plugin.RESOURCE_NAME).toBe('t1arc_network_security_config.xml');
    expect(plugin.NETWORK_RESOURCE_REFERENCE).toBe(
      '@xml/t1arc_network_security_config',
    );

    expect(plugin.RELEASE_CONFIG).toBe(EXPECTED_RELEASE_CONFIG);
    expect(plugin.DEVELOPMENT_CONFIG).toBe(EXPECTED_DEVELOPMENT_CONFIG);
  });

  it('updates only the managed resource during incremental prebuild', () => {
    const root = mkdtempSync(join(tmpdir(), 't1arc-network-policy-'));
    const xmlRoot = join(root, 'app', 'src', 'main', 'res', 'xml');
    const managedPath = join(xmlRoot, plugin.RESOURCE_NAME);
    const unrelatedPath = join(xmlRoot, 'unrelated.xml');

    try {
      mkdirSync(xmlRoot, { recursive: true });
      writeFileSync(managedPath, 'outdated');
      writeFileSync(unrelatedPath, 'keep');

      plugin.writeNetworkConfig(root, 'main', EXPECTED_RELEASE_CONFIG);

      expect(readFileSync(unrelatedPath, 'utf8')).toBe('keep');
      expect(readFileSync(managedPath, 'utf8')).toBe(EXPECTED_RELEASE_CONFIG);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps generated source sets aligned when the native tree exists', () => {
    const nativeMain = new URL('../android/app/src/main/res/xml/', import.meta.url);
    if (!existsSync(nativeMain)) {
      return;
    }

    const manifest = readFileSync(
      new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url),
      'utf8',
    );
    expect(manifest).toContain(
      `android:networkSecurityConfig="${plugin.NETWORK_RESOURCE_REFERENCE}"`,
    );
    for (const [sourceSet, expected] of [
      ['main', EXPECTED_RELEASE_CONFIG],
      ['debug', EXPECTED_DEVELOPMENT_CONFIG],
      ['debugOptimized', EXPECTED_DEVELOPMENT_CONFIG],
    ] as const) {
      const renamed = new URL(
        `../android/app/src/${sourceSet}/res/xml/${plugin.RESOURCE_NAME}`,
        import.meta.url,
      );
      expect(existsSync(renamed), `${sourceSet} resource should exist`).toBe(
        true,
      );
      expect(readFileSync(renamed, 'utf8')).toBe(expected);
    }
  });
});
