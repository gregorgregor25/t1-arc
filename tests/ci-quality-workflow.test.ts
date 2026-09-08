import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  new URL('../.github/workflows/quality.yml', import.meta.url),
  'utf8',
);
const packageConfig = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  license: string;
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};
const qualityStart = workflow.indexOf('  quality:');
const archivedNodeServicesStart = workflow.indexOf('  archived-node-services:');
const qualityJob = workflow.slice(qualityStart, archivedNodeServicesStart);
const archivedNodeServicesJob = workflow.slice(archivedNodeServicesStart);
const qualityHeader = qualityJob.slice(0, qualityJob.indexOf('    steps:'));
const resourceStepStart = qualityJob.indexOf(
  '      - name: Link generated Android resources',
);
const resourceStepEnd = qualityJob.indexOf('\n      - ', resourceStepStart + 1);
const resourceStep = qualityJob.slice(resourceStepStart, resourceStepEnd);
const nativeChecksStepStart = qualityJob.indexOf(
  '      - name: Test and lint native Android modules',
);
const nativeChecksStepEnd = qualityJob.indexOf(
  '\n      - ',
  nativeChecksStepStart + 1,
);
const nativeChecksStep = qualityJob.slice(
  nativeChecksStepStart,
  nativeChecksStepEnd,
);

const root = fileURLToPath(new URL('..', import.meta.url));

function gradleProjectDirectories(
  parent: string,
  buildFile: (name: string) => string,
  projectName: (name: string) => string = (name) => name,
  include: (name: string) => boolean = () => true,
) {
  return readdirSync(parent, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(buildFile(entry.name)) &&
        include(entry.name),
    )
    .map((entry) => projectName(entry.name));
}

const firstPartyAndroidProjects = [
  'app',
  ...gradleProjectDirectories(
    join(root, 'modules'),
    (name) => join(root, 'modules', name, 'android', 'build.gradle'),
    (name) => name,
    (name) => {
      const moduleConfig = JSON.parse(
        readFileSync(
          join(root, 'modules', name, 'expo-module.config.json'),
          'utf8',
        ),
      ) as { platforms?: string[] };
      return moduleConfig.platforms?.includes('android') === true;
    },
  ),
  ...gradleProjectDirectories(
    join(root, 'wear'),
    (name) => join(root, 'wear', name, 'build.gradle'),
    (name) => (name === 'companion' ? 'wear' : name),
    (name) => name !== 'watchface-orbit',
  ),
].sort();

function exactNativeCheckTasks() {
  return [...nativeChecksStep.matchAll(
    /^[ \t]+:([a-z0-9-]+):(test(?:Meridian|Chronograph|Atelier|Pace|Summit)?DebugUnitTest|lint(?:Meridian|Chronograph|Atelier|Pace|Summit)?Release)[ \t]+\\\r?$/gm,
  )].map((match) => `${match[1]}:${match[2]}`);
}

function exactResourceTasks() {
  return [...resourceStep.matchAll(
    /^[ \t]+:(app):(process(?:Debug|DebugOptimized|Release)Resources)[ \t]+\\\r?$/gm,
  )].map((match) => `${match[1]}:${match[2]}`);
}

describe('pull-request Android quality workflow', () => {
  it('uses the Expo ESLint stack with a non-increasing warning baseline', () => {
    expect(packageConfig.devDependencies.eslint).toBeDefined();
    expect(packageConfig.devDependencies['eslint-config-expo']).toMatch(/^~57\./);
    expect(packageConfig.scripts.lint).not.toContain('--quiet');
    expect(packageConfig.scripts.lint).toContain('--max-warnings 0');
    expect(packageConfig.scripts.quality).toMatch(/^npm run lint &&/);
  });

  it('declares the project licence and exposes the public-source gate', () => {
    expect(packageConfig.license).toBe('MIT');
    expect(packageConfig.scripts['verify:public-source']).toBe(
      'node scripts/check-public-repository.mjs && node scripts/check-source-reachability.mjs',
    );

    const installIndex = qualityJob.indexOf('- run: npm ci');
    const publicSourceIndex = qualityJob.indexOf(
      'run: npm run verify:public-source',
    );
    const prebuildIndex = qualityJob.indexOf(
      'run: npx expo prebuild --platform android --clean --no-install',
    );
    expect(publicSourceIndex).toBeGreaterThan(installIndex);
    expect(prebuildIndex).toBeGreaterThan(publicSourceIndex);
  });

  it('accepts tracked first-party native source while rejecting artifacts by policy', () => {
    const output = execFileSync(
      process.execPath,
      [join(root, 'scripts', 'check-public-repository.mjs')],
      { cwd: root, encoding: 'utf8' },
    );

    expect(output).toContain('Public-repository check passed:');
    expect(firstPartyAndroidProjects).toContain('t1arc-backup-crypto');
    expect(firstPartyAndroidProjects).toContain('t1arc-food-label');
    expect(firstPartyAndroidProjects).toContain('t1arc-glucose-display');
  });

  it('keeps the quality job eligible for pull requests', () => {
    expect(workflow).toContain('  pull_request:');
    expect(qualityHeader).not.toMatch(/^\s+if:/m);
    expect(qualityHeader).toContain('timeout-minutes: 45');
  });

  it('checks Expo dependency parity before generating Android', () => {
    const installIndex = qualityJob.indexOf('- run: npm ci');
    const parityIndex = qualityJob.indexOf('run: npx expo install --check');
    const doctorIndex = qualityJob.indexOf(
      'run: npx --no-install expo-doctor',
    );
    const prebuildIndex = qualityJob.indexOf(
      'run: npx expo prebuild --platform android --clean --no-install',
    );

    expect(installIndex).toBeGreaterThanOrEqual(0);
    expect(parityIndex).toBeGreaterThan(installIndex);
    expect(doctorIndex).toBeGreaterThan(parityIndex);
    expect(prebuildIndex).toBeGreaterThan(doctorIndex);
    expect(packageConfig.devDependencies['expo-doctor']).toBe('1.20.4');
  });

  it('runs contributor lint and a high-severity production dependency audit', () => {
    const installIndex = qualityJob.indexOf('- run: npm ci');
    const auditIndex = qualityJob.indexOf(
      'run: npm audit --omit=dev --audit-level=high',
    );
    const lintIndex = qualityJob.indexOf('- run: npm run lint');
    const typecheckIndex = qualityJob.indexOf('- run: npm run typecheck');

    expect(auditIndex).toBeGreaterThan(installIndex);
    expect(lintIndex).toBeGreaterThan(installIndex);
    expect(typecheckIndex).toBeGreaterThan(lintIndex);
  });

  it('pins every workflow action to an immutable commit', () => {
    const actions = [...workflow.matchAll(/\buses:\s+([^@\s]+)@([^\s#]+)/g)];
    expect(actions.length).toBeGreaterThan(0);
    for (const [, name, revision] of actions) {
      expect(name).toMatch(/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i);
      expect(revision).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it('never publishes APKs and scopes ephemeral face signing to native checks', () => {
    expect(workflow).not.toContain('private-android-release');
    expect(nativeChecksStep).toContain("T1ARC_PRIVATE_TEST_BUILD: '1'");
    expect(nativeChecksStep).toContain('t1arc-ci-faces.p12');
    expect(qualityJob.replace(nativeChecksStep, '')).not.toContain('T1ARC_PRIVATE_TEST_BUILD');
    expect(workflow).not.toContain('secrets.T1ARC_RELEASE');
    expect(workflow).not.toContain('actions/upload-artifact');
    expect(workflow).not.toContain(':app:assembleRelease');
  });

  it('checks both archived Node services and every Expo prebuild plugin', () => {
    expect(archivedNodeServicesStart).toBeGreaterThan(qualityStart);
    expect(archivedNodeServicesJob).toContain('node-version: 24');
    expect(archivedNodeServicesJob).toContain(
      'cache-dependency-path: services/tarvis-enrollment/package-lock.json',
    );

    for (const service of ['services/tarvis-lab', 'services/tarvis-enrollment']) {
      expect(archivedNodeServicesJob).toContain(`working-directory: ${service}`);
    }

    expect(archivedNodeServicesJob).toContain('run: npm ci');
    expect(archivedNodeServicesJob).toContain('run: npm test');
    expect(archivedNodeServicesJob).toContain('run: npm run check');
    expect(archivedNodeServicesJob).toContain(
      'run: npm audit --omit=dev --audit-level=high',
    );
    expect(archivedNodeServicesJob).toContain(
      'for plugin in plugins/*.js; do',
    );
    expect(archivedNodeServicesJob).toContain('node --check "$plugin"');
  });

  it('links generated debug and release resources during pull-request CI', () => {
    const prebuildIndex = qualityJob.indexOf(
      'run: npx expo prebuild --platform android --clean --no-install',
    );
    const resourceStepIndex = qualityJob.indexOf(
      '- name: Link generated Android resources',
    );

    expect(resourceStepIndex).toBeGreaterThan(prebuildIndex);
    expect(resourceStepEnd).toBeGreaterThan(resourceStepStart);
    expect(exactResourceTasks().sort()).toEqual([
      'app:processDebugOptimizedResources',
      'app:processDebugResources',
      'app:processReleaseResources',
    ]);
  });

  it('tests and lints every active first-party native Android module during pull-request CI', () => {
    expect(nativeChecksStepStart).toBeGreaterThan(resourceStepStart);
    expect(nativeChecksStepEnd).toBeGreaterThan(nativeChecksStepStart);
    expect(nativeChecksStep).toContain('working-directory: android');
    expect(nativeChecksStep).toContain('./gradlew');
    expect(nativeChecksStep).toContain('--no-daemon');

    const expectedTasks = firstPartyAndroidProjects.flatMap((project) =>
      project === 'watchface-push' ? [
        `${project}:testMeridianDebugUnitTest`,
        `${project}:testChronographDebugUnitTest`,
        `${project}:testAtelierDebugUnitTest`,
        `${project}:testPaceDebugUnitTest`,
        `${project}:testSummitDebugUnitTest`,
        `${project}:lintMeridianRelease`,
        `${project}:lintChronographRelease`,
        `${project}:lintAtelierRelease`,
        `${project}:lintPaceRelease`,
        `${project}:lintSummitRelease`,
      ] : [
        `${project}:testDebugUnitTest`,
        `${project}:lintRelease`,
      ],
    ).sort();

    expect(firstPartyAndroidProjects).not.toContain('t1arc-tarvis-direct');
    expect(exactNativeCheckTasks().sort()).toEqual(expectedTasks);
  });

  it('does not retain narrower duplicate native-check steps', () => {
    expect(qualityJob).not.toContain('name: Test native Glooko connector');
    expect(qualityJob).not.toContain('name: Lint native Glooko connector');
  });
});
