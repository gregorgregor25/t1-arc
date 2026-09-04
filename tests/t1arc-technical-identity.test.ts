import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

type TechnicalIdentity = {
  schemaVersion: number;
  status: string;
  repository: { owner: string; name: string; url: string };
  product: { displayName: string; npmName: string; expoSlug: string };
  android: {
    namespaceRoot: string;
    phoneApplicationId: string;
    wearCompanionApplicationId: string;
    watchFaceApplicationIds: Record<string, string>;
    variants: {
      debugApplicationIdSuffix: string;
      privateTestApplicationIdSuffix: string;
      forkApplicationIdBaseEnvironmentVariable: string;
    };
  };
  nativeModules: {
    directoryPrefix: string;
    bridgePrefix: string;
    bridges: Record<string, string>;
  };
  links: { scheme: string; prefix: string };
  backup: Record<string, string>;
  maintainerMigration: Record<string, string>;
  wear: Record<string, string>;
  persistence: Record<string, string>;
  background: Record<string, string>;
  notifications: Record<string, string>;
  records: Record<string, string>;
};

const identity = JSON.parse(
  readFileSync(
    new URL('../config/t1arc-technical-identity.json', import.meta.url),
    'utf8',
  ),
) as TechnicalIdentity;

describe('permanent T1 Arc technical identity', () => {
  it('freezes the public repository and product identity', () => {
    expect(identity.schemaVersion).toBe(1);
    expect(identity.status).toBe('frozen-before-public-release');
    expect(identity.repository).toEqual({
      owner: 'gregorgregor25',
      name: 't1-arc',
      url: 'https://github.com/gregorgregor25/t1-arc',
    });
    expect(identity.product).toEqual({
      displayName: 'T1 Arc',
      npmName: 't1-arc',
      expoSlug: 't1-arc',
    });
  });

  it('freezes application IDs and isolates non-production variants', () => {
    const namespace = 'io.github.gregorgregor25.t1arc';
    expect(identity.android.namespaceRoot).toBe(namespace);
    expect(identity.android.phoneApplicationId).toBe(namespace);
    expect(identity.android.wearCompanionApplicationId).toBe(namespace);
    expect(identity.android.watchFaceApplicationIds).toEqual({
      meridian: `${namespace}.watchface.meridian`,
      chronograph: `${namespace}.watchface.chronograph`,
      orbit: `${namespace}.watchface.orbit`,
    });
    expect(identity.android.variants).toEqual({
      debugApplicationIdSuffix: '.dev',
      privateTestApplicationIdSuffix: '.sideload',
      forkApplicationIdBaseEnvironmentVariable:
        'T1ARC_FORK_APPLICATION_ID_BASE',
    });
  });

  it('keeps native module names in one T1 Arc family', () => {
    expect(identity.nativeModules.directoryPrefix).toBe('t1arc-');
    expect(identity.nativeModules.bridgePrefix).toBe('T1Arc');
    expect(identity.nativeModules.bridges).toEqual({
      backupCrypto: 'T1ArcBackupCrypto',
      glookoExport: 'T1ArcGlookoExport',
      glucoseDisplay: 'T1ArcGlucoseDisplay',
      healthConnect: 'T1ArcHealthConnect',
      notificationSource: 'T1ArcNotificationSource',
    });
  });

  it('freezes all cross-process and persisted identity prefixes', () => {
    expect(identity.links).toEqual({ scheme: 't1arc', prefix: 't1arc://' });
    expect(identity.backup).toEqual({
      documentFormat: 't1arc-health-backup',
      mimeType: 'application/vnd.t1arc.health-backup',
      extension: '.t1arc',
      encryptedContainerMagic: 'T1ARCBK1',
      streamedContainerMagic: 'T1ARCCN1',
    });
    expect(identity.maintainerMigration).toEqual({
      documentFormat: 't1arc-maintainer-migration',
      mimeType: 'application/vnd.t1arc.maintainer-migration',
      extension: '.t1arc-migration',
      encryptedContainerMagic: 'T1ARCMG1',
      recordFingerprintMagic: 'T1ARCRF1',
    });
    expect(identity.wear).toEqual({
      routePrefix: '/t1arc/v1',
      currentGlucosePath: '/t1arc/v1/glucose/current',
      glucoseHistoryPath: '/t1arc/v1/glucose/history',
      glucoseRequestPath: '/t1arc/v1/glucose/request',
      capability: 't1arc_glucose_companion_v1',
    });
    expect(identity.persistence).toEqual({
      databaseFile: 't1arc-health-v1.db',
      databaseKey: 't1arc.database.key.v1',
      secureStorePrefix: 't1arc.',
      nativePreferencesPrefix: 't1arc_',
      keystoreAliasPrefix: 't1arc.',
    });
    expect(identity.background).toEqual({
      taskPrefix: 't1arc.background.',
    });
    expect(identity.notifications).toEqual({
      channelPrefix: 't1arc_',
      intentActionPrefix: 'io.github.gregorgregor25.t1arc.action.',
    });
    expect(identity.records).toEqual({
      sourcePrefix: 't1arc-',
      canonicalFingerprintAlgorithm: 't1arc-canonical-cyrb128-v1',
    });
  });

  it('uses valid reverse-DNS identifiers and fixed-width container magics', () => {
    const applicationId = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
    expect(identity.android.phoneApplicationId).toMatch(applicationId);
    for (const id of Object.values(identity.android.watchFaceApplicationIds)) {
      expect(id).toMatch(applicationId);
    }
    expect(identity.backup.encryptedContainerMagic).toHaveLength(8);
    expect(identity.backup.streamedContainerMagic).toHaveLength(8);
    expect(identity.maintainerMigration.encryptedContainerMagic).toHaveLength(8);
    expect(identity.maintainerMigration.recordFingerprintMagic).toHaveLength(8);
  });
});
