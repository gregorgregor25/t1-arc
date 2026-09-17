import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(projectRoot, 'src');

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')
      ? [path]
      : [];
  });
}

function isInsideSource(path) {
  const pathFromSource = relative(sourceRoot, path);
  return (
    pathFromSource !== '' &&
    pathFromSource !== '..' &&
    !pathFromSource.startsWith(`..${sep}`) &&
    !pathFromSource.startsWith(sep)
  );
}

function moduleCandidates(base) {
  if (extname(base)) return [base];
  return [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.native.ts`,
    `${base}.native.tsx`,
    `${base}.android.ts`,
    `${base}.android.tsx`,
    `${base}.web.ts`,
    `${base}.web.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
}

function resolveLocalImports(importer, specifier) {
  const base = specifier.startsWith('@/')
    ? join(sourceRoot, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(importer), specifier)
      : undefined;
  if (!base) return [];
  return moduleCandidates(base).filter(
    (candidate) =>
      existsSync(candidate) &&
      (isInsideSource(candidate) || candidate === join(projectRoot, 'App.tsx')),
  );
}

const queue = [join(projectRoot, 'index.ts')];
const visited = new Set();
while (queue.length) {
  const path = queue.pop();
  if (!path || visited.has(path)) continue;
  visited.add(path);
  const source = readFileSync(path, 'utf8');
  const staticImports = ts
    .preProcessFile(source, true, true)
    .importedFiles.map(({ fileName }) => fileName);
  const dynamicImports = [
    ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map((match) => match[1]);
  for (const specifier of new Set([...staticImports, ...dynamicImports])) {
    if (!specifier) continue;
    for (const dependency of resolveLocalImports(path, specifier)) {
      if (!visited.has(dependency)) queue.push(dependency);
    }
  }
}

const unreachable = sourceFiles(sourceRoot)
  .filter((path) => !visited.has(path))
  .map((path) => relative(projectRoot, path).replaceAll(sep, '/'))
  .sort();

if (unreachable.length) {
  console.error('Production source reachability check failed:');
  for (const path of unreachable) console.error(`- ${path}`);
  process.exitCode = 1;
} else {
  const reachableCount = [...visited].filter(isInsideSource).length;
  console.log(
    `Production source reachability check passed: ${reachableCount} source modules reachable from index.ts.`,
  );
}
