import T1ArcGlucoseDisplay from '../../modules/t1arc-glucose-display';
import sharedColors from '../../modules/t1arc-glucose-display/shared/app-colors.json';
import {
  useCallback,
  createContext,
  PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ColorSchemeName, useColorScheme } from 'react-native';

import {
  loadThemePreference,
  saveThemePreference,
} from '@/data/themePreference';
import { ACTIVE_COLOR_PALETTE } from '@/domain/appPalette';
import type { AppThemeMode } from '@/domain/themePreference';

export interface AppColors {
  background: string;
  backgroundGlow: string;
  surface: string;
  surfaceElevated: string;
  surfaceMuted: string;
  surfaceGradientStart: string;
  surfaceGradientMiddle: string;
  surfaceGradientEnd: string;
  surfaceBorder: string;
  surfaceShadow: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  primary: string;
  primaryStrong: string;
  onPrimary: string;
  accent: string;
  glucose: string;
  insulin: string;
  insulinSoft: string;
  targetBand: string;
  low: string;
  high: string;
  warning: string;
  danger: string;
  border: string;
  divider: string;
  grid: string;
  tabBar: string;
  shadow: string;
  overlay: string;
}

export interface AppTheme {
  dark: boolean;
  colors: AppColors;
  mode: AppThemeMode;
  setMode(mode: AppThemeMode): Promise<void>;
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
  };
  radius: {
    sm: number;
    md: number;
    lg: number;
    xl: number;
    pill: number;
  };
}

const mineralLightColors: AppColors = sharedColors.mineralLight;

const mineralDarkColors: AppColors = sharedColors.mineralDark;

const editorialLightColors: AppColors = sharedColors.editorialLight;

const editorialDarkColors: AppColors = sharedColors.editorialDark;

const colorPalettes = {
  editorial: {
    light: editorialLightColors,
    dark: editorialDarkColors,
  },
  mineral: {
    light: mineralLightColors,
    dark: mineralDarkColors,
  },
};

const activeColors = colorPalettes[ACTIVE_COLOR_PALETTE];

function makeTheme(
  scheme: ColorSchemeName,
  mode: AppThemeMode,
  setMode: (mode: AppThemeMode) => Promise<void>,
): AppTheme {
  const dark = scheme === 'dark';
  return {
    dark,
    colors: dark ? activeColors.dark : activeColors.light,
    mode,
    setMode,
    spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
    radius: { sm: 8, md: 13, lg: 17, xl: 22, pill: 999 },
  };
}

const missingProvider = async () => undefined;
const ThemeContext = createContext<AppTheme>(
  makeTheme('light', 'system', missingProvider),
);

export function AppThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<AppThemeMode>('system');

  useEffect(() => {
    let active = true;
    void loadThemePreference().then((savedMode) => {
      if (active) setModeState(savedMode);
    });
    return () => {
      active = false;
    };
  }, []);

  const setMode = useCallback(async (nextMode: AppThemeMode) => {
    setModeState(nextMode);
    await saveThemePreference(nextMode);
  }, []);

  const scheme = mode === 'system' ? systemScheme : mode;
  const theme = useMemo(
    () => makeTheme(scheme, mode, setMode),
    [mode, scheme, setMode],
  );
  useEffect(() => {
    void T1ArcGlucoseDisplay.setWidgetThemeAsync?.(mode, ACTIVE_COLOR_PALETTE).catch(() => undefined);
  }, [mode]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  return useContext(ThemeContext);
}
