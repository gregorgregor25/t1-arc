import * as Application from 'expo-application';

import type { InstalledAppIdentity } from './publicRelease';

/** This installation's package, version and version code, as Android reports them. */
export function thisInstalledApp(): InstalledAppIdentity {
  return {
    applicationId: Application.applicationId,
    version: Application.nativeApplicationVersion,
    buildNumber: Application.nativeBuildVersion,
  };
}
