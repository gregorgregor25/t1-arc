import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const release = Object.freeze({
  version: '1.7.15',
  versionCode: 70,
  applicationId: 'io.github.gregorgregor25.t1arc',
  lockfileSha256: 'ae84beab6e319bce89b43040b9e5097f197741d368ab6540155c7058e2a2e2cf',
  expiresAt: '2026-10-12T00:00:00Z',
});

const advisories = Object.freeze({
  braces: Object.freeze({
    version: '3.0.3',
    source: 1240992,
    url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
  }),
  'node-forge': Object.freeze({
    version: '1.4.0',
    source: 1240912,
    url: 'https://github.com/advisories/GHSA-86w9-cpqp-85rv',
  }),
});

// The reviewed production audit contained these 17 affected packages. A
// different package or installation path is a new finding, even if npm says it
// is derived from one of the same advisories.
const reviewedNodes = Object.freeze({
  '@expo/cli': 'node_modules/expo/node_modules/@expo/cli',
  '@expo/code-signing-certificates': 'node_modules/@expo/code-signing-certificates',
  '@expo/metro': 'node_modules/@expo/metro',
  '@expo/metro-config': 'node_modules/expo/node_modules/@expo/metro-config',
  '@expo/metro-file-map': 'node_modules/@expo/metro-file-map',
  '@react-native-community/datetimepicker': 'node_modules/@react-native-community/datetimepicker',
  '@react-native/community-cli-plugin': 'node_modules/@react-native/community-cli-plugin',
  '@react-native/virtualized-lists': 'node_modules/@react-native/virtualized-lists',
  braces: 'node_modules/braces',
  expo: 'node_modules/expo',
  metro: 'node_modules/metro',
  'metro-config': 'node_modules/metro-config',
  'metro-file-map': 'node_modules/metro-file-map',
  'metro-transform-worker': 'node_modules/metro-transform-worker',
  micromatch: 'node_modules/micromatch',
  'node-forge': 'node_modules/node-forge',
  'react-native': 'node_modules/react-native',
});

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

/** A pure, fail-closed evaluation of npm's unmodified audit JSON. */
export function evaluateAuditReport(report, context) {
  if (!validAuditEnvelope(report)) return reject('Malformed or incomplete npm audit report.');
  const findings = report.vulnerabilities;
  const names = Object.keys(findings);
  if (names.length === 0) {
    return { allowed: true, classification: 'clean', reason: 'No production advisories reported.' };
  }

  if (!isRecord(context) || !isRecord(context.appConfig) ||
      !isRecord(context.packageConfig) || !isRecord(context.lockfile) ||
      !isRecord(context.lockfile.packages) ||
      context.appConfig?.expo?.version !== release.version ||
      context.appConfig?.expo?.android?.versionCode !== release.versionCode ||
      context.appConfig?.expo?.android?.package !== release.applicationId ||
      context.packageConfig.version !== release.version ||
      context.lockfile.version !== release.version ||
      context.lockfile.packages['']?.version !== release.version ||
      context.lockfileSha256 !== release.lockfileSha256) {
    return reject('Release version, Android identity or lockfile differs from approved scope.');
  }

  const now = context.now instanceof Date ? context.now.getTime() : NaN;
  if (!Number.isFinite(now) || now >= Date.parse(release.expiresAt)) {
    return reject('Security exception is expired or the clock is invalid.');
  }
  if (names.some((name) => !Object.hasOwn(reviewedNodes, name)) ||
      names.length > Object.keys(reviewedNodes).length) {
    return reject('Audit contains a new affected package.');
  }
  const counts = report.metadata.vulnerabilities;
  if (counts.high !== names.length ||
      ['info', 'low', 'moderate', 'critical'].some((key) => counts[key] !== 0)) {
    return reject('Audit contains a finding outside the approved high-severity scope.');
  }

  for (const name of names) {
    const finding = findings[name];
    const reviewedPath = reviewedNodes[name];
    if (!isRecord(finding) || finding.name !== name ||
        finding.severity !== 'high' ||
        !Array.isArray(finding.via) || finding.via.length === 0 ||
        !Array.isArray(finding.nodes) || finding.nodes.length !== 1 ||
        finding.nodes[0] !== reviewedPath ||
        !isRecord(context.lockfile.packages[reviewedPath]) ||
        typeof context.lockfile.packages[reviewedPath].version !== 'string') {
      return reject(`Finding for ${name} differs from the reviewed installation.`);
    }
    if (Object.hasOwn(advisories, name) &&
        context.lockfile.packages[reviewedPath].version !== advisories[name].version) {
      return reject(`Affected ${name} version differs from approved scope.`);
    }
  }

  // npm's affected-package graph contains legitimate cycles (Metro and
  // Metro Config). Validate every edge first, then propagate approved roots
  // to a fixed point. A rootless cycle remains rejected.
  const roots = new Map(names.map((name) => [name, new Set()]));
  const links = new Map();
  for (const name of names) {
    const finding = findings[name];
    const dependencies = [];
    let directCount = 0;
    for (const via of finding.via) {
      if (typeof via === 'string') {
        if (!Object.hasOwn(findings, via)) {
          return reject(`Missing linked audit finding ${via}.`);
        }
        dependencies.push(via);
      } else if (isRecord(via)) {
        const expected = advisories[name];
        if (!expected || via.name !== name || via.dependency !== name ||
            via.source !== expected.source || via.url !== expected.url ||
            via.severity !== 'high') {
          return reject(`Unrecognised advisory on ${name}.`);
        }
        directCount++;
        roots.get(name).add(name);
      } else {
        return reject(`Malformed advisory link on ${name}.`);
      }
    }
    if (Object.hasOwn(advisories, name) ?
        (directCount !== 1 || finding.via.length !== 1) : directCount !== 0) {
      return reject(`Additional or missing direct advisory on ${name}.`);
    }
    links.set(name, dependencies);
  }
  let changed;
  do {
    changed = false;
    for (const name of names) {
      for (const dependency of links.get(name)) {
        for (const root of roots.get(dependency)) {
          if (!roots.get(name).has(root)) {
            roots.get(name).add(root);
            changed = true;
          }
        }
      }
    }
  } while (changed);
  for (const name of names) {
    if (roots.get(name).size === 0) {
      return reject(`No approved advisory root for ${name}.`);
    }
  }

  return {
    allowed: true,
    classification: 'conditional-exception',
    reason: `Only the two reviewed build-tool advisories and their reviewed derived findings remain; exception expires ${release.expiresAt}.`,
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
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  // Keep the entire raw report, including npm's error JSON when present.
  writeFileSync(resolve(args[1]), audit.stdout ?? '', 'utf8');
  if (audit.error || ![0, 1].includes(audit.status)) {
    throw new Error(`npm audit failed to run reliably: ${audit.error?.message ?? audit.status}`);
  }
  let report;
  try {
    report = JSON.parse(audit.stdout);
  } catch {
    throw new Error('npm audit returned malformed JSON.');
  }
  const lockfileBuffer = readFileSync(resolve(root, 'package-lock.json'));
  const evaluation = evaluateAuditReport(report, {
    appConfig: JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8')),
    packageConfig: JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')),
    lockfile: JSON.parse(lockfileBuffer.toString('utf8')),
    lockfileSha256: createHash('sha256').update(lockfileBuffer).digest('hex'),
    now: new Date(),
  });
  if (audit.status === 0 && evaluation.classification !== 'clean' ||
      audit.status === 1 && evaluation.classification === 'clean' ||
      !evaluation.allowed) {
    throw new Error(`Security audit blocked: ${evaluation.reason}`);
  }
  if (evaluation.classification === 'conditional-exception') {
    console.log(`CONDITIONAL ANDROID 1.7.15 EXCEPTION: ${evaluation.reason}`);
    console.log('This audit result requires separate guarded Linux build, APK, review and device checks.');
  } else {
    console.log('Production dependency audit is clean.');
  }
  console.log(`Full npm audit JSON: ${resolve(args[1])}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
