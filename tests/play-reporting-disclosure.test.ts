import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('offers response reporting in the conversation without an external mail composer', () => {
  const screen = readFileSync('src/screens/TarvisScreen.tsx', 'utf8');
  const form = readFileSync('src/components/TarvisReportButton.tsx', 'utf8');
  expect(screen).toContain('<TarvisReportButton');
  expect(form).toContain('I have reviewed this report and agree');
  expect(form).toContain('Include response for me to review');
  expect(form).toContain("setText('')");
  expect(form).not.toContain('mailto:');
  expect(form).not.toContain('Linking.openURL');
});

it('explains optional accessibility access before enabling AOD and does not assume sideloading', () => {
  const source = readFileSync('src/components/GlucoseDisplayCard.tsx', 'utf8');
  expect(source).toContain('does not read text from other apps');
  expect(source).toContain('other app features work without it');
  expect(source).toContain('Agree and open settings');
  expect(source).toContain('Do not uninstall the app or clear its data');
  expect(source).not.toContain('Because this APK was installed outside Google Play');
});
