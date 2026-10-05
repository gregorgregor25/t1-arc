#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

// Verify the evidence produced by dependency-exposure-guard.cjs for one fresh
// Android build. The map check is independent of the execution guard: build
// tools may load a package without calling the guarded functions.
function fail(message) {
  throw new Error(`Dependency exposure verification failed: ${message}`);
}

const values = { stages: [] };
for (let index = 2; index < process.argv.length; index += 2) {
  const option = process.argv[index];
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) fail(`missing value for ${option}`);
  if (option === '--evidence-dir') values.directory = value;
  else if (option === '--require-stage') values.stages.push(value);
  else if (option === '--source-map') values.sourceMap = value;
  else if (option === '--bundle') values.bundle = value;
  else fail(`unknown option ${option}`);
}
if (!values.directory || !path.isAbsolute(values.directory)) fail('an absolute --evidence-dir is required');
if (values.stages.length === 0 || values.stages.some(stage => !/^[a-z][a-z0-9-]{0,63}$/.test(stage))) {
  fail('at least one valid --require-stage is required');
}
if (new Set(values.stages).size !== values.stages.length) fail('duplicate required stage');
if (Boolean(values.sourceMap) !== Boolean(values.bundle)) fail('--source-map and --bundle must be supplied together');

const expected = new Set(values.stages);
const encountered = new Set();
const confirmedEmbeds = new Set();
let reports = 0;
let blocked = 0;
let files;
try {
  files = fs.readdirSync(values.directory, { withFileTypes: true });
} catch {
  fail('evidence directory is missing');
}
if (files.length === 0) fail('evidence directory is empty');
for (const entry of files) {
  if (!entry.isFile() || !entry.name.endsWith('.jsonl')) fail(`unexpected evidence entry ${entry.name}`);
  const file = path.join(values.directory, entry.name);
  let lines;
  try {
    const content = fs.readFileSync(file, 'utf8');
    if (!content.endsWith('\n')) fail(`incomplete report ${entry.name}`);
    lines = content.trimEnd().split('\n').map(line => JSON.parse(line));
  } catch (error) {
    if (error.message.startsWith('Dependency exposure verification failed:')) throw error;
    fail(`malformed report ${entry.name}`);
  }
  if (lines.length < 2) fail(`incomplete report ${entry.name}`);
  const first = lines[0];
  if (!first || first.type !== 'start' || first.sequence !== 1 || first.schema !== 1 ||
      !['android-embed', 'other'].includes(first.role)) fail(`invalid start ${entry.name}`);
  const { stage, session, pid, threadId } = first;
  if (!expected.has(stage)) fail(`unexpected stage ${stage}`);
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(threadId) || threadId < 0 ||
      !/^[a-f0-9-]{36}$/.test(session) || entry.name !== `${stage}-${pid}-${threadId}-${session}.jsonl`) {
    fail(`invalid report identity ${entry.name}`);
  }
  for (let i = 0; i < lines.length; i++) {
    const row = lines[i];
    if (!row || row.schema !== 1 || row.stage !== stage || row.session !== session || row.pid !== pid ||
        row.threadId !== threadId || row.sequence !== i + 1) fail(`inconsistent report ${entry.name}`);
    if (i > 0 && i < lines.length - 1) {
      if (row.type !== 'blocked' || !/^(braces|forge)(?:\.[A-Za-z]+)+$/.test(row.operation)) {
        fail(`unexpected event in ${entry.name}`);
      }
      blocked++;
    }
  }
  const last = lines.at(-1);
  if (last.type !== 'finish' || last.exitCode !== 0) fail(`unfinished or unsuccessful process ${entry.name}`);
  encountered.add(stage);
  if (first.role === 'android-embed') confirmedEmbeds.add(stage);
  reports++;
}
for (const stage of expected) if (!encountered.has(stage)) fail(`missing stage ${stage}`);
for (const stage of ['bundle', 'signed-build']) {
  if (expected.has(stage) && !confirmedEmbeds.has(stage)) fail(`no completed Android embed process in stage ${stage}`);
}
if (blocked !== 0) fail(`${blocked} vulnerable operation attempt(s) were recorded`);

let mappedSources = 0;
if (values.sourceMap) {
  for (const [label, file] of [['source map', values.sourceMap], ['bundle', values.bundle]]) {
    try {
      if (!fs.statSync(file).isFile() || fs.statSync(file).size === 0) fail(`${label} is empty`);
    } catch (error) {
      if (error.message.startsWith('Dependency exposure verification failed:')) throw error;
      fail(`${label} is missing`);
    }
  }
  let map;
  try {
    map = JSON.parse(fs.readFileSync(values.sourceMap, 'utf8'));
  } catch {
    fail('source map is invalid JSON');
  }
  const excluded = /(?:^|\/)(?:node_modules\/)?(?:braces|node-forge|micromatch|@expo\/code-signing-certificates)(?:\/|$)/;
  const inspect = section => {
    if (!section || section.version !== 3) fail('source map has an invalid section');
    if (Array.isArray(section.sections)) {
      for (const child of section.sections) inspect(child.map);
      return;
    }
    if (!Array.isArray(section.sources)) fail('source map has no sources');
    if (section.sourceRoot !== undefined && typeof section.sourceRoot !== 'string') fail('source map has an invalid source root');
    for (const source of section.sources) {
      if (typeof source !== 'string' || !source.trim()) fail('source map has an empty or non-string source');
      const normalized = path.posix.normalize(`${section.sourceRoot || ''}/${source}`.replaceAll('\\', '/'));
      if (excluded.test(normalized)) fail(`Android bundle contains prohibited source ${normalized}`);
      mappedSources++;
    }
  };
  inspect(map);
  if (mappedSources === 0) fail('source map has no mapped sources');
}
console.log(`Dependency exposure verified: ${reports} process report(s), ${values.stages.length} stage(s), ${mappedSources} mapped source(s), zero blocked calls.`);
