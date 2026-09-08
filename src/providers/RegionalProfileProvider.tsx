import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { AppStartupScreen } from '@/components/AppStartupScreen';

import {
  observeRegionalProfile,
  saveRegionalProfile,
} from '@/data/regionalProfile';
import {
  DEFAULT_REGIONAL_PROFILE,
  deviceRegionalContext,
  resolveRegionalDefaults,
  type T1ArcDeviceRegionalContext,
  type T1ArcRegionalDefaults,
  type T1ArcRegionalProfile,
} from '@/domain/regionalProfile';
import T1ArcGlucoseDisplay from '../../modules/t1arc-glucose-display';
import T1ArcGlookoExport from '../../modules/t1arc-glooko-export';

interface RegionalProfileContextValue {
  profile: T1ArcRegionalProfile;
  defaults: T1ArcRegionalDefaults;
  ready: boolean;
  save(profile: T1ArcRegionalProfile): Promise<T1ArcRegionalProfile>;
}

const RegionalProfileContext = createContext<RegionalProfileContextValue | undefined>(
  undefined,
);

function sameDeviceContext(
  left: T1ArcDeviceRegionalContext,
  right: T1ArcDeviceRegionalContext,
) {
  return left.locale === right.locale && left.timeZone === right.timeZone;
}

export function RegionalProfileProvider({ children }: PropsWithChildren) {
  const [profile, setProfile] = useState<T1ArcRegionalProfile>(
    DEFAULT_REGIONAL_PROFILE,
  );
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<Error>();
  const [deviceContext, setDeviceContext] = useState(deviceRegionalContext);
  const defaults = useMemo(
    () => resolveRegionalDefaults(profile, deviceContext),
    [deviceContext, profile],
  );

  useEffect(
    () =>
      observeRegionalProfile(
        (next) => {
          setProfile(next);
          setReady(true);
        },
        (error) => {
          setLoadError(
            error instanceof Error
              ? error
              : new Error('Regional preferences could not be loaded.'),
          );
        },
      ),
    [],
  );

  useEffect(() => {
    const refreshDeviceContext = () => {
      const next = deviceRegionalContext();
      setDeviceContext((current) =>
        sameDeviceContext(current, next) ? current : next,
      );
    };
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshDeviceContext();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!ready) return;
    void T1ArcGlucoseDisplay.setRegionalDisplayPreferencesAsync(
      defaults.glucoseUnit,
      defaults.locale,
      defaults.timeZone,
    ).catch(() => {
      // The regional profile remains authoritative in JS. A native surface
      // that is unavailable on this platform must not block the app UI.
    });
    void T1ArcGlookoExport.setRegionalPreferencesAsync(
      defaults.timeZone,
      defaults.glookoRegion,
    ).catch(() => {
      // The Glooko connector is Android-only and must not block shared UI.
    });
  }, [
    defaults.glookoRegion,
    defaults.glucoseUnit,
    defaults.locale,
    defaults.timeZone,
    ready,
  ]);

  const value = useMemo<RegionalProfileContextValue>(
    () => ({
      profile,
      defaults,
      ready,
      save: saveRegionalProfile,
    }),
    [defaults, profile, ready],
  );

  // Surface storage failures through the app recovery boundary instead of
  // leaving the user on an indefinite loading screen or mounting regional
  // consumers with defaults that may disagree with their stored profile.
  if (loadError) throw loadError;

  return (
    <RegionalProfileContext.Provider value={value}>
      {ready ? children : <AppStartupScreen />}
    </RegionalProfileContext.Provider>
  );
}

export function useRegionalProfile() {
  const value = useContext(RegionalProfileContext);
  if (!value) {
    throw new Error('useRegionalProfile must be used inside RegionalProfileProvider.');
  }
  return value;
}
