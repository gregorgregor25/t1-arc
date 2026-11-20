import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The only reviewed residual finding is a low-severity build-tool advisory.
// It is intentionally temporary; a new graph or advisory needs a new review.
const REVIEW_EXPIRES_AT = '2027-02-12T00:00:00Z';
const DEEPMERGE_ADVISORY = Object.freeze({
  source: 1243505,
  url: 'https://github.com/advisories/GHSA-gcqx-w48m-w2h4',
  range: '>=4.2.0 <=4.3.1',
});
const reviewed = Object.freeze({
  deepmerge: { path: 'node_modules/deepmerge', version: '4.3.1', via: [] },
  '@expo/config': { path: 'node_modules/@expo/config', version: '57.0.10', via: ['deepmerge'] },
});

// Reviewed 17 Nov 2026: picomatch ReDoS (GHSA-fc5q-39xc-vjpf) has no patched
// release. picomatch reaches the production graph only through build tooling
// (Metro, Expo CLI, React Native codegen, Jest workers); a production Android
// export contained none of these modules. The allowance is narrow and short:
// every high finding must belong to this exact build-tool graph, the only
// advisory object must be this one, and installed picomatch versions must match.
const PICOMATCH_REVIEW_EXPIRES_AT = '2026-12-17T00:00:00Z';
const PICOMATCH_ADVISORY = Object.freeze({
  source: 1247710,
  url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
  range: '<=4.0.7',
});
const PICOMATCH_INSTALLED = Object.freeze({
  'node_modules/picomatch': '2.3.2',
  'node_modules/expo/node_modules/picomatch': '4.0.7',
  'node_modules/tinyglobby/node_modules/picomatch': '4.0.5',
});
const PICOMATCH_GRAPH = Object.freeze(new Set([
  '@expo/cli', '@expo/metro', '@expo/metro-config', '@expo/metro-file-map',
  '@react-native-community/datetimepicker', '@react-native/babel-plugin-codegen',
  '@react-native/codegen', '@react-native/community-cli-plugin',
  '@react-native/virtualized-lists', 'babel-preset-expo', 'expo', 'fdir',
  'jest-util', 'jest-worker', 'metro', 'metro-config', 'metro-file-map',
  'metro-transform-worker', 'micromatch', 'picomatch', 'react-native', 'tinyglobby',
]));

/**
 * Remove the reviewed picomatch build-tool graph from a report. Returns the
 * remaining report for the normal checks, or a rejection. Fails closed on any
 * other high finding, another advisory, a changed path or an expired review.
 */
function withoutReviewedPicomatch(report, context) {
  const findings = report.vulnerabilities;
  const highNames = Object.keys(findings).filter((name) => findings[name].severity === 'high');
  if (highNames.length === 0 || report.metadata.vulnerabilities.critical > 0) {
    return { rejection: reject('High or critical production advisory detected.') };
  }
  const picomatch = findings.picomatch;
  if (!isRecord(picomatch) || picomatch.severity !== 'high' ||
      !highNames.every((name) => PICOMATCH_GRAPH.has(name))) {
    return { rejection: reject('High or critical production advisory detected.') };
  }
  const now = isRecord(context) && context.now instanceof Date ? context.now.getTime() : NaN;
  if (!Number.isFinite(now) || now >= Date.parse(PICOMATCH_REVIEW_EXPIRES_AT)) {
    return { rejection: reject('The reviewed picomatch build-tool advisory has expired or the clock is invalid.') };
  }
  if (!isRecord(context.lockfile) || !isRecord(context.lockfile.packages) ||
      !Array.isArray(picomatch.nodes) || picomatch.nodes.length === 0 ||
      !picomatch.nodes.every((node) => typeof node === 'string' &&
        Object.hasOwn(PICOMATCH_INSTALLED, node) &&
        context.lockfile.packages[node]?.version === PICOMATCH_INSTALLED[node])) {
    return { rejection: reject('The reviewed picomatch install paths or versions changed.') };
  }
  if (!Array.isArray(picomatch.via) || picomatch.via.length !== 1 || !isRecord(picomatch.via[0]) ||
      picomatch.via[0].name !== 'picomatch' || picomatch.via[0].dependency !== 'picomatch' ||
      picomatch.via[0].source !== PICOMATCH_ADVISORY.source ||
      picomatch.via[0].url !== PICOMATCH_ADVISORY.url ||
      picomatch.via[0].range !== PICOMATCH_ADVISORY.range ||
      picomatch.via[0].severity !== 'high') {
    return { rejection: reject('The reviewed picomatch advisory changed.') };
  }
  for (const name of highNames) {
    if (name === 'picomatch') continue;
    const via = findings[name].via;
    if (!Array.isArray(via) || via.length === 0 ||
        !via.every((item) => typeof item === 'string' && highNames.includes(item))) {
      return { rejection: reject('The reviewed picomatch graph changed: ' + name) };
    }
  }
  const remaining = Object.fromEntries(Object.entries(findings).filter(([name]) => !highNames.includes(name)));
  const counts = { ...report.metadata.vulnerabilities, high: 0 };
  counts.total -= highNames.length;
  return {
    report: { ...report, vulnerabilities: remaining, metadata: { ...report.metadata, vulnerabilities: counts } },
    picomatchFindings: highNames.length,
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function reject(reason) {
  return { allowed: false, classification: 'rejected', reason };
}

function validAuditEnvelope(report) {
  if (!isRecord(report) || report.auditReportVersion !== 2 ||
      !isRecord(report.vulnerabilities) || !isRecord(report.metadata) ||
      !isRecord(report.metadata.vulnerabilities) ||
      !isRecord(report.metadata.dependencies) ||
      Object.keys(report).some((key) => !['auditReportVersion', 'vulnerabilities', 'metadata'].includes(key))) {
    return false;
  }
  const counts = report.metadata.vulnerabilities;
  const severities = ['info', 'low', 'moderate', 'high', 'critical'];
  if (!severities.every((key) => Number.isSafeInteger(counts[key]) && counts[key] >= 0) ||
      !Number.isSafeInteger(counts.total) || counts.total < 0 ||
      severities.reduce((sum, key) => sum + counts[key], 0) !== counts.total ||
      counts.total !== Object.keys(report.vulnerabilities).length) {
    return false;
  }
  const dependencies = report.metadata.dependencies;
  return ['prod', 'dev', 'optional', 'peer', 'peerOptional', 'total'].every(
    (key) => Number.isSafeInteger(dependencies[key]) && dependencies[key] >= 0,
  );
}

function sameStrings(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((item) => typeof item === 'string') &&
    [...actual].sort().every((item, index) => item === [...expected].sort()[index]);
}

/** Evaluate unmodified npm audit JSON. Unknown findings always fail closed. */
export function evaluateAuditReport(report, context) {
  if (!validAuditEnvelope(report)) return reject('Malformed or incomplete npm audit report.');
  const findings = report.vulnerabilities;
  const names = Object.keys(findings);
  const counts = report.metadata.vulnerabilities;
  const actualCounts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const [name, finding] of Object.entries(findings)) {
    if (!isRecord(finding) || finding.name !== name ||
        !Object.hasOwn(actualCounts, finding.severity)) {
      return reject('Malformed audit finding.');
    }
    actualCounts[finding.severity]++;
  }
  if (Object.keys(actualCounts).some((severity) => actualCounts[severity] !== counts[severity])) {
    return reject('Audit severity counts disagree with findings.');
  }
  if (counts.high > 0 || counts.critical > 0) {
    const stripped = withoutReviewedPicomatch(report, context);
    if (stripped.rejection) return stripped.rejection;
    const rest = evaluateAuditReport(stripped.report, context);
    if (!rest.allowed) return rest;
    return {
      allowed: true,
      classification: 'reviewed-build-tool',
      reason: 'Only the reviewed picomatch build-tool advisory graph (' + stripped.picomatchFindings +
        ' findings) remains' + (rest.classification === 'clean' ? '' : ' alongside: ' + rest.reason) +
        '; review expires ' + PICOMATCH_REVIEW_EXPIRES_AT + '.',
      findings: names.length,
    };
  }
  if (names.length === 0) {
    return { allowed: true, classification: 'clean', reason: 'No production advisories reported.' };
  }
  if (counts.info > 0 || counts.moderate > 0 || counts.low !== Object.keys(reviewed).length ||
      !sameStrings(names, Object.keys(reviewed))) {
    return reject('An unreviewed production advisory is present.');
  }
  if (!isRecord(context) || !isRecord(context.lockfile) ||
      !isRecord(context.lockfile.packages) || !isRecord(context.packageConfig) ||
      context.packageConfig.version !== context.lockfile.version ||
      context.lockfile.packages['']?.version !== context.packageConfig.version) {
    return reject('Dependency context is incomplete or inconsistent.');
  }
  const now = context.now instanceof Date ? context.now.getTime() : NaN;
  if (!Number.isFinite(now) || now >= Date.parse(REVIEW_EXPIRES_AT)) {
    return reject('The reviewed low-severity finding has expired or the clock is invalid.');
  }
  for (const name of names) {
    const finding = findings[name];
    const expected = reviewed[name];
    if (finding.severity !== 'low' ||
        !sameStrings(finding.nodes, [expected.path]) ||
        context.lockfile.packages[expected.path]?.version !== expected.version ||
        !Array.isArray(finding.via)) {
      return reject('A reviewed finding changed severity, path or installed version: ' + name);
    }
    if (name === 'deepmerge') {
      if (finding.via.length !== 1 || !isRecord(finding.via[0]) ||
          finding.via[0].name !== name || finding.via[0].dependency !== name ||
          finding.via[0].source !== DEEPMERGE_ADVISORY.source ||
          finding.via[0].url !== DEEPMERGE_ADVISORY.url ||
          finding.via[0].range !== DEEPMERGE_ADVISORY.range ||
          finding.via[0].severity !== 'low') {
        return reject('The reviewed deepmerge advisory changed.');
      }
    } else if (!sameStrings(finding.via, expected.via)) {
      return reject('The reviewed advisory graph changed: ' + name);
    }
  }
  return {
    allowed: true,
    classification: 'reviewed-low',
    reason: 'Only the reviewed deepmerge build-tool advisory and its exact derived graph remain; review expires ' + REVIEW_EXPIRES_AT + '.',
    findings: names.length,
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--report' || !args[1]) {
    throw new Error('Usage: node scripts/security-audit.mjs --report PATH');
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  if (realpathSync(process.cwd()) !== realpathSync(root)) {
    throw new Error('Run the security audit from the repository root.');
  }
  const onWindows = process.platform === 'win32';
  const audit = spawnSync(onWindows ? 'cmd.exe' : 'npm',
    onWindows ? ['/d', '/s', '/c', 'npm audit --omit=dev --json'] : ['audit', '--omit=dev', '--json'], {
      cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    });
  writeFileSync(resolve(args[1]), audit.stdout ?? '', 'utf8');
  if (audit.error || ![0, 1].includes(audit.status)) {
    throw new Error('npm audit failed to run reliably: ' + (audit.error?.message ?? audit.status));
  }
  let report;
  try { report = JSON.parse(audit.stdout); }
  catch { throw new Error('npm audit returned malformed JSON.'); }
  const evaluation = evaluateAuditReport(report, {
    packageConfig: JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')),
    lockfile: JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8')),
    now: new Date(),
  });
  if ((audit.status === 0 && evaluation.classification !== 'clean') ||
      (audit.status === 1 && evaluation.classification === 'clean') ||
      !evaluation.allowed) {
    throw new Error('Security audit blocked: ' + evaluation.reason);
  }
  if (evaluation.classification === 'reviewed-low' || evaluation.classification === 'reviewed-build-tool') {
    console.warn('REVIEWED FINDING: ' + evaluation.reason);
  } else {
    console.log('Production dependency audit is clean.');
  }
  console.log('Full npm audit JSON: ' + resolve(args[1]));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
