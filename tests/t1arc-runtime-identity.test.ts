import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

function withoutComments(contents: string) {
  return contents
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function xmlSource(relativePath: string) {
  return source(relativePath).replace(/<!--[\s\S]*?-->/g, '');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type ActiveReference = {
  file: string;
  pattern: RegExp;
};

type StringBindingContract = {
  category: string;
  file: string;
  name: string;
  value: string;
  references?: readonly ActiveReference[];
};

type ProtectedStringBindingGroup =
  | 'persisted'
  | 'background'
  | 'record'
  | 'notification-channel'
  | 'wire';

type LedgerStringBinding = Omit<StringBindingContract, 'references'> & {
  group: ProtectedStringBindingGroup;
};

type RuntimeIdentifierLedger = {
  schemaVersion: number;
  productName: string;
  protectedStringBindings: LedgerStringBinding[];
  applicationIds: { id: string; value: string; file: string }[];
  storageContracts: { id: string; value: string; file: string }[];
  nativeBridges: {
    id: string;
    value: string;
    nativeFile: string;
    typescriptFile: string;
  }[];
  backupContracts: {
    id: string;
    value: string;
    file: string;
    disposition: string;
  }[];
  persistentAndroidComponents: ComponentContract[];
};

const RUNTIME_IDENTIFIER_LEDGER = JSON.parse(
  source('config/t1arc-runtime-identifiers.json'),
) as RuntimeIdentifierLedger;

function ledgerValue(
  entries: readonly { id: string; value: string }[],
  id: string,
) {
  const entry = entries.find((candidate) => candidate.id === id);
  expect(entry, `runtime identifier ledger must contain ${id}`).toBeDefined();
  return entry!.value;
}

function expectActiveStringBinding(contract: StringBindingContract) {
  const contents = withoutComments(source(contract.file));
  const escapedValue = escapeRegExp(contract.value);
  const quotedValue =
    "(?:'" + escapedValue + "'|\"" + escapedValue + '\"|`' + escapedValue + '`)';
  const declaration = new RegExp(
    '^\\s*(?:export\\s+)?(?:(?:private|internal)\\s+)?const(?:\\s+val)?\\s+' +
      escapeRegExp(contract.name) +
      '\\s*=\\s*' +
      quotedValue +
      '(?:\\s+as\\s+const)?\\s*;?\\s*$',
    'm',
  );

  expect(
    contents,
    `${contract.category} must actively bind ${contract.name} to ${contract.value}`,
  ).toMatch(declaration);

  const localReferences =
    contents.match(new RegExp(`\\b${escapeRegExp(contract.name)}\\b`, 'g'))
      ?.length ?? 0;
  if (!contract.references?.length) {
    expect(
      localReferences,
      `${contract.name} must be consumed, not merely declared`,
    ).toBeGreaterThan(1);
    return;
  }

  for (const reference of contract.references) {
    expect(
      withoutComments(source(reference.file)),
      `${contract.name} must remain active in ${reference.file}`,
    ).toMatch(reference.pattern);
  }
}

const PERSISTED_BINDINGS: readonly StringBindingContract[] = [
  {
    category: 'current database filename',
    file: 'src/data/persistence/t1arcDatabase.ts',
    name: 'DATABASE_NAME',
    value: 't1arc-health-v1.db',
  },
  {
    category: 'SQLCipher secure-store key',
    file: 'src/data/persistence/t1arcDatabase.ts',
    name: 'DATABASE_KEY',
    value: 't1arc.database.key.v1',
  },
  {
    category: 'applied maintainer-migration marker',
    file: 'src/data/migration/migrationFormat.ts',
    name: 'MAINTAINER_MIGRATION_APPLIED_KEY',
    value: 't1arc.migration.applied.v1',
    references: [
      {
        file: 'src/data/backup/healthBackup.ts',
        pattern: /MAINTAINER_MIGRATION_APPLIED_KEY/,
      },
    ],
  },
  {
    category: 'Dexcom Share secure-store key',
    file: 'src/data/dexcomShare/secureStore.ts',
    name: 'DEXCOM_SHARE_CONNECTION_KEY',
    value: 't1arc.dexcom-share.connection.v1',
  },
  {
    category: 'Hevy revision-scoped secure-store prefix',
    file: 'src/data/hevy/secureStore.ts',
    name: 'HEVY_CREDENTIAL_KEY_PREFIX',
    value: ledgerValue(
      RUNTIME_IDENTIFIER_LEDGER.storageContracts,
      'hevy-credential-prefix',
    ),
  },
  {
    category: 'LibreLinkUp credential key',
    file: 'src/data/libreLinkUp/secureStore.ts',
    name: 'CREDENTIALS_KEY',
    value: 't1arc.librelinkup.credentials.v1',
  },
  {
    category: 'LibreLinkUp session key',
    file: 'src/data/libreLinkUp/secureStore.ts',
    name: 'SESSION_KEY',
    value: 't1arc.librelinkup.session.v1',
  },
  {
    category: 'LibreLinkUp data-mode key',
    file: 'src/data/libreLinkUp/secureStore.ts',
    name: 'DATA_MODE_KEY',
    value: 't1arc.data.mode.v1',
  },
  {
    category: 'Medtrum secure-store key',
    file: 'src/data/medtrum/secureStore.ts',
    name: 'MEDTRUM_CONNECTION_KEY',
    value: 't1arc.medtrum.connection.v1',
  },
  {
    category: 'Nightscout secure-store key',
    file: 'src/data/nightscout/secureStore.ts',
    name: 'NIGHTSCOUT_CONNECTION_KEY',
    value: 't1arc.nightscout.connection.v1',
  },
  {
    category: 'xDrip secure-store key',
    file: 'src/data/xdrip/secureStore.ts',
    name: 'XDRIP_CONNECTION_KEY',
    value: 't1arc.xdrip.connection.v1',
  },
  {
    category: 'Glooko report-inbox state',
    file: 'src/data/glooko/glookoReportInbox.ts',
    name: 'REPORT_INBOX_KEY',
    value: 't1arc.glooko.report-inbox.v1',
  },
  {
    category: 'glucose-alert preferences',
    file: 'src/data/glucoseAlerts/glucoseAlertPreferences.ts',
    name: 'PREFERENCES_KEY',
    value: 't1arc.glucose-alert-preferences.v1',
  },
  {
    category: 'glucose-alert state',
    file: 'src/data/glucoseAlerts/glucoseAlertPreferences.ts',
    name: 'STATE_KEY',
    value: 't1arc.glucose-alert-state.v1',
  },
  {
    category: 'Nightscout history cursor',
    file: 'src/data/nightscout/historyStateStore.ts',
    name: 'NIGHTSCOUT_HISTORY_STATE_KEY',
    value: 't1arc.nightscout.history-state.v1',
  },
  {
    category: 'Nightscout IOB/COB state',
    file: 'src/data/nightscout/secureStore.ts',
    name: 'NIGHTSCOUT_IOB_COB_KEY',
    value: 't1arc.nightscout.iob-cob.v1',
  },
  {
    category: 'current onboarding state',
    file: 'src/data/onboarding/onboardingStore.ts',
    name: 'ONBOARDING_STATE_KEY',
    value: 't1arc.onboarding.walkthrough.v1',
  },
  {
    category: 'insight-review preferences',
    file: 'src/data/insights/insightReviewPreferences.ts',
    name: 'REVIEW_PREFERENCES_KEY',
    value: 't1arc.insight-review-preferences.v1',
  },
  {
    category: 'health-goal preferences',
    file: 'src/data/healthGoals.ts',
    name: 'STEP_GOAL_KEY',
    value: 't1arc.health-goals.steps.v1',
  },
  {
    category: 'theme preference',
    file: 'src/data/themePreference.ts',
    name: 'THEME_PREFERENCE_KEY',
    value: 't1arc.app-theme.v1',
  },
  {
    category: 'regional-profile preference',
    file: 'src/data/regionalProfile.ts',
    name: 'REGIONAL_PROFILE_KEY',
    value: 't1arc.regional-profile.v2',
  },
  {
    category: 'Tarv1s treatment-profile preference',
    file: 'src/data/tarvis/treatmentProfile.ts',
    name: 'STORAGE_KEY',
    value: 't1arc.tarvis-treatment-profile.v1',
  },
  {
    category: 'Tarv1s OpenAI BYOK secure-store key',
    file: 'src/data/tarvis/secureStore.ts',
    name: 'API_KEY_KEY',
    value: 't1arc.tarvis.openai-key.v1',
  },
  {
    category: 'Tarv1s usage secure-store key',
    file: 'src/data/tarvis/secureStore.ts',
    name: 'USAGE_KEY',
    value: 't1arc.tarvis.usage.v1',
  },
  {
    category: 'Tarv1s safety-identifier secure-store key',
    file: 'src/data/tarvis/secureStore.ts',
    name: 'SAFETY_ID_KEY',
    value: 't1arc.tarvis.safety-id.v1',
  },
  {
    category: 'native glucose-display preferences',
    file: 'modules/t1arc-glucose-display/android/src/main/java/io/github/gregorgregor25/t1arc/glucosedisplay/T1ArcGlucoseDisplayModule.kt',
    name: 'PREFERENCES_NAME',
    value: 't1arc_glucose_display',
  },
  {
    category: 'native glucose snapshot keystore alias',
    file: 'modules/t1arc-glucose-display/android/src/main/java/io/github/gregorgregor25/t1arc/glucosedisplay/T1ArcGlucoseDisplayModule.kt',
    name: 'SNAPSHOT_KEY_ALIAS',
    value: 't1arc.glucose-display.snapshot.v1',
  },
  {
    category: 'notification-capture preferences',
    file: 'modules/t1arc-notification-source/android/src/main/java/io/github/gregorgregor25/t1arc/notificationsource/NotificationCaptureStore.kt',
    name: 'PREFERENCES_NAME',
    value: 't1arc_notification_source_v1',
  },
  {
    category: 'notification-capture keystore alias',
    file: 'modules/t1arc-notification-source/android/src/main/java/io/github/gregorgregor25/t1arc/notificationsource/NotificationCaptureStore.kt',
    name: 'KEY_ALIAS',
    value: 't1arc.notification.capture.v1',
  },
  {
    category: 'notification-capture queue file',
    file: 'modules/t1arc-notification-source/android/src/main/java/io/github/gregorgregor25/t1arc/notificationsource/NotificationCaptureStore.kt',
    name: 'QUEUE_FILE',
    value: 't1arc-notification-capture-v1.bin',
  },
  {
    category: 'native Glooko credential preferences',
    file: 'modules/t1arc-glooko-export/android/src/main/java/io/github/gregorgregor25/t1arc/glooko/GlookoCredentialVault.kt',
    name: 'PREFERENCES',
    value: 't1arc_glooko_credentials_v1',
  },
  {
    category: 'native Glooko credential keystore alias',
    file: 'modules/t1arc-glooko-export/android/src/main/java/io/github/gregorgregor25/t1arc/glooko/GlookoCredentialVault.kt',
    name: 'KEY_ALIAS',
    value: 't1arc_glooko_credentials_v1',
  },
  {
    category: 'native Glooko trace preferences',
    file: 'modules/t1arc-glooko-export/android/src/main/java/io/github/gregorgregor25/t1arc/glooko/T1ArcGlookoExportModule.kt',
    name: 'GLOOKO_TRACE_PREFERENCES',
    value: 't1arc_glooko_export',
  },
  {
    category: 'native Glooko regional preferences',
    file: 'modules/t1arc-glooko-export/android/src/main/java/io/github/gregorgregor25/t1arc/glooko/GlookoRegionalPreferences.kt',
    name: 'PREFERENCES',
    value: 't1arc_glooko_regional_v1',
  },
  {
    category: 'native Glooko account-fingerprint keystore alias',
    file: 'modules/t1arc-glooko-export/android/src/main/java/io/github/gregorgregor25/t1arc/glooko/GlookoAccountFingerprint.kt',
    name: 'KEY_ALIAS',
    value: 't1arc_glooko_account_fingerprint_v1',
  },
  {
    category: 'native Glooko renderer artifact prefix',
    file: 'modules/t1arc-glooko-export/android/src/main/java/io/github/gregorgregor25/t1arc/glooko/GlookoReportArtifactCleanup.kt',
    name: 'GLOOKO_RENDERER_PREFIX',
    value: 't1arc-glooko-report-',
  },
  {
    category: 'Android Auto notification-policy preferences',
    file: 'modules/t1arc-glucose-display/android/src/main/java/io/github/gregorgregor25/t1arc/glucosedisplay/T1ArcAndroidAuto.kt',
    name: 'CAR_NOTIFICATION_POLICY_PREFS',
    value: 't1arc_car_notification_policy_v3',
  },
  {
    category: 'Wear glucose preferences',
    file: 'wear/companion/src/main/java/io/github/gregorgregor25/t1arc/wear/data/T1ArcWearRepository.kt',
    name: 'PREFERENCES_NAME',
    value: 't1arc_wear_secure_state',
  },
  {
    category: 'Wear glucose keystore alias',
    file: 'wear/companion/src/main/java/io/github/gregorgregor25/t1arc/wear/data/T1ArcWearRepository.kt',
    name: 'KEY_ALIAS',
    value: 't1arc.wear.glucose.v1',
  },
];

const DISPLAY_KOTLIN =
  'modules/t1arc-glucose-display/android/src/main/java/io/github/gregorgregor25/t1arc/glucosedisplay/T1ArcGlucoseDisplayModule.kt';
const ANDROID_AUTO_KOTLIN =
  'modules/t1arc-glucose-display/android/src/main/java/io/github/gregorgregor25/t1arc/glucosedisplay/T1ArcAndroidAuto.kt';

const BACKGROUND_BINDINGS: readonly StringBindingContract[] = [
  {
    category: 'Glooko background task',
    file: 'src/data/background/backgroundTaskNames.ts',
    name: 'GLOOKO_BACKGROUND_TASK',
    value: 't1arc.background.glooko-sync.v1',
    references: [
      {
        file: 'src/data/background/glookoSyncTask.ts',
        pattern: /TaskManager\.defineTask\(GLOOKO_BACKGROUND_TASK\b/,
      },
    ],
  },
  {
    category: 'Health Connect background task',
    file: 'src/data/background/backgroundTaskNames.ts',
    name: 'HEALTH_CONNECT_BACKGROUND_TASK',
    value: 't1arc.background.health-connect-sync.v1',
    references: [
      {
        file: 'src/data/background/healthConnectSyncTask.ts',
        pattern: /TaskManager\.defineTask\(HEALTH_CONNECT_BACKGROUND_TASK\b/,
      },
    ],
  },
  {
    category: 'LibreLinkUp background task',
    file: 'src/data/background/backgroundTaskNames.ts',
    name: 'LIBRE_BACKGROUND_TASK',
    value: 't1arc.background.librelinkup-sync.v1',
    references: [
      {
        file: 'src/data/background/libreSyncTask.ts',
        pattern: /TaskManager\.defineTask\(LIBRE_BACKGROUND_TASK\b/,
      },
    ],
  },
  {
    category: 'insight-review background task',
    file: 'src/data/background/backgroundTaskNames.ts',
    name: 'INSIGHT_REVIEW_BACKGROUND_TASK',
    value: 't1arc.background.insight-review.v1',
    references: [
      {
        file: 'src/data/background/insightReviewTask.ts',
        pattern: /TaskManager\.defineTask\(INSIGHT_REVIEW_BACKGROUND_TASK\b/,
      },
    ],
  },
  {
    category: 'Hevy background task',
    file: 'src/data/background/backgroundTaskNames.ts',
    name: 'HEVY_BACKGROUND_TASK',
    value: 't1arc.background.hevy-sync.v1',
    references: [
      {
        file: 'src/data/background/hevySyncTask.ts',
        pattern: /TaskManager\.defineTask\(HEVY_BACKGROUND_TASK\b/,
      },
    ],
  },
  {
    category: 'JavaScript glucose-display headless task',
    file: 'src/data/glucoseDisplay/glucoseDisplayCoordinator.ts',
    name: 'GLUCOSE_DISPLAY_HEADLESS_TASK',
    value: 'T1ArcLibreForegroundSync',
    references: [
      {
        file: DISPLAY_KOTLIN,
        pattern:
          /const\s+val\s+HEADLESS_TASK_KEY\s*=\s*["']T1ArcLibreForegroundSync["']/,
      },
    ],
  },
  {
    category: 'native glucose-display headless task',
    file: DISPLAY_KOTLIN,
    name: 'HEADLESS_TASK_KEY',
    value: 'T1ArcLibreForegroundSync',
    references: [
      {
        file: 'src/data/glucoseDisplay/glucoseDisplayCoordinator.ts',
        pattern:
          /GLUCOSE_DISPLAY_HEADLESS_TASK\s*=\s*["']T1ArcLibreForegroundSync["']/,
      },
    ],
  },
];

const RECORD_BINDINGS: readonly StringBindingContract[] = [
  {
    category: 'food record source',
    file: 'src/data/food/foodLogRepository.ts',
    name: 'FOOD_LOG_SOURCE_ID',
    value: 't1arc-food',
  },
  {
    category: 'food-catalogue regional payload field',
    file: 'src/data/food/providerRetention.ts',
    name: 'FOOD_CATALOGUE_REGIONAL_CONTEXT_KEY',
    value: '_t1arcRegionalContext',
  },
  {
    category: 'LibreLinkUp source',
    file: 'src/data/libreLinkUp/constants.ts',
    name: 'DIRECT_LIBRE_LINKUP_SOURCE_ID',
    value: 't1arc-librelinkup',
    references: [
      {
        file: 'src/data/libreLinkUp/DirectLibreLinkUpSource.ts',
        pattern: /readonly\s+sourceId\s*=\s*DIRECT_LIBRE_LINKUP_SOURCE_ID\b/,
      },
    ],
  },
  {
    category: 'composite glucose source',
    file: 'src/data/live/CompositeGlucoseSource.ts',
    name: 'COMPOSITE_GLUCOSE_SOURCE_ID',
    value: 't1arc-live-glucose',
  },
  {
    category: 'stored context source',
    file: 'src/data/live/StoredContextSource.ts',
    name: 'SOURCE_ID',
    value: 't1arc-context',
  },
  {
    category: 'manual context source',
    file: 'src/data/manualContext.ts',
    name: 'MANUAL_CONTEXT_SOURCE_ID',
    value: 't1arc-manual',
  },
  {
    category: 'manual ketone detail prefix',
    file: 'src/data/manualKetones.ts',
    name: 'DETAIL_PREFIX',
    value: 't1arc:ketone:v1:',
  },
  {
    category: 'Tarv1s safety-identifier value prefix',
    file: 'src/data/tarvis/secureStore.ts',
    name: 'SAFETY_IDENTIFIER_PREFIX',
    value: 't1arc-',
  },
  {
    category: 'synthetic glucose source',
    file: 'src/data/synthetic/SyntheticGlucoseSource.ts',
    name: 'SOURCE_ID',
    value: 'demo-t1arc-glucose',
  },
  {
    category: 'synthetic context source',
    file: 'src/data/synthetic/SyntheticContextSource.ts',
    name: 'SOURCE_ID',
    value: 'demo-t1arc-context',
  },
  {
    category: 'Tarv1s evidence fingerprint algorithm',
    file: 'src/data/tarvis/glucoseAnswerBundleV2.ts',
    name: 'GLUCOSE_ANSWER_BUNDLE_IDENTITY_ALGORITHM',
    value: 't1arc-canonical-cyrb128-v1',
  },
  {
    category: 'glucose-episode record algorithm',
    file: 'src/domain/insights.ts',
    name: 'GLUCOSE_EPISODE_DEFINITION_VERSION',
    value: 'consensus-15m-start-recovery-t1arc-gap12-canonical-v3',
    references: [
      {
        file: 'src/data/tarvis/glucoseAnswerBundleV2.ts',
        pattern:
          /bundle\.algorithms\.episodeDefinitionVersion\s*===\s*GLUCOSE_EPISODE_DEFINITION_VERSION\b/,
      },
    ],
  },
];

const NOTIFICATION_CHANNEL_BINDINGS: readonly StringBindingContract[] = [
  {
    category: 'current glucose notification channel',
    file: DISPLAY_KOTLIN,
    name: 'CHANNEL_ID',
    value: 't1arc_current_glucose_prominent_v2',
  },
  {
    category: 'weekly-review notification channel',
    file: DISPLAY_KOTLIN,
    name: 'REVIEW_CHANNEL_ID',
    value: 't1arc_weekly_review_v1',
  },
  {
    category: 'data-connection notification channel',
    file: DISPLAY_KOTLIN,
    name: 'CONNECTOR_CHANNEL_ID',
    value: 't1arc_data_connections_v1',
  },
  {
    category: 'glucose-alert channel group',
    file: DISPLAY_KOTLIN,
    name: 'ALERT_CHANNEL_GROUP_ID',
    value: 't1arc_glucose_alerts_group_v1',
  },
  {
    category: 'low-glucose alert channel',
    file: 'modules/t1arc-glucose-display/android/src/main/java/io/github/gregorgregor25/t1arc/glucosedisplay/GlucoseAlertChannelPolicy.kt',
    name: 'LOW_GLUCOSE_ALERT_CHANNEL_ID',
    value: 't1arc_low_glucose_alerts_v1',
  },
  {
    category: 'high-glucose alert channel',
    file: 'modules/t1arc-glucose-display/android/src/main/java/io/github/gregorgregor25/t1arc/glucosedisplay/GlucoseAlertChannelPolicy.kt',
    name: 'HIGH_GLUCOSE_ALERT_CHANNEL_ID',
    value: 't1arc_high_glucose_alerts_v1',
  },
  {
    category: 'stale-glucose alert channel',
    file: 'modules/t1arc-glucose-display/android/src/main/java/io/github/gregorgregor25/t1arc/glucosedisplay/GlucoseAlertChannelPolicy.kt',
    name: 'STALE_GLUCOSE_ALERT_CHANNEL_ID',
    value: 't1arc_glucose_freshness_alerts_v1',
  },
  {
    category: 'Android Auto alert channel',
    file: ANDROID_AUTO_KOTLIN,
    name: 'CAR_NOTIFICATION_ALERT_CHANNEL_ID',
    value: 't1arc_android_auto_glucose_v1',
  },
  {
    category: 'Android Auto quiet channel',
    file: ANDROID_AUTO_KOTLIN,
    name: 'CAR_NOTIFICATION_QUIET_CHANNEL_ID',
    value: 't1arc_android_auto_glucose_quiet_v1',
  },
];

const WIRE_BINDINGS: readonly StringBindingContract[] = [
  {
    category: 'native encrypted-backup extension',
    file: 'modules/t1arc-backup-crypto/android/src/main/java/io/github/gregorgregor25/t1arc/backup/T1ArcBackupCryptoModule.kt',
    name: 'ENCRYPTED_BACKUP_EXTENSION',
    value: '.t1arc',
    references: [
      {
        file: 'src/data/backup/healthBackup.ts',
        pattern: /HEALTH_BACKUP_EXTENSION\s*=\s*["']\.t1arc["']/,
      },
    ],
  },
  {
    category: 'native encrypted-migration extension',
    file: 'modules/t1arc-backup-crypto/android/src/main/java/io/github/gregorgregor25/t1arc/backup/T1ArcBackupCryptoModule.kt',
    name: 'ENCRYPTED_MIGRATION_EXTENSION',
    value: '.t1arc-migration',
    references: [
      {
        file: 'src/data/migration/migrationFormat.ts',
        pattern: /MAINTAINER_MIGRATION_EXTENSION\s*=\s*["']\.t1arc-migration["']/,
      },
    ],
  },
  {
    category: 'streamed health-container magic',
    file: 'src/data/backup/healthBackup.ts',
    name: 'CONTAINER_MAGIC_TEXT',
    value: 'T1ARCCN1',
    references: [
      {
        file: 'services/tarvis-lab/scripts/restore-raw-sqlite.js',
        pattern: /RAW_BACKUP_STREAM_MAGIC\s*=\s*["']T1ARCCN1["']/,
      },
    ],
  },
  {
    category: 'migration record-fingerprint magic',
    file: 'src/data/backup/healthBackup.ts',
    name: 'RECORD_FINGERPRINT_MAGIC_TEXT',
    value: 'T1ARCRF1',
  },
  {
    category: 'phone Wear capability',
    file: DISPLAY_KOTLIN,
    name: 'WEAR_CAPABILITY',
    value: 't1arc_glucose_companion_v1',
    references: [
      {
        file: 'wear/companion/src/main/res/values/wear_capabilities.xml',
        pattern: /<item>t1arc_glucose_companion_v1<\/item>/,
      },
    ],
  },
  {
    category: 'phone current-glucose Wear path',
    file: DISPLAY_KOTLIN,
    name: 'WEAR_GLUCOSE_PATH',
    value: '/t1arc/v1/glucose/current',
  },
  {
    category: 'phone glucose-history Wear path',
    file: DISPLAY_KOTLIN,
    name: 'WEAR_GLUCOSE_HISTORY_PATH',
    value: '/t1arc/v1/glucose/history',
  },
  {
    category: 'phone glucose-request Wear path',
    file: DISPLAY_KOTLIN,
    name: 'WEAR_GLUCOSE_REQUEST_PATH',
    value: '/t1arc/v1/glucose/request',
  },
  {
    category: 'watch current-glucose send path',
    file: 'wear/companion/src/main/java/io/github/gregorgregor25/t1arc/wear/data/T1ArcDataLayerSync.kt',
    name: 'GLUCOSE_PATH',
    value: '/t1arc/v1/glucose/current',
  },
  {
    category: 'watch glucose-history send path',
    file: 'wear/companion/src/main/java/io/github/gregorgregor25/t1arc/wear/data/T1ArcDataLayerSync.kt',
    name: 'GLUCOSE_HISTORY_PATH',
    value: '/t1arc/v1/glucose/history',
  },
  {
    category: 'watch glucose-request path',
    file: 'wear/companion/src/main/java/io/github/gregorgregor25/t1arc/wear/data/T1ArcDataLayerSync.kt',
    name: 'GLUCOSE_REQUEST_PATH',
    value: '/t1arc/v1/glucose/request',
  },
  {
    category: 'watch current-glucose receive path',
    file: 'wear/companion/src/main/java/io/github/gregorgregor25/t1arc/wear/data/T1ArcDataLayerService.kt',
    name: 'GLUCOSE_PATH',
    value: '/t1arc/v1/glucose/current',
  },
  {
    category: 'watch glucose-history receive path',
    file: 'wear/companion/src/main/java/io/github/gregorgregor25/t1arc/wear/data/T1ArcDataLayerService.kt',
    name: 'GLUCOSE_HISTORY_PATH',
    value: '/t1arc/v1/glucose/history',
  },
  {
    category: 'notification-capture token domain',
    file: 'modules/t1arc-notification-source/android/src/main/java/io/github/gregorgregor25/t1arc/notificationsource/NotificationCaptureProtocol.kt',
    name: 'CAPTURE_TOKEN_DOMAIN',
    value: 't1arc.notification.capture-token.v1',
  },
  {
    category: 'glucose-display headless reason extra',
    file: DISPLAY_KOTLIN,
    name: 'HEADLESS_REASON_EXTRA',
    value:
      'io.github.gregorgregor25.t1arc.glucosedisplay.HEADLESS_REASON',
  },
  {
    category: 'Android Auto media root',
    file: ANDROID_AUTO_KOTLIN,
    name: 'CAR_MEDIA_ROOT_ID',
    value: 't1arc_root',
  },
  {
    category: 'Android Auto glucose section',
    file: ANDROID_AUTO_KOTLIN,
    name: 'CAR_GLUCOSE_SECTION_ID',
    value: 't1arc_glucose',
  },
  {
    category: 'Android Auto current-glucose media item',
    file: ANDROID_AUTO_KOTLIN,
    name: 'CAR_GLUCOSE_MEDIA_ID',
    value: 't1arc_current_glucose',
  },
  {
    category: 'Android Auto notification person',
    file: ANDROID_AUTO_KOTLIN,
    name: 'CAR_NOTIFICATION_PERSON_KEY',
    value: 't1arc_glucose',
  },
  {
    category: 'Android Auto refresh action',
    file: ANDROID_AUTO_KOTLIN,
    name: 'CAR_NOTIFICATION_REPLY_ACTION',
    value: 'io.github.gregorgregor25.t1arc.action.REFRESH_CAR_GLUCOSE',
  },
  {
    category: 'Android Auto dismiss action',
    file: ANDROID_AUTO_KOTLIN,
    name: 'CAR_NOTIFICATION_DISMISS_ACTION',
    value: 'io.github.gregorgregor25.t1arc.action.DISMISS_CAR_GLUCOSE',
  },
  {
    category: 'Android Auto remote-input key',
    file: ANDROID_AUTO_KOTLIN,
    name: 'CAR_NOTIFICATION_REPLY_KEY',
    value: 't1arc_car_reply',
  },
  {
    category: 'Android Auto session-token extra',
    file: ANDROID_AUTO_KOTLIN,
    name: 'CAR_NOTIFICATION_SESSION_TOKEN_EXTRA',
    value: 't1arc_car_session_token',
  },
];

function ledgerStringBinding(
  group: ProtectedStringBindingGroup,
  contract: StringBindingContract,
): LedgerStringBinding {
  return {
    group,
    category: contract.category,
    file: contract.file,
    name: contract.name,
    value: contract.value,
  };
}

const TESTED_PROTECTED_STRING_BINDINGS: readonly LedgerStringBinding[] = [
  ...PERSISTED_BINDINGS.map((contract) =>
    ledgerStringBinding('persisted', contract),
  ),
  ...BACKGROUND_BINDINGS.map((contract) =>
    ledgerStringBinding('background', contract),
  ),
  ...RECORD_BINDINGS.map((contract) => ledgerStringBinding('record', contract)),
  ...NOTIFICATION_CHANNEL_BINDINGS.map((contract) =>
    ledgerStringBinding('notification-channel', contract),
  ),
  ...WIRE_BINDINGS.map((contract) => ledgerStringBinding('wire', contract)),
];

type ComponentContract = {
  fqcn: string;
  gradle: string;
  manifest: string;
  implementation: string;
};

const PERSISTENT_COMPONENTS: readonly ComponentContract[] = [
  {
    fqcn: 'io.github.gregorgregor25.t1arc.notificationsource.T1ArcNotificationListenerService',
    gradle: 'modules/t1arc-notification-source/android/build.gradle',
    manifest:
      'modules/t1arc-notification-source/android/src/main/AndroidManifest.xml',
    implementation:
      'modules/t1arc-notification-source/android/src/main/java/io/github/gregorgregor25/t1arc/notificationsource/T1ArcNotificationListenerService.kt',
  },
  {
    fqcn: 'io.github.gregorgregor25.t1arc.glucosedisplay.T1ArcAodAccessibilityService',
    gradle: 'modules/t1arc-glucose-display/android/build.gradle',
    manifest:
      'modules/t1arc-glucose-display/android/src/main/AndroidManifest.xml',
    implementation: DISPLAY_KOTLIN,
  },
  {
    fqcn: 'io.github.gregorgregor25.t1arc.glucosedisplay.T1ArcGlucoseWidgetProvider',
    gradle: 'modules/t1arc-glucose-display/android/build.gradle',
    manifest:
      'modules/t1arc-glucose-display/android/src/main/AndroidManifest.xml',
    implementation: DISPLAY_KOTLIN,
  },
  {
    fqcn: 'io.github.gregorgregor25.t1arc.glucosedisplay.T1ArcCarMediaBrowserService',
    gradle: 'modules/t1arc-glucose-display/android/build.gradle',
    manifest:
      'modules/t1arc-glucose-display/android/src/main/AndroidManifest.xml',
    implementation: ANDROID_AUTO_KOTLIN,
  },
  {
    fqcn: 'io.github.gregorgregor25.t1arc.glucosedisplay.T1ArcCarNotificationReceiver',
    gradle: 'modules/t1arc-glucose-display/android/build.gradle',
    manifest:
      'modules/t1arc-glucose-display/android/src/main/AndroidManifest.xml',
    implementation: ANDROID_AUTO_KOTLIN,
  },
  {
    fqcn: 'io.github.gregorgregor25.t1arc.wear.MainActivity',
    gradle: 'wear/companion/build.gradle',
    manifest: 'wear/companion/src/main/AndroidManifest.xml',
    implementation: 'wear/companion/src/main/java/io/github/gregorgregor25/t1arc/wear/MainActivity.kt',
  },
  {
    fqcn: 'io.github.gregorgregor25.t1arc.wear.GraphActivity',
    gradle: 'wear/companion/build.gradle',
    manifest: 'wear/companion/src/main/AndroidManifest.xml',
    implementation: 'wear/companion/src/main/java/io/github/gregorgregor25/t1arc/wear/GraphActivity.kt',
  },
  {
    fqcn: 'io.github.gregorgregor25.t1arc.wear.complication.T1ArcGlucoseComplicationService',
    gradle: 'wear/companion/build.gradle',
    manifest: 'wear/companion/src/main/AndroidManifest.xml',
    implementation:
      'wear/companion/src/main/java/io/github/gregorgregor25/t1arc/wear/complication/T1ArcGlucoseComplicationService.kt',
  },
  {
    fqcn: 'io.github.gregorgregor25.t1arc.wear.complication.T1ArcOpticalGlucoseComplicationService',
    gradle: 'wear/companion/build.gradle',
    manifest: 'wear/companion/src/main/AndroidManifest.xml',
    implementation:
      'wear/companion/src/main/java/io/github/gregorgregor25/t1arc/wear/complication/T1ArcGlucoseComplicationService.kt',
  },
  {
    fqcn: 'io.github.gregorgregor25.t1arc.wear.complication.T1ArcFreshnessComplicationService',
    gradle: 'wear/companion/build.gradle',
    manifest: 'wear/companion/src/main/AndroidManifest.xml',
    implementation:
      'wear/companion/src/main/java/io/github/gregorgregor25/t1arc/wear/complication/T1ArcFreshnessComplicationService.kt',
  },
  ...[
    'T1ArcGraphComplicationService',
    'T1ArcChronographGraphComplicationService',
    'T1ArcOrbitGraphComplicationService',
  ].map((className) => ({
    fqcn: `io.github.gregorgregor25.t1arc.wear.complication.${className}`,
    gradle: 'wear/companion/build.gradle',
    manifest: 'wear/companion/src/main/AndroidManifest.xml',
    implementation:
      'wear/companion/src/main/java/io/github/gregorgregor25/t1arc/wear/complication/T1ArcGraphComplicationService.kt',
  })),
  {
    fqcn: 'io.github.gregorgregor25.t1arc.wear.tile.T1ArcGlucoseTileService',
    gradle: 'wear/companion/build.gradle',
    manifest: 'wear/companion/src/main/AndroidManifest.xml',
    implementation:
      'wear/companion/src/main/java/io/github/gregorgregor25/t1arc/wear/tile/T1ArcGlucoseTileService.kt',
  },
];

function gradleNamespace(relativePath: string) {
  const match = withoutComments(source(relativePath)).match(
    /^\s*namespace\s+['"]([^'"]+)['"]\s*$/m,
  );
  expect(match, `${relativePath} must declare an Android namespace`).not.toBeNull();
  return match![1]!;
}

function manifestComponentNames(relativePath: string) {
  return [
    ...xmlSource(relativePath).matchAll(
      /<(?:activity|activity-alias|service|receiver)\b[^>]*\bandroid:name="([^"]+)"/g,
    ),
  ].map((match) => match[1]!);
}

function resolveComponentName(name: string, namespace: string) {
  if (name.startsWith('.')) return `${namespace}${name}`;
  if (name.includes('.')) return name;
  return `${namespace}.${name}`;
}

function expectLegacyWrapper(contract: ComponentContract) {
  const resolvedNames = manifestComponentNames(contract.manifest).map((name) =>
    resolveComponentName(name, gradleNamespace(contract.gradle)),
  );
  expect(
    resolvedNames,
    `${contract.fqcn} must remain a resolved manifest component`,
  ).toContain(contract.fqcn);

  const separator = contract.fqcn.lastIndexOf('.');
  const packageName = contract.fqcn.slice(0, separator);
  const className = contract.fqcn.slice(separator + 1);
  const implementation = withoutComments(source(contract.implementation));
  expect(implementation).toMatch(
    new RegExp(`^\\s*package\\s+${escapeRegExp(packageName)}\\s*$`, 'm'),
  );
  expect(implementation).toMatch(
    new RegExp(`^\\s*(?:open\\s+)?class\\s+${className}\\b`, 'm'),
  );
}

const WATCH_FACE_PROVIDERS = [
  {
    file: 'wear/watchface-meridian/src/main/res/raw/watchface.xml',
    providers: [
      'io.github.gregorgregor25.t1arc/io.github.gregorgregor25.t1arc.wear.complication.T1ArcGlucoseComplicationService',
      'io.github.gregorgregor25.t1arc/io.github.gregorgregor25.t1arc.wear.complication.T1ArcGraphComplicationService',
    ],
  },
  {
    file: 'wear/watchface-chronograph/src/main/res/raw/watchface.xml',
    providers: [
      'io.github.gregorgregor25.t1arc/io.github.gregorgregor25.t1arc.wear.complication.T1ArcChronographGraphComplicationService',
      'io.github.gregorgregor25.t1arc/io.github.gregorgregor25.t1arc.wear.complication.T1ArcOpticalGlucoseComplicationService',
    ],
  },
  {
    file: 'wear/watchface-orbit/src/main/res/raw/watchface.xml',
    providers: [
      'io.github.gregorgregor25.t1arc/io.github.gregorgregor25.t1arc.wear.complication.T1ArcFreshnessComplicationService',
      'io.github.gregorgregor25.t1arc/io.github.gregorgregor25.t1arc.wear.complication.T1ArcOpticalGlucoseComplicationService',
      'io.github.gregorgregor25.t1arc/io.github.gregorgregor25.t1arc.wear.complication.T1ArcOrbitGraphComplicationService',
    ],
  },
] as const;

describe('T1 Arc runtime technical identity', () => {
  it('keeps the machine-readable compatibility ledger well formed', () => {
    expect(RUNTIME_IDENTIFIER_LEDGER.schemaVersion).toBe(2);
    expect(RUNTIME_IDENTIFIER_LEDGER.productName).toBe('T1 Arc');

    for (const entries of [
      RUNTIME_IDENTIFIER_LEDGER.applicationIds,
      RUNTIME_IDENTIFIER_LEDGER.storageContracts,
      RUNTIME_IDENTIFIER_LEDGER.nativeBridges,
      RUNTIME_IDENTIFIER_LEDGER.backupContracts,
    ]) {
      const ids = entries.map(({ id }) => id);
      expect(new Set(ids).size).toBe(ids.length);
    }

    const bindingKeys = RUNTIME_IDENTIFIER_LEDGER.protectedStringBindings.map(
      ({ group, file, name }) => `${group}:${file}:${name}`,
    );
    expect(new Set(bindingKeys).size).toBe(bindingKeys.length);
    expect(RUNTIME_IDENTIFIER_LEDGER.protectedStringBindings).toEqual(
      TESTED_PROTECTED_STRING_BINDINGS,
    );
  });

  it.each(RUNTIME_IDENTIFIER_LEDGER.nativeBridges)(
    'preserves native bridge $value on both sides of the Expo boundary',
    ({ value, nativeFile, typescriptFile }) => {
      const escaped = escapeRegExp(value);
      expect(withoutComments(source(nativeFile))).toMatch(
        new RegExp(`\\bName\\(\\s*["']${escaped}["']\\s*\\)`),
      );
      expect(withoutComments(source(typescriptFile))).toMatch(
        new RegExp(
          `requireNativeModule<[\\s\\S]*?>\\([\\s\\S]*?["']${escaped}["']`,
        ),
      );
    },
  );

  it('keeps migration encryption and file hashing on the native backup bridge', () => {
    const nativeFile =
      'modules/t1arc-backup-crypto/android/src/main/java/io/github/gregorgregor25/t1arc/backup/T1ArcBackupCryptoModule.kt';
    const nativeBackup = withoutComments(source(nativeFile));
    const typescriptBackup = withoutComments(
      source('modules/t1arc-backup-crypto/src/T1ArcBackupCryptoModule.ts'),
    );
    for (const method of [
      'encryptMigrationFileAsync',
      'decryptMigrationFileAsync',
      'sha256FileAsync',
    ]) {
      expect(nativeBackup).toMatch(
        new RegExp(`AsyncFunction\\(\\s*["']${method}["']\\s*\\)`),
      );
      expect(typescriptBackup).toMatch(new RegExp(`\\b${method}\\s*\\(`));
    }
    expect(nativeBackup).toMatch(
      /decryptFile\(encryptedUri,\s*passphrase,\s*EncryptedDocumentKind\.MIGRATION\)/,
    );
    expect(nativeBackup).toMatch(/MessageDigest\.getInstance\(["']SHA-256["']\)/);
    expect(
      withoutComments(
        source('modules/t1arc-backup-crypto/src/T1ArcBackupCrypto.types.ts'),
      ),
    ).toMatch(/plaintextSha256:\s*string/);
  });

  it('preserves distinct encrypted backup and migration container magics', () => {
    const backupMagic = ledgerValue(
      RUNTIME_IDENTIFIER_LEDGER.backupContracts,
      'encrypted-container-magic',
    );
    const migrationMagic = ledgerValue(
      RUNTIME_IDENTIFIER_LEDGER.backupContracts,
      'migration-encrypted-container-magic',
    );
    const fingerprintMagic = ledgerValue(
      RUNTIME_IDENTIFIER_LEDGER.backupContracts,
      'migration-record-fingerprint-magic',
    );
    const backupModule = withoutComments(
      source(
        'modules/t1arc-backup-crypto/android/src/main/java/io/github/gregorgregor25/t1arc/backup/T1ArcBackupCryptoModule.kt',
      ),
    );
    expect(backupModule).toMatch(
      new RegExp(
        `\\bBACKUP\\(\\s*["']${escapeRegExp(backupMagic)}["']\\s*,\\s*ENCRYPTED_BACKUP_EXTENSION`,
      ),
    );
    expect(backupModule).toMatch(
      new RegExp(
        `\\bMIGRATION\\(\\s*["']${escapeRegExp(migrationMagic)}["']\\s*,\\s*ENCRYPTED_MIGRATION_EXTENSION`,
      ),
    );
    expect(
      withoutComments(source('src/data/backup/healthBackup.ts')),
    ).toMatch(
      new RegExp(
        `RECORD_FINGERPRINT_MAGIC_TEXT\\s*=\\s*["']${escapeRegExp(fingerprintMagic)}["']`,
      ),
    );
  });

  it.each(RUNTIME_IDENTIFIER_LEDGER.persistentAndroidComponents)(
    'preserves ledgered Android component $fqcn',
    expectLegacyWrapper,
  );

  it('preserves installed phone and watch-face application IDs', () => {
    const appConfig = JSON.parse(source('app.json')) as {
      expo: { android: { package: string } };
    };
    expect(appConfig.expo.android.package).toBe(
      ledgerValue(
        RUNTIME_IDENTIFIER_LEDGER.applicationIds,
        'phone-and-companion',
      ),
    );

    const gradleBindings = new Map([
      ['wear-companion', 'applicationId t1ArcWearCompanionApplicationId'],
      [
        'watchface-meridian',
        "applicationId t1ArcWatchFaceApplicationId('meridian')",
      ],
      [
        'watchface-chronograph',
        "applicationId t1ArcWatchFaceApplicationId('chronograph')",
      ],
      [
        'watchface-orbit',
        "applicationId t1ArcWatchFaceApplicationId('orbit')",
      ],
    ]);
    for (const contract of RUNTIME_IDENTIFIER_LEDGER.applicationIds.filter(
      ({ file }) => file !== 'app.json',
    )) {
      const binding = gradleBindings.get(contract.id);
      expect(binding).toBeDefined();
      expect(withoutComments(source(contract.file))).toContain(binding!);
    }
  });

  it('uses only canonical T1 Arc links', () => {
    const appConfig = JSON.parse(source('app.json')) as {
      expo: { scheme: string | string[] };
    };
    const schemes = Array.isArray(appConfig.expo.scheme)
      ? appConfig.expo.scheme
      : [appConfig.expo.scheme];
    expect(schemes).toEqual(['t1arc']);

    const appLinks = withoutComments(source('src/navigation/appLinks.ts'));
    expect(appLinks).toMatch(
      /^\s*export const APP_LINK_PREFIXES:\s*string\[\]\s*=\s*\[\s*['"]t1arc:\/\/['"]\s*\]\s*;?\s*$/m,
    );
    expect(appLinks).toMatch(
      /return\s+\/\^t1arc:\\\/\\\/sources\\\/glooko[\s\S]*?\.test\(url\)/,
    );
    expect(withoutComments(source('src/navigation/AppNavigator.tsx'))).toMatch(
      /prefixes:\s*APP_LINK_PREFIXES\b/,
    );

    const shortcuts = withoutComments(source('plugins/with-t1arc-shortcuts.js'));
    expect(shortcuts).toMatch(/android:data="t1arc:\/\/today\/log-food"/);
    expect(shortcuts).toMatch(/android:data="t1arc:\/\/today\/log-context"/);
    expect(shortcuts).toMatch(
      /android:targetPackage="@string\/t1arc_application_id"/,
    );
    expect(shortcuts).toMatch(
      /android:targetClass="\$\{androidConfig\.android\?\.package\}\.MainActivity"/,
    );
    const glookoPlugin = withoutComments(
      source('plugins/with-glooko-report-inbox.js'),
    );
    expect(glookoPlugin).toMatch(
      /Uri\.parse\("t1arc:\/\/sources\/glooko\?shared-report=1"\)/,
    );
  });

  it.each(PERSISTED_BINDINGS)('preserves $category', expectActiveStringBinding);
  it.each(BACKGROUND_BINDINGS)('preserves $category', expectActiveStringBinding);
  it.each(RECORD_BINDINGS)('preserves $category', expectActiveStringBinding);
  it.each(NOTIFICATION_CHANNEL_BINDINGS)(
    'preserves $category',
    expectActiveStringBinding,
  );
  it.each(WIRE_BINDINGS)('preserves $category', expectActiveStringBinding);

  it.each(PERSISTENT_COMPONENTS)(
    'preserves resolved OS component $fqcn',
    expectLegacyWrapper,
  );

  it('keeps duplicated persisted source consumers on canonical IDs', () => {
    expect(
      withoutComments(source('src/data/libreLinkUp/LibreLinkUpClient.ts')),
    ).toMatch(/sourceId\s*=\s*['"]t1arc-librelinkup['"]/);
    expect(
      withoutComments(source('src/data/food/foodLogContextBackfill.ts')),
    ).toMatch(/AND\s+source_id\s*=\s*['"]t1arc-food['"]/);
    expect(
      withoutComments(source('src/data/persistence/SqliteHealthRecordStore.ts')),
    ).toMatch(/row\.source_id\s*===\s*['"]t1arc-food['"]/);
  });

  it('keeps Android Auto PendingIntent data identities active', () => {
    const androidAuto = withoutComments(source(ANDROID_AUTO_KOTLIN));
    expect(androidAuto).toMatch(
      /\.setData\(\s*Uri\.parse\("t1arc:\/\/android-auto\/\$sessionToken\/refresh"\)\s*\)/,
    );
    expect(androidAuto).toMatch(
      /\.setData\(\s*Uri\.parse\("t1arc:\/\/android-auto\/\$sessionToken\/dismiss"\)\s*\)/,
    );
  });

  it('uses one T1 Arc backup document identity', () => {
    const bindings: readonly StringBindingContract[] = [
      {
        category: 'backup document format',
        file: 'src/data/backup/healthBackup.ts',
        name: 'HEALTH_BACKUP_FORMAT',
        value: 't1arc-health-backup',
      },
      {
        category: 'new backup MIME type',
        file: 'src/data/backup/healthBackup.ts',
        name: 'HEALTH_BACKUP_MIME',
        value: ledgerValue(
          RUNTIME_IDENTIFIER_LEDGER.backupContracts,
          'current-mime',
        ),
        references: [
          {
            file: 'src/components/EncryptedBackupCard.tsx',
            pattern: /type:\s*\[[\s\S]*?\bHEALTH_BACKUP_MIME\b/,
          },
        ],
      },
      {
        category: 'new backup extension',
        file: 'src/data/backup/healthBackup.ts',
        name: 'HEALTH_BACKUP_EXTENSION',
        value: '.t1arc',
      },
    ];
    bindings.forEach(expectActiveStringBinding);

    expect(withoutComments(source('src/data/backup/healthBackup.ts'))).toMatch(
      /return\s+`T1-Arc-health-\$\{part\(['"]year['"]\)\}[\s\S]*?\$\{HEALTH_BACKUP_EXTENSION\}`/,
    );

    const card = withoutComments(source('src/components/EncryptedBackupCard.tsx'));
    const pickerBlock = card.slice(
      card.indexOf('DocumentPicker.getDocumentAsync({'),
      card.indexOf('if (result.canceled)'),
    );
    expect(pickerBlock).toMatch(
      /type:\s*\[[\s\S]*?HEALTH_BACKUP_MIME[\s\S]*?["']\*\/\*["'][\s\S]*?\]/,
    );
    expect(pickerBlock).not.toMatch(/endsWith\(|extension|suffix/i);

    const nativeBackup = withoutComments(
      source(
        'modules/t1arc-backup-crypto/android/src/main/java/io/github/gregorgregor25/t1arc/backup/T1ArcBackupCryptoModule.kt',
      ),
    );
    const decryptFunction = nativeBackup.slice(
      nativeBackup.indexOf('private fun decryptFile('),
      nativeBackup.indexOf('private fun buildHeader('),
    );
    expect(decryptFunction).toMatch(/openInput\(context,\s*encryptedUri\)/);
    expect(decryptFunction).not.toMatch(/endsWith\(|extension|suffix/i);
    expect(nativeBackup).toMatch(
      /AsyncFunction\(["']encryptJsonFileAsync["']\)[\s\S]*?encryptFile\(plaintextUri,\s*passphrase,\s*EncryptedDocumentKind\.BACKUP\)/,
    );
    expect(nativeBackup).toMatch(
      /val\s+output\s*=\s*newTemporaryFile\(context,\s*kind\.extension\)/,
    );
  });

  it('keeps Wear paths active in manifests and capability on both peers', () => {
    const phoneManifest = xmlSource(
      'modules/t1arc-glucose-display/android/src/main/AndroidManifest.xml',
    );
    expect(phoneManifest).toMatch(
      /android:pathPrefix="\/t1arc\/v1\/glucose\/request"/,
    );

    const watchManifest = xmlSource(
      'wear/companion/src/main/AndroidManifest.xml',
    );
    const manifestPaths = [
      ...watchManifest.matchAll(/android:pathPrefix="([^"]+)"/g),
    ].map((match) => match[1]);
    expect(manifestPaths).toEqual([
      '/t1arc/v1/glucose/current',
      '/t1arc/v1/glucose/history',
      '/t1arc/v1/glucose/current',
      '/t1arc/v1/glucose/history',
    ]);

    const capabilities = xmlSource(
      'wear/companion/src/main/res/values/wear_capabilities.xml',
    );
    expect(capabilities).toMatch(
      /<item>\s*t1arc_glucose_companion_v1\s*<\/item>/,
    );
    expect(withoutComments(source(DISPLAY_KOTLIN))).toMatch(
      /getCapability\(\s*WEAR_CAPABILITY\s*,\s*CapabilityClient\.FILTER_REACHABLE\s*,?\s*\)/,
    );
  });

  it.each(WATCH_FACE_PROVIDERS)(
    'preserves every primary provider in $file',
    ({ file, providers }) => {
      const actual = [
        ...xmlSource(file).matchAll(/primaryProvider="([^"]+)"/g),
      ]
        .map((match) => match[1]!)
        .sort();
      expect(actual).toEqual([...providers].sort());
    },
  );

  it('keeps phone launcher and settings targets source-generated', () => {
    const accessibility = xmlSource(
      'modules/t1arc-glucose-display/android/src/main/res/xml/t1arc_aod_accessibility_service.xml',
    );
    expect(accessibility).toMatch(
      /android:settingsActivity="io\.github\.gregorgregor25\.t1arc\.MainActivity"/,
    );
    const appConfig = JSON.parse(source('app.json')) as {
      expo: { plugins: (string | [string, object])[] };
    };
    const pluginNames = appConfig.expo.plugins.map((plugin) =>
      Array.isArray(plugin) ? plugin[0] : plugin,
    );
    expect(pluginNames).toEqual(
      expect.arrayContaining([
        './plugins/with-glooko-report-inbox',
        './plugins/with-t1arc-shortcuts',
        './plugins/with-t1arc-wear',
      ]),
    );
  });
});
