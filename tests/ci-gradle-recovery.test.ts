import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const script = join(root, 'scripts', 'ci-guarded-android-bundle.sh');
const bash = process.platform === 'win32'
  ? 'C:/Program Files/Git/bin/bash.exe'
  : '/bin/bash';
const scratch: string[] = [];

const classpathError = "Could not resolve all artifacts for configuration 'classpath'.";
const includedBuildFailure = [
  "Error resolving plugin [id: 'com.facebook.react.settings']",
  classpathError,
  '> Could not find org.jetbrains.kotlin:kotlin-stdlib:2.2.21.',
  '  - https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/2.2.21/kotlin-stdlib-2.2.21.pom',
].join('\n');
const portalFailure = [
  classpathError,
  '> Could not find com.squareup:javapoet:1.13.0.',
  '  Searched in the following locations:',
  '    - https://plugins.gradle.org/m2/com/squareup/javapoet/1.13.0/javapoet-1.13.0.pom',
  '  Required by:',
  "      settings file 'settings.gradle' > project :gradle-plugin:settings-plugin",
].join('\n');
const expoPortalFailure = [
  classpathError,
  '> Could not find org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3.',
  '  Searched in the following locations:',
  '    - https://plugins.gradle.org/m2/org/jetbrains/kotlinx/kotlinx-serialization-json/1.6.3/kotlinx-serialization-json-1.6.3.pom',
  '  Required by:',
  "      settings file 'settings.gradle' > project :expo-gradle-plugin:expo-autolinking-settings-plugin > project :expo-gradle-plugin:expo-autolinking-plugin-shared",
].join('\n');
const expoBuildPluginFailure = [
  "A problem occurred configuring project ':expo-module-gradle-plugin'.",
  "> Could not resolve all dependencies for configuration 'classpath'.",
  '   > Could not resolve org.jetbrains.kotlin:kotlin-gradle-plugin:2.1.20.',
  '     Required by:',
  "         buildscript of project ':expo-module-gradle-plugin' > org.jetbrains.kotlin.jvm:org.jetbrains.kotlin.jvm.gradle.plugin:2.1.20",
  '         > Could not parse POM https://plugins.gradle.org/m2/org/jetbrains/kotlin/kotlin-gradle-plugin/2.1.20/kotlin-gradle-plugin-2.1.20.pom',
  '            > Could not find org.jetbrains.kotlin:kotlin-gradle-plugins-bom:2.1.20.',
  '              Searched in the following locations:',
  '                - https://plugins.gradle.org/m2/org/jetbrains/kotlin/kotlin-gradle-plugins-bom/2.1.20/kotlin-gradle-plugins-bom-2.1.20.pom',
].join('\n');

function bashPath(path: string) {
  return process.platform === 'win32'
    ? path.replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`).replaceAll('\\', '/')
    : path;
}

function runBundle(mode: string, failure = includedBuildFailure) {
  const directory = mkdtempSync(join(tmpdir(), 't1arc-gradle-retry-'));
  scratch.push(directory);
  if (mode === 'log-failure' || mode === 'log-and-gradle-failure') {
    mkdirSync(join(directory, 't1arc-guarded-bundle.log'));
  }
  writeFileSync(join(directory, 'gradlew'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const directory = process.env.T1ARC_FIXTURE_DIRECTORY;
const calls = path.join(directory, 'calls.jsonl');
const previous = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\\n').length : 0;
const mode = process.env.T1ARC_FIXTURE_MODE;
fs.appendFileSync(calls, JSON.stringify({
  args: process.argv.slice(2),
  stage: process.env.T1ARC_EXPOSURE_STAGE,
  nodeEnv: process.env.NODE_ENV,
  mirror: fs.existsSync(path.join(directory, 'gradle-home', 'init.d', 't1arc-ci-central-mirror.init.gradle')),
}) + '\\n');
if (mode === 'success' || mode === 'log-failure' || (previous === 1 && mode === 'recover')) process.exit(0);
if (previous === 1) process.exit(51);
console.error(process.env.T1ARC_FIXTURE_FAILURE);
process.exit(42);
`, { mode: 0o755 });
  const result = spawnSync(bash, [bashPath(script)], {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_WORKSPACE: bashPath(root),
      GITHUB_ENV: bashPath(join(directory, 'github-env')),
      RUNNER_TEMP: bashPath(directory),
      GRADLE_USER_HOME: bashPath(join(directory, 'gradle-home')),
      NODE_ENV: 'production',
      T1ARC_EXPOSURE_STAGE: 'bundle',
      T1ARC_FIXTURE_DIRECTORY: directory,
      T1ARC_FIXTURE_MODE: mode,
      T1ARC_FIXTURE_FAILURE: failure,
    },
  });
  expect(result.error).toBeUndefined();
  const calls = readFileSync(join(directory, 'calls.jsonl'), 'utf8').trim()
    .split('\n').map((line) => JSON.parse(line) as {
      args: string[]; stage: string; nodeEnv: string; mirror: boolean;
    });
  return { result, calls, directory };
}

afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe.skipIf(!existsSync(bash))('guarded Android dependency recovery', () => {
  it('runs a successful bundle once without enabling a mirror', () => {
    const { result, calls, directory } = runBundle('success');
    expect(result.status).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls.map((call) => call.mirror)).toEqual([false]);
    expect(existsSync(join(directory, 'github-env'))).toBe(false);
  });

  it.each([
    ['React Native included build', includedBuildFailure],
    ['React Native root settings plugin', portalFailure],
    ['Expo root settings plugin', expoPortalFailure],
    ['Expo module build plugin', expoBuildPluginFailure],
  ])('retries a known missing dependency for the %s once with identical guarded arguments', (_, failure) => {
    const { result, calls, directory } = runBundle('recover', failure);
    expect(result.status).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.mirror)).toEqual([false, true]);
    for (const call of calls) {
      expect(call.args).toEqual([':app:createBundleReleaseJsAndAssets', '--no-build-cache', '--no-daemon']);
      expect(call.stage).toBe('bundle');
      expect(call.nodeEnv).toBe('production');
    }
    expect(readFileSync(join(directory, 'github-env'), 'utf8')).toBe(
      'T1ARC_CI_CENTRAL_MIRROR_ENABLED=1\n',
    );
  });

  it.each([
    ['unrelated compile error', 'Execution failed for task :app:compileReleaseKotlin.'],
    ['other Central repository', includedBuildFailure.replace('repo.maven.apache.org', 'repo.example.test')],
    ['other plugin repository', portalFailure.replace('plugins.gradle.org', 'repo.example.test')],
    ['unrelated settings plugin', portalFailure.replace(':gradle-plugin:settings-plugin', ':unrelated-plugin')],
    ['unrecognised module', portalFailure.replaceAll('javapoet', 'missing-library')],
    ['different configuration', portalFailure.replace(classpathError, "Could not resolve configuration 'compile'.")],
    ['another project using the Kotlin plugin', expoBuildPluginFailure.replaceAll(':expo-module-gradle-plugin', ':example')],
    ['an Expo module using a private plugin repository', expoBuildPluginFailure.replaceAll('plugins.gradle.org', 'repo.example.test')],
    ['another Expo plugin dependency', expoBuildPluginFailure.replaceAll('kotlin-gradle-plugins-bom', 'example-bom')],
  ])('preserves the %s failure without a retry', (_, failure) => {
    const { result, calls, directory } = runBundle('fail', failure);
    expect(result.status).toBe(42);
    expect(calls).toHaveLength(1);
    expect(existsSync(join(directory, 'github-env'))).toBe(false);
  });

  it('preserves the second failure and makes no third attempt', () => {
    const { result, calls } = runBundle('fail-again');
    expect(result.status).toBe(51);
    expect(calls).toHaveLength(2);
  });

  it.each(['log-failure', 'log-and-gradle-failure'])('fails closed after %s', (mode) => {
    const { result, calls, directory } = runBundle(mode);
    expect(result.status).toBe(1);
    expect(calls).toHaveLength(1);
    expect(existsSync(join(directory, 'github-env'))).toBe(false);
  });
});
