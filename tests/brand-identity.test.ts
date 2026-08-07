import {
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

function filesUnder(directory: string): string[] {
  if (!statSync(directory, { throwIfNoEntry: false })) return [];
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = path.join(directory, entry);
    if (entry === 'build' || entry === 'node_modules') return [];
    return statSync(fullPath).isDirectory()
      ? filesUnder(fullPath)
      : [fullPath];
  });
}

function text(file: string) {
  return readFileSync(file, 'utf8');
}

function userVisibleAndroidStrings() {
  return [
    ...filesUnder(path.join(root, 'android', 'app', 'src', 'main', 'res')),
    ...filesUnder(path.join(root, 'modules')),
    ...filesUnder(path.join(root, 'wear')),
  ].filter(
    (file) =>
      file.endsWith(`${path.sep}values${path.sep}strings.xml`) &&
      file.includes(`${path.sep}src${path.sep}main${path.sep}`),
  );
}

describe('T1 Arc product identity', () => {
  it('uses T1 Arc as the installed phone and Expo product name', () => {
    const appConfig = JSON.parse(
      text(path.join(root, 'app.json')),
    ) as {
      expo: { name: string; description: string };
    };
    const androidStrings = text(
      path.join(
        root,
        'android',
        'app',
        'src',
        'main',
        'res',
        'values',
        'strings.xml',
      ),
    );

    expect(appConfig.expo.name).toBe('T1 Arc');
    expect(appConfig.expo.description).toContain('Type 1 diabetes');
    expect(androidStrings).toContain(
      '<string name="app_name">T1 Arc</string>',
    );
  });

  it('keeps Expo, npm and native Android release versions aligned', () => {
    const appConfig = JSON.parse(
      text(path.join(root, 'app.json')),
    ) as {
      expo: {
        version: string;
        android: { versionCode: number };
      };
    };
    const packageConfig = JSON.parse(
      text(path.join(root, 'package.json')),
    ) as { version: string };
    const androidGradle = text(
      path.join(root, 'android', 'app', 'build.gradle'),
    );
    const nativeVersionName = androidGradle.match(
      /\bversionName\s+["']([^"']+)["']/,
    )?.[1];
    const nativeVersionCode = Number(
      androidGradle.match(/\bversionCode\s+(\d+)/)?.[1],
    );

    expect(appConfig.expo.version).toBe(packageConfig.version);
    expect(nativeVersionName).toBe(packageConfig.version);
    expect(appConfig.expo.android.versionCode).toBe(nativeVersionCode);
  });

  it('keeps old branding out of user-visible Android and Wear strings', () => {
    const offenders = userVisibleAndroidStrings().flatMap((file) => {
      const values = [
        ...text(file).matchAll(/<string\b[^>]*>([\s\S]*?)<\/string>/g),
      ].map((match) => match[1] ?? '');
      return values.some((value) => /\bdaymark\b/i.test(value))
        ? [path.relative(root, file)]
        : [];
    });

    expect(offenders).toEqual([]);
  });

  it('keeps old branding out of rendered phone and Wear copy', () => {
    const renderedSourceFiles = [
      ...filesUnder(path.join(root, 'src', 'components')),
      ...filesUnder(path.join(root, 'src', 'screens')),
      ...filesUnder(path.join(root, 'plugins')),
      ...filesUnder(
        path.join(root, 'wear', 'companion', 'src', 'main', 'java'),
      ),
    ].filter(
      (file) =>
        file.endsWith('.tsx') ||
        file.endsWith('.ts') ||
        file.endsWith('.kt') ||
        file.endsWith('.js'),
    );
    const oldBrandLiteral =
      /(["'`])(?:\\.|(?!\1)[^\\\r\n])*?\b(?:Daymark|DAYMARK)\b(?:\\.|(?!\1)[^\\\r\n])*?\1/g;
    const offenders = renderedSourceFiles.flatMap((file) => {
      const matches = [...text(file).matchAll(oldBrandLiteral)].map(
        (match) => match[0],
      );
      return matches.length
        ? [`${path.relative(root, file)}: ${matches.join(', ')}`]
        : [];
    });

    expect(offenders).toEqual([]);
  });

  it('uses T1 Arc throughout product documentation', () => {
    const productDocuments = [
      path.join(root, 'README.md'),
      ...filesUnder(path.join(root, 'docs')).filter((file) =>
        file.endsWith('.md'),
      ),
      path.join(root, 'design-system', 'daymark', 'MASTER.md'),
    ];
    const offenders = productDocuments.flatMap((file) =>
      /\b(?:Daymark|DAYMARK)\b/.test(text(file))
        ? [path.relative(root, file)]
        : [],
    );

    expect(text(path.join(root, 'README.md'))).toMatch(/^# T1 Arc\b/);
    expect(offenders).toEqual([]);
  });
});
