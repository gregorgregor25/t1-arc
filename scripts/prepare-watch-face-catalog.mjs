import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { unzipSync } from 'fflate';

export const VALIDATOR_VERSION = '1.1.0-alpha01';
export const VALIDATOR_SHA256 = '04dc20a0994df3eaebf025e107f7589c147b2ce8a2c628745e01a5c0a63fe4dd';
export const FACE_IDS = ['meridian', 'chronograph', 'atelier', 'pace', 'summit'];
const MAX_APK_BYTES = 20 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
function check(condition, message) {
  if (!condition) throw new Error(message);
}

export function validationToken(report) {
  // The official tool can exit zero even when its checks fail.
  check(/^Validation is successful\s*$/m.test(report), 'Watch face validation did not succeed.');
  check(/^No failing checks detected, generated token: /m.test(report), 'Validator reported failing checks.');
  const matches = [...report.matchAll(/generated token: ([A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*)\s*$/gm)];
  check(matches.length === 1, 'Validator did not return exactly one validation token.');
  return matches[0][1];
}

export function certificateDigest(report) {
  const matches = [...report.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([a-f0-9]{64})\s*$/gm)];
  check(matches.length === 1, 'Expected exactly one verified APK signer.');
  return matches[0][1];
}

export function checkFaceInfo(xml) {
  check(/<WatchFaceInfo\b/.test(xml), 'Missing watch face picker metadata.');
  const previews = [...xml.matchAll(/<Preview\b[^>]*>/g)];
  const value = previews.length === 1 ? attribute(previews[0][0], 'value') : '';
  check(previews.length === 1 && /^@(?:drawable\/[a-z0-9_]+|(?:ref\/)?0x[0-9a-f]{8})$/i.test(value),
    'Watch face picker preview is required by the runtime.');
}

function attribute(tag, name) {
  const matches = [...tag.matchAll(new RegExp('\\b' + name + '="([^"]*)"', 'g'))];
  check(matches.length === 1, 'Missing or repeated manifest attribute: ' + name);
  return matches[0][1];
}

export function faceManifest(xml, companionPackage, faceId) {
  check(FACE_IDS.includes(faceId), 'Unknown bundled face.');
  check(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(companionPackage), 'Invalid companion package.');
  const manifest = xml.match(/<manifest\b[^>]*>/)?.[0] ?? '';
  const application = xml.match(/<application\b[^>]*>/)?.[0] ?? '';
  const sdk = xml.match(/<uses-sdk\b[^>]*>/)?.[0] ?? '';
  const packageName = attribute(manifest, 'package');
  check(packageName === companionPackage + '.watchfacepush.' + faceId, 'Push face is outside the companion package.');
  check(attribute(application, 'android:hasCode') === 'false', 'Push face contains application code.');
  check(!/android:debuggable="true"/.test(application), 'Push face is debuggable.');
  check(attribute(sdk, 'android:minSdkVersion') === '33', 'Push face minimum SDK changed.');
  const properties = [...xml.matchAll(/<property\b[^>]*\/>/g)].map(([tag]) => ({
    name: attribute(tag, 'android:name'), value: attribute(tag, 'android:value'),
  }));
  const property = (name) => {
    const matches = properties.filter((item) => item.name === name);
    check(matches.length === 1, 'Missing or repeated watch face property: ' + name);
    return matches[0].value;
  };
  check(property('com.google.wear.watchface.format.version') === '1', 'Unexpected Watch Face Format version.');
  const revision = property('t1arc.face.revision');
  check(/^[0-9a-f]{16}$/.test(revision), 'Invalid face revision.');
  const versionCode = Number(attribute(manifest, 'android:versionCode'));
  check(Number.isSafeInteger(versionCode) && versionCode > 0, 'Invalid face version code.');
  return { packageName, versionCode, revision };
}

export function checkFaceArchive(bytes, companionPackage, definitionPath = 'res/raw/watchface.xml') {
  check(bytes.length > 0 && bytes.length <= MAX_APK_BYTES, 'Push APK size is outside the allowed range.');
  let expanded = 0;
  const entries = unzipSync(bytes, {
    filter: (entry) => {
      expanded += entry.originalSize;
      check(expanded <= MAX_EXPANDED_BYTES, 'Push APK expanded size is too large.');
      check(!entry.name.includes('\\') && !entry.name.split('/').some((part) => part === '..') &&
        !entry.name.startsWith('/') && !entry.name.includes('\0'), 'Unsafe APK entry path.');
      check(entry.name === 'AndroidManifest.xml' || entry.name === 'resources.arsc' ||
        entry.name.startsWith('res/') || entry.name.startsWith('META-INF/'), 'Unexpected executable or asset in Push APK.');
      return true;
    },
  });
  check(entries['AndroidManifest.xml'] && entries['resources.arsc'], 'Push APK metadata is incomplete.');
  const xml = entries[definitionPath];
  check(xml, 'Push APK has no watch face definition.');
  const providers = [...new TextDecoder().decode(xml).matchAll(/primaryProvider="([^"]+)"/g)];
  check(providers.length > 0, 'Push face has no default glucose provider.');
  check(providers.every(([, provider]) => provider.startsWith(companionPackage + '/')),
    'Push face complication providers do not match its companion.');
}

function javaOutput(java, args) {
  const result = spawnSync(java, args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  if (result.error) throw result.error;
  const report = (result.stdout ?? '') + '\n' + (result.stderr ?? '');
  check(result.status === 0, 'Watch face build check failed:\n' + report);
  return report;
}

export function prepareCatalog(options) {
  const analyze = (args) => javaOutput(options.java, [
    '-Dcom.android.sdklib.toolsdir=' + dirname(dirname(options.analyzer)),
    '-classpath', options.analyzer, 'com.android.tools.apk.analyzer.ApkAnalyzerCli', ...args,
  ]);
  check(sha256(readFileSync(options.validator)) === VALIDATOR_SHA256, 'Validator checksum does not match the pinned tool.');
  check(/^[a-f0-9]{64}$/.test(options.companionCertificate), 'Invalid companion certificate fingerprint.');
  const faces = FACE_IDS.map((id) => {
    const apk = resolve(options[id]);
    const bytes = readFileSync(apk);
    const manifest = analyze(['manifest', 'print', apk]);
    const metadata = faceManifest(manifest, options.companionPackage, id);
    // AAPT2 shortens resource filenames in release APKs. Resolve the raw
    // resource through its table rather than assuming the source filename.
    const definitionPath = analyze(['resources', 'value', '--config', 'default',
      '--name', 'watchface', '--type', 'raw', apk]).trim();
    checkFaceArchive(bytes, options.companionPackage, definitionPath);
    const infoPath = analyze(['resources', 'value', '--config', 'default',
      '--name', 'watch_face_info', '--type', 'xml', apk]).trim();
    checkFaceInfo(analyze(['resources', 'xml', '--file', infoPath, apk]));
    const signer = certificateDigest(javaOutput(options.java, ['-jar', options.signer, 'verify', '--print-certs', apk]));
    check(signer !== options.companionCertificate, 'Push faces must use a different signing certificate from the companion.');
    const report = javaOutput(options.java, ['-jar', options.validator, '--apk_path', apk,
      '--package_name', options.companionPackage]);
    const token = validationToken(report);
    return {
      bytes, id, ...metadata, apkAsset: 'watchfaces/' + id + '.apk',
      sha256: sha256(bytes), certificateSha256: signer, validationToken: token,
    };
  });
  check(new Set(faces.map((face) => face.certificateSha256)).size === 1, 'Bundled faces have different signers.');
  const catalog = {
    version: 1, companionPackage: options.companionPackage,
    companionCertificateSha256: options.companionCertificate,
    validator: { version: VALIDATOR_VERSION, sha256: VALIDATOR_SHA256 },
    faces: faces.map(({ bytes: _bytes, ...metadata }) => metadata),
  };
  const output = resolve(options.output, 'watchfaces');
  mkdirSync(output, { recursive: true });
  // Validate every artifact first. A failing face must fail the complete build.
  // Incremental builds must not accidentally distribute the retired face.
  rmSync(join(output, 'orbit.apk'), { force: true });
  for (const face of faces) writeFileSync(join(output, face.id + '.apk'), face.bytes);
  writeFileSync(join(output, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
  for (const face of faces) process.stdout.write('Validated Push face ' + face.id + ': ' + face.sha256 + '\n');
  return catalog;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const names = ['java', 'analyzer', 'signer', 'validator', 'companion-package',
    'companion-certificate', 'output', ...FACE_IDS];
  const { values } = parseArgs({ options: Object.fromEntries(names.map((name) => [name, { type: 'string' }])) });
  for (const name of names) check(values[name], 'Missing required argument: --' + name);
  prepareCatalog({ ...values, companionPackage: values['companion-package'], companionCertificate: values['companion-certificate'] });
}
