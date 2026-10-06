import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The script deliberately stays runnable by Node without a TS loader in CI.
import { evaluateAuditReport } from '../scripts/security-audit.mjs';

const lockfileBytes = readFileSync(new URL('../package-lock.json', import.meta.url));
const baseContext = {
  appConfig: JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')),
  packageConfig: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')),
  lockfile: JSON.parse(lockfileBytes.toString('utf8')),
  lockfileSha256: createHash('sha256').update(lockfileBytes).digest('hex'),
  now: new Date('2026-10-06T12:00:00Z'),
};

const dependencyCounts = {
  prod: 520,
  dev: 314,
  optional: 58,
  peer: 3,
  peerOptional: 0,
  total: 844,
};

function report(vulnerabilities: Record<string, unknown>) {
  const high = Object.keys(vulnerabilities).length;
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 0, high, critical: 0, total: high },
      dependencies: dependencyCounts,
    },
  };
}

function bracesFinding() {
  return {
    name: 'braces',
    severity: 'high',
    via: [{
      source: 1240992,
      name: 'braces',
      dependency: 'braces',
      title: 'braces vulnerable to stack-exhaustion denial of service through deeply nested patterns',
      url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
      severity: 'high',
      range: '<=3.0.3',
    }],
    nodes: ['node_modules/braces'],
  };
}

function forgeFinding() {
  return {
    name: 'node-forge',
    severity: 'high',
    via: [{
      source: 1240912,
      name: 'node-forge',
      dependency: 'node-forge',
      title: 'node-forge RSA PKCS#1 v1.5 signature verification accepts extra nested DigestAlgorithm elements',
      url: 'https://github.com/advisories/GHSA-86w9-cpqp-85rv',
      severity: 'high',
      range: '<=1.4.0',
    }],
    nodes: ['node_modules/node-forge'],
  };
}

function micromatchFinding(via: unknown[] = ['braces']) {
  return {
    name: 'micromatch',
    severity: 'high',
    via,
    nodes: ['node_modules/micromatch'],
  };
}

describe('temporary production dependency audit exception', () => {
  it('accepts only the two reviewed leaves and their reviewed derived path', () => {
    const actual = report({
      braces: bracesFinding(),
      'node-forge': forgeFinding(),
      micromatch: micromatchFinding(),
    });
    expect(evaluateAuditReport(actual, baseContext)).toMatchObject({
      allowed: true,
      classification: 'conditional-exception',
      findings: 3,
    });
  });

  it('allows a genuinely clean report after the exception expires', () => {
    expect(evaluateAuditReport(report({}), {
      ...baseContext,
      now: new Date('2026-10-20T00:00:00Z'),
      lockfileSha256: 'a changed but fully patched lockfile',
    })).toMatchObject({ allowed: true, classification: 'clean' });
  });

  it.each([
    ['expiry', { now: new Date('2026-10-12T00:00:00Z') }],
    ['invalid clock', { now: new Date('invalid') }],
    ['lock hash drift', { lockfileSha256: '0'.repeat(64) }],
    ['app version drift', { appConfig: { expo: { version: '0.0.0', android: baseContext.appConfig.expo.android } } }],
    ['previous release version', { appConfig: { expo: { version: '1.7.14', android: { ...baseContext.appConfig.expo.android, versionCode: 68 } } } }],
    ['Android code drift', { appConfig: { expo: { ...baseContext.appConfig.expo, android: { ...baseContext.appConfig.expo.android, versionCode: baseContext.appConfig.expo.android.versionCode + 2 } } } }],
    ['dependency drift', { lockfile: { ...baseContext.lockfile, packages: { ...baseContext.lockfile.packages, 'node_modules/braces': { version: '3.0.4' } } } }],
  ])('rejects %s while an exception is needed', (_label, change) => {
    expect(evaluateAuditReport(report({ braces: bracesFinding() }), {
      ...baseContext,
      ...change,
    }).allowed).toBe(false);
  });

  it('rejects an additional direct advisory hidden under an approved derived package', () => {
    const actual = report({
      braces: bracesFinding(),
      micromatch: micromatchFinding([
        'braces',
        { name: 'micromatch', dependency: 'micromatch', source: 99,
          url: 'https://github.com/advisories/GHSA-new', severity: 'high' },
      ]),
    });
    expect(evaluateAuditReport(actual, baseContext).allowed).toBe(false);
  });

  it('rejects an extra advisory on a reviewed leaf', () => {
    const leaf = bracesFinding();
    leaf.via.push({ ...leaf.via[0]!, source: 42 });
    expect(evaluateAuditReport(report({ braces: leaf }), baseContext).allowed).toBe(false);
  });

  it('rejects new affected packages or installation paths', () => {
    const newPackage = report({
      braces: bracesFinding(),
      'new-pkg': { name: 'new-pkg', severity: 'high', via: ['braces'], nodes: ['node_modules/new-pkg'] },
    });
    expect(evaluateAuditReport(newPackage, baseContext).allowed).toBe(false);
    const moved = report({ braces: { ...bracesFinding(), nodes: ['node_modules/other/node_modules/braces'] } });
    expect(evaluateAuditReport(moved, baseContext).allowed).toBe(false);
  });

  it('accepts reviewed graph cycles that reach an approved advisory', () => {
    const actual = report({
      braces: bracesFinding(),
      micromatch: micromatchFinding(),
      'metro-file-map': {
        name: 'metro-file-map', severity: 'high', via: ['micromatch'],
        nodes: ['node_modules/metro-file-map'],
      },
      metro: {
        name: 'metro', severity: 'high', via: ['metro-config', 'metro-file-map'],
        nodes: ['node_modules/metro'],
      },
      'metro-config': {
        name: 'metro-config', severity: 'high', via: ['metro'],
        nodes: ['node_modules/metro-config'],
      },
    });
    expect(evaluateAuditReport(actual, baseContext).allowed).toBe(true);
  });

  it('rejects missing links and rootless cycles in the propagated advisory graph', () => {
    const missing = report({ micromatch: micromatchFinding() });
    expect(evaluateAuditReport(missing, baseContext).allowed).toBe(false);
    const cycle = report({
      micromatch: micromatchFinding(['metro-file-map']),
      'metro-file-map': {
        name: 'metro-file-map', severity: 'high', via: ['micromatch'],
        nodes: ['node_modules/metro-file-map'],
      },
    });
    expect(evaluateAuditReport(cycle, baseContext).allowed).toBe(false);
  });

  it('rejects malformed, partial and error audit reports', () => {
    expect(evaluateAuditReport({}, baseContext).allowed).toBe(false);
    const missingMetadata = { auditReportVersion: 2, vulnerabilities: { braces: bracesFinding() } };
    expect(evaluateAuditReport(missingMetadata, baseContext).allowed).toBe(false);
    const errorReport = { ...report({}), error: { code: 'EAUDIT' } };
    expect(evaluateAuditReport(errorReport, baseContext).allowed).toBe(false);
    const falseCounts = report({ braces: bracesFinding() });
    falseCounts.metadata.vulnerabilities.high = 0;
    expect(evaluateAuditReport(falseCounts, baseContext).allowed).toBe(false);
    const mixedSeverity = report({ braces: bracesFinding() });
    mixedSeverity.metadata.vulnerabilities.high = 0;
    mixedSeverity.metadata.vulnerabilities.moderate = 1;
    expect(evaluateAuditReport(mixedSeverity, baseContext).allowed).toBe(false);
  });

  it.each([
    ['clean result from npm', report({}), 0, true],
    ['audit command fails with no findings', report({}), 1, false],
    ['npm falsely exits clean with an advisory', report({ braces: bracesFinding() }), 0, false],
    ['npm reports an error', { ...report({}), error: { code: 'EAUDIT' } }, 1, false],
  ])('preserves the raw report and handles %s', (_label, payload, npmStatus, allowed) => {
    const temp = mkdtempSync(join(tmpdir(), 't1arc-security-audit-'));
    const fakeNpm = join(temp, process.platform === 'win32' ? 'npm.cmd' : 'npm');
    const fakePayload = join(temp, 'audit.json');
    const output = join(temp, 'output.json');
    const json = JSON.stringify(payload);
    try {
      writeFileSync(fakePayload, json);
      writeFileSync(fakeNpm, process.platform === 'win32'
        ? `@echo off\r\ntype "%~dp0audit.json"\r\nexit /b ${npmStatus}\r\n`
        : `#!/bin/sh\ncat "$(dirname "$0")/audit.json"\nexit ${npmStatus}\n`);
      if (process.platform !== 'win32') chmodSync(fakeNpm, 0o755);
      const root = fileURLToPath(new URL('..', import.meta.url));
      const result = spawnSync(process.execPath,
        ['scripts/security-audit.mjs', '--report', output], {
          cwd: root,
          encoding: 'utf8',
          env: { ...process.env, PATH: `${temp}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}` },
        });
      expect(result.error).toBeUndefined();
      expect(result.status === 0).toBe(allowed);
      expect(readFileSync(output, 'utf8')).toBe(json);
    } finally {
      for (const path of [fakeNpm, fakePayload, output]) {
        try { unlinkSync(path); } catch { /* Output may not exist after an early failure. */ }
      }
      rmdirSync(temp);
    }
  });
});
