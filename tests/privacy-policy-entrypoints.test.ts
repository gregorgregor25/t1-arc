import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('public privacy policy entry points', () => {
  it.each(['src/components/AppInfoCard.tsx', 'src/screens/SourcesScreen.tsx', 'src/components/TarvisReportButton.tsx'])('is accessible from %s', path => {
    expect(readFileSync(path, 'utf8')).toContain('<PrivacyPolicyLink />');
  });
  it('opens the same HTTPS policy and handles a missing browser without failing the screen', () => {
    const source = readFileSync('src/components/PrivacyPolicyLink.tsx', 'utf8');
    expect(source).toContain("'https://t1arc.com/privacy/'");
    expect(source).toContain('accessibilityRole="link"');
    expect(source).toContain('await Linking.openURL(PRIVACY_POLICY_URL)');
    expect(source).toContain('catch { Alert.alert');
    expect(source).toContain('minHeight: 48');
  });
  it('shows Health Connect users the policy and optional off-device boundaries without needing React', () => {
    const source = readFileSync('modules/t1arc-health-connect/android/src/main/java/io/github/gregorgregor25/t1arc/healthconnect/HealthPermissionsRationaleActivity.kt', 'utf8');
    expect(source).toContain('https://t1arc.com/privacy/');
    expect(source).toContain('directly to OpenAI');
    expect(source).toContain('explicitly agree to share');
    expect(source).toContain('ActivityNotFoundException');
  });
});
