import {
  DEFAULT_REGIONAL_PROFILE,
  resolveRegionalDefaults,
  type T1ArcRegionalProfile,
} from './regionalProfile';

let runtimeProfile: T1ArcRegionalProfile = { ...DEFAULT_REGIONAL_PROFILE };

export function getRuntimeRegionalProfile() {
  return runtimeProfile;
}

export function getRuntimeRegionalDefaults() {
  return resolveRegionalDefaults(runtimeProfile);
}

export function getRuntimeAnalysisTimeZone() {
  return getRuntimeRegionalDefaults().timeZone;
}

export function getRuntimeLocale() {
  return getRuntimeRegionalDefaults().locale;
}

export function setRuntimeRegionalProfile(profile: T1ArcRegionalProfile) {
  runtimeProfile = profile;
}
