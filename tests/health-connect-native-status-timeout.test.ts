import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const nativeModule = readFileSync(new URL('../modules/t1arc-health-connect/android/src/main/java/io/github/gregorgregor25/t1arc/healthconnect/T1ArcHealthConnectModule.kt', import.meta.url), 'utf8');

describe('native Health Connect permission-status boundary', () => {
  it('bounds only the read-only status query and reports a timeout as an error', () => {
    const status = nativeModule.slice(nativeModule.indexOf('private suspend fun statusFor('), nativeModule.indexOf('private fun recordTypesFor('));
    expect(nativeModule).toContain('private const val PERMISSION_STATUS_TIMEOUT_MS = 10_000L');
    expect(status).toMatch(/withTimeoutOrNull\(PERMISSION_STATUS_TIMEOUT_MS\)\s*\{\s*client\.permissionController\.getGrantedPermissions\(\)\s*\}\s*\?: throw IllegalStateException\("Health Connect did not respond\. Please try again\."\)/);
    expect(nativeModule.match(/withTimeoutOrNull\(/g)).toHaveLength(1);
  });

  it('does not replace a timed-out permission response with an empty or granted set', () => {
    const query = nativeModule.slice(nativeModule.indexOf('val granted = withTimeoutOrNull'), nativeModule.indexOf('  val categories =', nativeModule.indexOf('val granted = withTimeoutOrNull')));
    expect(query).not.toMatch(/emptySet|emptyList|setOf|mapOf/);
    expect(query).toContain('throw IllegalStateException');
  });
});
