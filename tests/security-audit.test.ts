import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateAuditReport } from '../scripts/security-audit.mjs';

const lockfile = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const packageConfig = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const context = { lockfile, packageConfig, now: new Date('2026-10-30T12:00:00Z') };
type Finding = { name: string; severity: string; nodes: string[]; via: (string | Record<string, unknown>)[] };
const reviewed = {
  deepmerge: ['node_modules/deepmerge', []],
  '@expo/config': ['node_modules/@expo/config', ['deepmerge']],
  '@expo/local-build-cache-provider': ['node_modules/@expo/local-build-cache-provider', ['@expo/config']],
  '@expo/metro-config': ['node_modules/expo/node_modules/@expo/metro-config', ['@expo/config']],
  '@expo/prebuild-config': ['node_modules/@expo/prebuild-config', ['@expo/config']],
  '@expo/cli': ['node_modules/expo/node_modules/@expo/cli', ['@expo/config', '@expo/metro-config', '@expo/prebuild-config']],
  expo: ['node_modules/expo', ['@expo/cli', '@expo/config', '@expo/local-build-cache-provider', '@expo/metro-config']],
  '@react-native-community/datetimepicker': ['node_modules/@react-native-community/datetimepicker', ['expo']],
} as const;

function lowReport() {
  const vulnerabilities: Record<string, Finding> = Object.fromEntries(Object.entries(reviewed).map(([name, [path, via]]) => [
    name,
    {
      name, severity: 'low', nodes: [path],
      via: name === 'deepmerge' ? [{
        source: 1243505, name, dependency: name, severity: 'low',
        url: 'https://github.com/advisories/GHSA-gcqx-w48m-w2h4',
        range: '>=4.2.0 <=4.3.1',
      }] : [...via],
    },
  ]));
  return {
    auditReportVersion: 2, vulnerabilities,
    metadata: {
      vulnerabilities: { info: 0, low: 8, moderate: 0, high: 0, critical: 0, total: 8 },
      dependencies: { prod: 520, dev: 314, optional: 58, peer: 3, peerOptional: 0, total: 844 },
    },
  };
}

function cleanReport() {
  const report = lowReport();
  report.vulnerabilities = {};
  report.metadata.vulnerabilities = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  return report;
}

function altered(change: (report: ReturnType<typeof lowReport>) => void) {
  const report = lowReport();
  change(report);
  return report;
}

describe('production dependency security gate', () => {
  it('accepts clean production audits regardless of expired review', () => {
    expect(evaluateAuditReport(cleanReport(), { ...context, now: new Date('2027-01-01') }))
      .toMatchObject({ allowed: true, classification: 'clean' });
  });

  it('retains the exact known low build-tool advisory as a visible temporary review', () => {
    expect(evaluateAuditReport(lowReport(), context))
      .toMatchObject({ allowed: true, classification: 'reviewed-low', findings: 8 });
  });

  it.each([
    ['expiry', { now: new Date('2026-11-13T00:00:00Z') }],
    ['invalid clock', { now: new Date('invalid') }],
    ['locked dependency drift', { lockfile: { ...lockfile, packages: {
      ...lockfile.packages, 'node_modules/deepmerge': { ...lockfile.packages['node_modules/deepmerge'], version: '4.3.2' },
    } } }],
    ['root version mismatch', { packageConfig: { ...packageConfig, version: '0.0.0' } }],
  ])('rejects %s while low finding remains', (_label, alteredContext) => {
    expect(evaluateAuditReport(lowReport(), { ...context, ...alteredContext }).allowed).toBe(false);
  });

  it('rejects high and critical advisories even with a reviewed low graph', () => {
    for (const severity of ['high', 'critical'] as const) {
      const report = altered((value) => {
        value.vulnerabilities.deepmerge!.severity = severity;
        value.metadata.vulnerabilities.low = 7;
        value.metadata.vulnerabilities[severity] = 1;
      });
      expect(evaluateAuditReport(report, context).allowed).toBe(false);
    }
  });

  it('rejects an added low advisory even if its metadata is consistent', () => {
    const report = altered((value) => {
      value.vulnerabilities['new-package'] = {
        name: 'new-package', severity: 'low', nodes: ['node_modules/new-package'],
        via: ['deepmerge'],
      };
      value.metadata.vulnerabilities.low = 9;
      value.metadata.vulnerabilities.total = 9;
    });
    expect(evaluateAuditReport(report, context).allowed).toBe(false);
  });

  it('rejects moved nodes, an extra direct advisory, missing links and rootless cycles', () => {
    const moved = altered((value) => { value.vulnerabilities.deepmerge!.nodes = ['node_modules/x/node_modules/deepmerge']; });
    expect(evaluateAuditReport(moved, context).allowed).toBe(false);
    const extra = altered((value) => { value.vulnerabilities.deepmerge!.via.push({ source: 1 }); });
    expect(evaluateAuditReport(extra, context).allowed).toBe(false);
    const missing = altered((value) => { value.vulnerabilities['@expo/config']!.via = ['absent']; });
    expect(evaluateAuditReport(missing, context).allowed).toBe(false);
    const cycle = altered((value) => {
      value.vulnerabilities['@expo/config']!.via = ['@expo/cli'];
      value.vulnerabilities['@expo/cli']!.via = ['@expo/config'];
    });
    expect(evaluateAuditReport(cycle, context).allowed).toBe(false);
  });

  it('rejects spoofed severity counts, malformed envelopes and audit errors', () => {
    const counts = altered((value) => { value.metadata.vulnerabilities.low = 7; value.metadata.vulnerabilities.high = 1; });
    expect(evaluateAuditReport(counts, context).allowed).toBe(false);
    const finding = altered((value) => { value.vulnerabilities.deepmerge!.severity = 'high'; });
    expect(evaluateAuditReport(finding, context).allowed).toBe(false);
    expect(evaluateAuditReport({}, context).allowed).toBe(false);
    expect(evaluateAuditReport({ ...lowReport(), error: { code: 'EAUDIT' } }, context).allowed).toBe(false);
  });

  it.each([
    ['clean report', cleanReport(), 0, true],
    ['reviewed low report', lowReport(), 1, true],
    ['audit command failure without findings', cleanReport(), 1, false],
    ['npm falsely exits clean with findings', lowReport(), 0, false],
    ['npm error JSON', { ...lowReport(), error: { code: 'EAUDIT' } }, 1, false],
    ['malformed JSON', '{bad', 1, false],
  ])('preserves raw audit JSON and handles %s', (_label, payload, npmStatus, allowed) => {
    const temp = mkdtempSync(join(tmpdir(), 't1arc-security-audit-'));
    const fakeNpm = join(temp, process.platform === 'win32' ? 'npm.cmd' : 'npm');
    const fakePayload = join(temp, 'audit.json');
    const output = join(temp, 'output.json');
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    try {
      writeFileSync(fakePayload, raw);
      writeFileSync(fakeNpm, process.platform === 'win32'
        ? '@echo off\r\ntype "%~dp0audit.json"\r\nexit /b ' + npmStatus + '\r\n'
        : '#!/bin/sh\ncat "$(dirname "$0")/audit.json"\nexit ' + npmStatus + '\n');
      if (process.platform !== 'win32') chmodSync(fakeNpm, 0o755);
      const root = fileURLToPath(new URL('..', import.meta.url));
      const result = spawnSync(process.execPath, ['scripts/security-audit.mjs', '--report', output], {
        cwd: root, encoding: 'utf8',
        env: { ...process.env, PATH: temp + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH ?? '') },
      });
      expect(result.error).toBeUndefined();
      expect(result.status === 0).toBe(allowed);
      expect(readFileSync(output, 'utf8')).toBe(raw);
      if (allowed && _label === 'reviewed low report') {
        expect(result.stdout + result.stderr).toContain('REVIEWED LOW-SEVERITY FINDING');
        expect(result.stdout + result.stderr).not.toContain('Production dependency audit is clean.');
      }
    } finally {
      for (const path of [fakeNpm, fakePayload, output]) {
        try { unlinkSync(path); } catch { /* Output may not exist after an early failure. */ }
      }
      rmdirSync(temp);
    }
  });
});
