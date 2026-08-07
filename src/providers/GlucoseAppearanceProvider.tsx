import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import DaymarkGlucoseDisplay from '../../modules/daymark-glucose-display';
import {
  DEFAULT_GLUCOSE_APPEARANCE,
  GlucoseAppearanceSettings,
  validateGlucoseAppearance,
} from '@/domain/glucoseAppearance';

interface GlucoseAppearanceContextValue {
  settings: GlucoseAppearanceSettings;
  ready: boolean;
  save(settings: GlucoseAppearanceSettings): Promise<void>;
  reload(): Promise<void>;
}

const GlucoseAppearanceContext =
  createContext<GlucoseAppearanceContextValue | undefined>(undefined);

export function GlucoseAppearanceProvider({ children }: PropsWithChildren) {
  const [settings, setSettings] = useState(DEFAULT_GLUCOSE_APPEARANCE);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    const stored = await DaymarkGlucoseDisplay.getAppearanceSettingsAsync();
    if (validateGlucoseAppearance(stored)) return;
    setSettings(stored);
  }, []);

  useEffect(() => {
    let active = true;
    void DaymarkGlucoseDisplay.getAppearanceSettingsAsync()
      .then((stored) => {
        if (!active || validateGlucoseAppearance(stored)) return;
        setSettings(stored);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const save = useCallback(async (next: GlucoseAppearanceSettings) => {
    const error = validateGlucoseAppearance(next);
    if (error) throw new Error(error);
    const stored = await DaymarkGlucoseDisplay.setAppearanceSettingsAsync(next);
    setSettings(stored);
  }, []);

  const value = useMemo(
    () => ({ settings, ready, reload, save }),
    [ready, reload, save, settings],
  );

  return (
    <GlucoseAppearanceContext.Provider value={value}>
      {children}
    </GlucoseAppearanceContext.Provider>
  );
}

export function useGlucoseAppearance() {
  const context = useContext(GlucoseAppearanceContext);
  if (!context) {
    throw new Error(
      'useGlucoseAppearance must be used inside GlucoseAppearanceProvider.',
    );
  }
  return context;
}
