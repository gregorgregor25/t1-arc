import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';

it('keeps Play preparation explicit, pinned, signed and non-publishing', () => {
  const script = readFileSync('scripts/prepare-play-bundles.ps1', 'utf8');
  expect(script).toContain('a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29');
  expect(script).toContain('Play candidates require a clean, committed source tree');
  expect(script).toContain('Source changed during packaging');
  expect(script).toContain('Private-test signing is not allowed');
  expect(script).toContain('Unexpected signing certificate. Do not upload.');
  expect(script).toContain('Phone and Wear need distinct Play version codes.');
  expect(script).toContain('Refusing to replace');
  expect(script).toContain('Keep at least 20 GiB free');
  expect(script).toContain('contains unsigned entries');
  expect(script).toContain('Release family version mismatch');
  expect(script).toContain('Debug or test-only bundle');
  expect(script).toContain("jarsigner '-J-Duser.language=en'");
  expect(script).toContain("keytool '-J-Duser.language=en'");
  expect(script).not.toContain('gh release create');
  expect(script).not.toContain('internalappsharing');
});

it('gates release quality on report-service tests without deployment credentials', () => {
  const require = createRequire(import.meta.url);
  const { load } = require('js-yaml') as {load(text: string): {jobs: Record<string, {steps: {run?:string; env?:unknown}[]}>}};
  const workflow = load(readFileSync('.github/workflows/quality.yml', 'utf8'));
  const job = workflow.jobs['private-report-service']!;
  expect(job.steps.some(step => step.run === 'npm test')).toBe(true);
  expect(job.steps.some(step => step.run === 'npx wrangler deploy --dry-run')).toBe(true);
  expect(JSON.stringify(job)).not.toContain('secrets.');
});

it('reserves distinct phone and companion codes from one release source', () => {
  const app = JSON.parse(readFileSync('app.json', 'utf8')).expo;
  expect(app.android.versionCode).toBeGreaterThanOrEqual(30);
  expect(app.android.versionCode % 2).toBe(0);
  const policy = readFileSync('scripts/gradle/t1arc-release-version.gradle', 'utf8');
  expect(policy).toContain('phoneCode + 1');
  for (const module of ['companion', 'watchface-meridian', 'watchface-chronograph', 'watchface-atelier', 'watchface-pace', 'watchface-summit', 'watchface-push']) {
    const gradle = readFileSync(`wear/${module}/build.gradle`, 'utf8');
    expect(gradle).toContain('t1arc-release-version.gradle');
    expect(gradle).toContain('versionName t1ArcReleaseVersionName');
  }
});
