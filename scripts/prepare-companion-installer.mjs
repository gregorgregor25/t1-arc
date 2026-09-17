import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: Object.fromEntries(
  ['apk', 'package', 'certificate', 'version', 'version-name', 'analyzer', 'signer', 'output'].map(key => [key, { type: 'string' }])) });
for (const key of ['apk', 'package', 'certificate', 'version', 'version-name', 'analyzer', 'signer', 'output']) {
  if (!values[key]) throw new Error(`Missing ${key}`);
}
const analyze = (...args) => execFileSync('java', ['-Dcom.android.sdklib.toolsdir=' + path.dirname(path.dirname(values.analyzer)), '-cp', values.analyzer,
  'com.android.tools.apk.analyzer.ApkAnalyzerCli', ...args, values.apk], { encoding: 'utf8' }).trim();
const packageName = analyze('manifest', 'application-id');
const versionCode = Number(analyze('manifest', 'version-code'));
const versionName = analyze('manifest', 'version-name');
const minSdk = Number(analyze('manifest', 'min-sdk'));
const manifest = analyze('manifest', 'print');
const signatures = execFileSync('java', ['-jar', values.signer, 'verify', '--print-certs', values.apk], { encoding: 'utf8' });
const certificates = [...signatures.matchAll(/certificate SHA-256 digest: ([a-f0-9]+)/gi)].map(match => match[1].toLowerCase());
if (packageName !== values.package || versionCode !== Number(values.version) || versionName !== values['version-name'] ||
    !certificates.length || certificates.some(cert => cert !== values.certificate.toLowerCase()) ||
    !manifest.includes('android.hardware.type.watch')) throw new Error('Bundled companion identity verification failed.');
const sha256 = createHash('sha256').update(readFileSync(values.apk)).digest('hex');
const output = path.join(values.output, 'watch-installer');
mkdirSync(output, { recursive: true });
copyFileSync(values.apk, path.join(output, 'companion.apk'));
writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ packageName, versionCode, versionName, minSdk,
  certificateSha256: values.certificate.toLowerCase(), sha256 }, null, 2));
console.log(`Verified companion ${packageName} ${versionName} (${versionCode}), SHA-256 ${sha256}`);
