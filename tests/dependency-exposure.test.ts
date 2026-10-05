import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = process.cwd();
const guard = path.join(root, 'scripts', 'dependency-exposure-guard.cjs');
const verifier = path.join(root, 'scripts', 'verify-dependency-exposure.mjs');
const directories: string[] = [];

function evidenceDirectory() {
  const directory = mkdtempSync(path.join(tmpdir(), 't1arc-exposure-'));
  directories.push(directory);
  return directory;
}

function guarded(directory: string, script: string, stage = 'prebuild') {
  return spawnSync(process.execPath, ['-e', script], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_OPTIONS: `--require="${guard.replaceAll('\\', '/')}"`,
      T1ARC_EXPOSURE_DIR: directory,
      T1ARC_EXPOSURE_STAGE: stage,
    },
  });
}

function verify(directory: string, options: string[] = [], stage = 'prebuild') {
  return spawnSync(process.execPath, [verifier, '--evidence-dir', directory, '--require-stage', stage, ...options], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '' },
  });
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('release dependency exposure guard', () => {
  it('rejects configuration-helper evidence as proof of guarded release bundling', () => {
    const directory = evidenceDirectory();
    expect(guarded(directory, "require('braces');", 'bundle').status).toBe(0);
    expect(verify(directory, [], 'bundle').status).not.toBe(0);
  });

  it('recognises only the pinned Android embed CLI as the bundler process', () => {
    const directory = evidenceDirectory();
    const require = createRequire(import.meta.url);
    const cli = require.resolve('@expo/cli', { paths: [require.resolve('expo/package.json')] });
    // Help avoids doing a full build in the unit suite; real Gradle execution
    // and its generated source map are separately required by the workflow.
    const result = spawnSync(process.execPath, [cli, 'export:embed', '--platform', 'android', '--help'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: `--require="${guard.replaceAll('\\', '/')}"`,
        T1ARC_EXPOSURE_DIR: directory, T1ARC_EXPOSURE_STAGE: 'bundle' },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(verify(directory, [], 'bundle').status).toBe(0);
  });

  it('accepts completed build-process evidence when packages load but guarded operations do not run', () => {
    const directory = evidenceDirectory();
    const build = guarded(directory, "require('braces'); require('node-forge');");
    expect(build.status).toBe(0);
    expect(verify(directory).status).toBe(0);
  });

  it('records brace parsing and expansion attempts before a caller can catch the error', () => {
    const directory = evidenceDirectory();
    const script = `
      const braces = require('braces');
      for (const call of [() => braces('{a,b}'), () => braces.parse('{a,b}'),
        () => require('braces/lib/expand')({ type: 'root', nodes: [] })]) {
        try { call(); } catch (error) {
          if (!String(error).includes('T1ARC_DEPENDENCY_EXPOSURE_BLOCKED')) process.exit(2);
        }
      }
    `;
    const build = guarded(directory, script);
    expect(build.status).toBe(0);
    const records = readFileSync(path.join(directory, readdirSync(directory)[0]!), 'utf8');
    expect(records).toContain('braces.call');
    expect(records).toContain('braces.parse');
    expect(records).toContain('braces.expand');
    expect(records).not.toContain('{a,b}');
    expect(verify(directory).status).not.toBe(0);
  });

  it('records Forge RSA public-key construction even if the caller swallows the rejection', () => {
    const directory = evidenceDirectory();
    const script = `
      const forge = require('node-forge');
      const rsa = require('node-forge/lib/rsa');
      const pki = require('node-forge/lib/pki');
      for (const call of [() => forge.pki.rsa.setPublicKey(3, 65537),
        () => rsa.setPublicKey(3, 65537),
        () => pki.setRsaPublicKey(3, 65537),
        () => forge.pki.publicKeyFromPem('not a key')]) {
        try { call(); } catch (error) {
          if (!String(error).includes('T1ARC_DEPENDENCY_EXPOSURE_BLOCKED')) process.exit(2);
        }
      }
    `;
    const build = guarded(directory, script);
    expect(build.status).toBe(0);
    const records = readFileSync(path.join(directory, readdirSync(directory)[0]!), 'utf8');
    expect(records).toContain('forge.rsa.setPublicKey');
    expect(records).toContain('forge.pki.setRsaPublicKey');
    expect(records).toContain('forge.pki.publicKeyFromPem');
    expect(records).not.toContain('not a key');
    expect(verify(directory).status).not.toBe(0);
  });

  it('rejects Forge browser bundles before their uninstrumented code executes', () => {
    const directory = evidenceDirectory();
    const script = `
      try { require('node-forge/dist/forge.min.js'); }
      catch (error) {
        if (!String(error).includes('T1ARC_DEPENDENCY_EXPOSURE_BLOCKED:forge.unsupportedEntrypoint')) process.exit(2);
      }
    `;
    expect(guarded(directory, script).status).toBe(0);
    const records = readFileSync(path.join(directory, readdirSync(directory)[0]!), 'utf8');
    expect(records).toContain('forge.unsupportedEntrypoint');
    expect(verify(directory).status).not.toBe(0);
  });

  it('fails closed for missing and unfinished build stages', () => {
    const directory = evidenceDirectory();
    expect(verify(directory).status).not.toBe(0);
    expect(guarded(directory, "require('braces');").status).toBe(0);
    expect(verify(directory, ['--require-stage', 'signed-build']).status).not.toBe(0);
    const report = path.join(directory, readdirSync(directory)[0]!);
    const lines = readFileSync(report, 'utf8').trimEnd().split('\n');
    writeFileSync(report, `${lines[0]!}\n`);
    expect(verify(directory).status).not.toBe(0);
  });

  it('checks the Android bundle source map for prohibited dependencies', () => {
    const directory = evidenceDirectory();
    const artifacts = evidenceDirectory();
    expect(guarded(directory, "require('braces');").status).toBe(0);
    const bundle = path.join(artifacts, 'index.android.bundle');
    const sourceMap = path.join(artifacts, 'index.android.bundle.map');
    writeFileSync(bundle, 'var app = 1;');
    writeFileSync(sourceMap, JSON.stringify({ version: 3, sources: ['../src/index.ts'], names: [], mappings: '' }));
    const options = ['--source-map', sourceMap, '--bundle', bundle];
    expect(verify(directory, options).status).toBe(0);
    writeFileSync(sourceMap, JSON.stringify({ version: 3, sources: ['../node_modules/node-forge/lib/rsa.js'], names: [], mappings: '' }));
    expect(verify(directory, options).status).not.toBe(0);
    writeFileSync(sourceMap, JSON.stringify({ version: 3, sourceRoot: '../node_modules/node-forge', sources: ['lib/rsa.js'], names: [], mappings: '' }));
    expect(verify(directory, options).status).not.toBe(0);
    writeFileSync(sourceMap, JSON.stringify({ version: 3, sources: ['node-forge/lib/rsa.js'], names: [], mappings: '' }));
    expect(verify(directory, options).status).not.toBe(0);
    writeFileSync(sourceMap, JSON.stringify({ version: 3, sources: [''], names: [], mappings: '' }));
    expect(verify(directory, options).status).not.toBe(0);
  });
});
