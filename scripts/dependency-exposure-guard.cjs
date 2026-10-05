'use strict';

// Loaded with NODE_OPTIONS only while generating the Android release bundle.
// The audit exception is valid only if neither vulnerable dependency executes
// the affected operations. Each attempt is fsynced before it is rejected, so
// callers cannot hide an attempted use by catching the thrown error.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const { threadId } = require('node:worker_threads');

const stage = process.env.T1ARC_EXPOSURE_STAGE;
const directory = process.env.T1ARC_EXPOSURE_DIR;
if (!stage || !/^[a-z][a-z0-9-]{0,63}$/.test(stage)) {
  throw new Error('Dependency exposure guard requires a valid T1ARC_EXPOSURE_STAGE');
}
if (!directory || !path.isAbsolute(directory)) {
  throw new Error('Dependency exposure guard requires an absolute T1ARC_EXPOSURE_DIR');
}
// The release gate needs evidence from the process that really runs Metro,
// rather than just a configuration helper that happened to inherit NODE_OPTIONS.
const expoPackage = require.resolve('expo/package.json');
const pinnedCli = require.resolve('@expo/cli', { paths: [expoPackage] });
let isAndroidEmbed = false;
try {
  const argumentsAfterCli = process.argv.slice(2);
  const platformIndex = argumentsAfterCli.indexOf('--platform');
  isAndroidEmbed = fs.realpathSync(process.argv[1]) === fs.realpathSync(pinnedCli) &&
    argumentsAfterCli[0] === 'export:embed' &&
    platformIndex >= 0 && argumentsAfterCli[platformIndex + 1] === 'android';
} catch {
  // A missing main script is an ordinary helper process, never a bundler.
}
fs.mkdirSync(directory, { recursive: true });
const session = crypto.randomUUID();
const reportPath = path.join(directory, `${stage}-${process.pid}-${threadId}-${session}.jsonl`);
const fd = fs.openSync(reportPath, 'wx', 0o600);
let sequence = 0;
const report = (type, operation, extra = {}) => {
  const record = {
    schema: 1,
    session,
    stage,
    pid: process.pid,
    threadId,
    sequence: ++sequence,
    type,
    ...(operation ? { operation } : {}),
    ...extra,
  };
  fs.writeSync(fd, `${JSON.stringify(record)}\n`);
  fs.fsyncSync(fd);
};
report('start', undefined, { role: isAndroidEmbed ? 'android-embed' : 'other' });
process.on('exit', code => {
  try {
    report('finish', undefined, { exitCode: code });
  } finally {
    fs.closeSync(fd);
  }
});

const deny = operation => function blockedDependencyOperation() {
  // Never record arguments, stack traces, source paths, keys, or file content.
  report('blocked', operation);
  throw new Error(`T1ARC_DEPENDENCY_EXPOSURE_BLOCKED:${operation}`);
};

const deniedFunctions = new Map();
const denied = operation => {
  if (!deniedFunctions.has(operation)) deniedFunctions.set(operation, deny(operation));
  return deniedFunctions.get(operation);
};

const originalLoad = Module._load;
const wrappedExports = new WeakMap();
const braceOperations = new Map([
  ['index.js', 'braces.call'],
  ['lib/parse.js', 'braces.parse'],
  ['lib/compile.js', 'braces.compile'],
  ['lib/expand.js', 'braces.expand'],
  ['lib/stringify.js', 'braces.stringify'],
]);

function wrapBraces(filename, result) {
  const relative = filename.split('/node_modules/braces/').pop();
  const operation = braceOperations.get(relative);
  if (!operation || typeof result !== 'function') return result;
  if (wrappedExports.has(result)) return wrappedExports.get(result);
  const wrapped = denied(operation);
  if (relative === 'index.js') {
    for (const method of ['parse', 'compile', 'expand', 'stringify', 'create']) {
      wrapped[method] = denied(`braces.${method}`);
    }
  }
  wrappedExports.set(result, wrapped);
  return wrapped;
}

function patchForge(filename, result) {
  if (!result || typeof result !== 'object') return result;
  const forgeFile = path.join(path.dirname(filename), 'forge.js');
  const forge = require.cache[forgeFile]?.exports;
  const pki = forge?.pki;
  if (pki?.rsa && typeof pki.rsa.setPublicKey === 'function') {
    pki.rsa.setPublicKey = denied('forge.rsa.setPublicKey');
  }
  if (pki) {
    for (const method of ['setRsaPublicKey', 'publicKeyFromAsn1', 'publicKeyFromPem', 'publicKeyFromJwk']) {
      if (typeof pki[method] === 'function') pki[method] = denied(`forge.pki.${method}`);
    }
  }
  return result;
}

Module._load = function guardedLoad(request, parent, isMain) {
  let filename;
  try {
    filename = Module._resolveFilename(request, parent, isMain);
  } catch {
    // Preserve Node's ordinary module resolution error below.
  }
  const normalized = typeof filename === 'string' ? filename.replaceAll('\\', '/') : '';
  if (normalized.includes('/node_modules/node-forge/') &&
      !normalized.includes('/node_modules/node-forge/lib/') &&
      !normalized.endsWith('/node_modules/node-forge/package.json')) {
    // The distributed browser bundle has independent copies of Forge's RSA
    // implementation. It cannot be instrumented through the CommonJS hooks.
    report('blocked', 'forge.unsupportedEntrypoint');
    throw new Error('T1ARC_DEPENDENCY_EXPOSURE_BLOCKED:forge.unsupportedEntrypoint');
  }
  const result = originalLoad.apply(this, arguments);
  if (typeof filename !== 'string') return result;
  if (normalized.includes('/node_modules/braces/')) return wrapBraces(normalized, result);
  if (normalized.includes('/node_modules/node-forge/lib/')) return patchForge(normalized, result);
  return result;
};
