import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function proposedPaths() {
  return execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    },
  )
    .split('\0')
    .filter(Boolean);
}

function readProposedText(path) {
  const bytes = readFileSync(resolve(projectRoot, path));
  if (bytes.includes(0)) return undefined;
  return bytes.toString('utf8');
}

const failures = [];
// A local review may contain intentional unstaged deletions. Scan the proposed
// working tree rather than crashing on paths that no longer exist; clean CI and
// committed trees have no such distinction.
const paths = proposedPaths().filter((path) =>
  existsSync(resolve(projectRoot, path)),
);
const forbiddenArtifacts = /^(?:android|ios)(?:\/|$)|(?:^|\/)(?:node_modules|build|\.gradle|\.cxx|qa-artifacts)(?:\/|$)/i;
const sensitiveExtension = /\.(?:apk|aab|db(?:\.gz)?|sqlite|sqlite3|jks|keystore|p8|p12|pem|key|mobileprovision|zip|csv)$/i;
// These are redistributable government food tables, never a health database.
// Both the exact asset name and its audited manifest hash must match.
const publicFoodAssets = new Map([
  ['ca-cnf', 'assets/food-packs/ca-cnf-2026.db'],
  ['fr-ciqual', 'assets/food-packs/fr-ciqual-2025.db'],
  ['de-bls', 'assets/food-packs/de-bls-4.0-2025.db'],
  ['us-usda-branded', 'assets/food-packs/us-usda-branded-2026-04-30.db.gz'],
]);
const foodManifests = JSON.parse(readFileSync(resolve(projectRoot, 'src/data/food/country-packs.manifest.json'), 'utf8'));
const verifiedFoodAssets = new Set();
for (const [id, path] of publicFoodAssets) {
  const manifest = foodManifests.find(pack => pack.id === id && pack.bundled);
  if (!manifest || !paths.includes(path)) {
    failures.push(`${path}: declared public food asset is missing`);
    continue;
  }
  const compressed = path.endsWith('.gz');
  const bytes = readFileSync(resolve(projectRoot, path));
  const expectedHash = compressed ? manifest.compressedSha256 : manifest.sha256;
  const expectedSize = compressed ? manifest.compressedBytes : manifest.sizeBytes;
  if (!manifest.sourceUrl?.startsWith('https://') || !manifest.licenceUrl?.startsWith('https://') ||
      bytes.length !== expectedSize || createHash('sha256').update(bytes).digest('hex') !== expectedHash) {
    failures.push(`${path}: public food asset provenance or checksum differs`);
  } else verifiedFoodAssets.add(path);
}

for (const path of paths) {
  const name = path.split('/').at(-1) ?? path;
  if (forbiddenArtifacts.test(path) || (sensitiveExtension.test(path) && !verifiedFoodAssets.has(path))) {
    failures.push(`${path}: generated, private-data, signing, or release artifact`);
  }
  if (name.startsWith('.env') && !name.endsWith('.example')) {
    failures.push(`${path}: non-example environment file`);
  }
}

for (const path of paths.filter((candidate) => candidate.endsWith('.md'))) {
  const markdown = readProposedText(path);
  if (markdown === undefined) continue;
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1]?.trim();
    if (
      !target ||
      target.startsWith('#') ||
      /^(?:https?:|mailto:)/i.test(target)
    ) {
      continue;
    }
    const withoutTitle = target.replace(/\s+["'][^"']*["']$/, '');
    const localTarget = withoutTitle.split('#', 1)[0];
    if (!localTarget) continue;
    let decodedTarget;
    try {
      decodedTarget = decodeURIComponent(localTarget);
    } catch {
      failures.push(`${path}: malformed local Markdown link ${localTarget}`);
      continue;
    }
    if (!existsSync(resolve(projectRoot, dirname(path), decodedTarget))) {
      failures.push(`${path}: missing local Markdown link ${localTarget}`);
    }
  }
}

const secretPatterns = [
  ['private-key material', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s*\r?\n[A-Za-z0-9+/=]{32,}/],
  ['OpenAI key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ['Slack token', /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/],
  ['Stripe live key', /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/],
  ['bearer JWT', /\bBearer\s+eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\./i],
];

for (const path of paths) {
  const text = readProposedText(path);
  if (text === undefined) continue;
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(text)) failures.push(`${path}: possible ${label}`);
  }

  const name = path.split('/').at(-1) ?? path;
  if (!name.startsWith('.env') || !name.endsWith('.example')) continue;
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]*(?:TOKEN|PASSWORD|SECRET|BEARER|API_KEY))=(.*)$/.exec(
      line.trim(),
    );
    if (!match) continue;
    const value = match[2].trim();
    if (value && !/^(?:replace|example|dummy|test|changeme|<)/i.test(value)) {
      failures.push(`${path}: ${match[1]} must be empty or an obvious placeholder`);
    }
  }
}

const packageJson = JSON.parse(
  readFileSync(resolve(projectRoot, 'package.json'), 'utf8'),
);
if (packageJson.license !== 'MIT') {
  failures.push('package.json: license must agree with the root MIT licence');
}

const lock = JSON.parse(
  readFileSync(resolve(projectRoot, 'package-lock.json'), 'utf8'),
);
const missingLicences = [];
const prohibitedLicences = [];
for (const [path, metadata] of Object.entries(lock.packages ?? {})) {
  if (!path) continue;
  if (typeof metadata.license !== 'string' || !metadata.license.trim()) {
    missingLicences.push(path);
    continue;
  }
  if (/\b(?:AGPL|SSPL|BUSL)\b|Commons Clause|Elastic License/i.test(metadata.license)) {
    prohibitedLicences.push(`${path} (${metadata.license})`);
  }
}
if (missingLicences.length) {
  failures.push(`package-lock.json: ${missingLicences.length} packages omit licence metadata`);
}
if (prohibitedLicences.length) {
  failures.push(
    `package-lock.json: review prohibited/restricted licences: ${prohibitedLicences.join(', ')}`,
  );
}

const requiredLicenceFiles = [
  'LICENSE',
  'modules/t1arc-backup-crypto/LICENSE',
  'modules/t1arc-food-label/LICENSE',
  'modules/t1arc-glooko-export/LICENSE',
  'modules/t1arc-glucose-display/LICENSE',
  'modules/t1arc-health-connect/LICENSE',
  'modules/t1arc-notification-source/LICENSE',
];
for (const path of requiredLicenceFiles) {
  if (!paths.includes(path)) failures.push(`${path}: required licence file is not present`);
}

if (failures.length) {
  console.error('Public-repository check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  const licenceCount = Object.keys(lock.packages ?? {}).length - 1;
  console.log(
    `Public-repository check passed: ${paths.length} proposed paths, zero high-confidence secret/artifact hits, and ${licenceCount} dependency licence records present.`,
  );
}
