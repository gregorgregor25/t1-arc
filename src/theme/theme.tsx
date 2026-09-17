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

const mineralLightColors: AppColors = {
  background: '#F1F8FA',
  backgroundGlow: '#E1F1F3',
  surface: '#FFFFFF',
  surfaceElevated: '#FAFDFD',
  surfaceMuted: '#E8F1F3',
  surfaceGradientStart: '#FFFFFF',
  surfaceGradientMiddle: '#F9FCFC',
  surfaceGradientEnd: '#F2F8F9',
  surfaceBorder: '#D5E4E7',
  surfaceShadow: '#0C3340',
  text: '#102B34',
  textSecondary: '#46636D',
  textTertiary: '#5C727A',
  primary: '#087F99',
  primaryStrong: '#06667B',
  onPrimary: '#FFFFFF',
  accent: '#087A5C',
  glucose: '#087F99',
  insulin: '#255DA8',
  insulinSoft: '#E7EFFA',
  targetBand: '#DDF2F5',
  low: '#B74F64',
  high: '#98520A',
  warning: '#8A4B08',
  danger: '#B4233A',
  border: '#D8E3E6',
  divider: '#E5EEF0',
  grid: '#D6E2E5',
  tabBar: '#F9FCFD',
  shadow: '#0F2B33',
  overlay: 'rgba(4, 24, 30, 0.58)',
};

const mineralDarkColors: AppColors = {
  background: '#071519',
  backgroundGlow: '#0A3038',
  surface: '#102328',
  surfaceElevated: '#153038',
  surfaceMuted: '#193137',
  surfaceGradientStart: '#173239',
  surfaceGradientMiddle: '#10262B',
  surfaceGradientEnd: '#0C1D21',
  surfaceBorder: '#29454C',
  surfaceShadow: '#000000',
  text: '#F2FAFB',
  textSecondary: '#B7CDD2',
  textTertiary: '#86A3AA',
  primary: '#65D2E7',
  primaryStrong: '#8AE2EF',
  onPrimary: '#071519',
  accent: '#69D5AC',
  glucose: '#65D2E7',
  insulin: '#82B7FF',
  insulinSoft: '#172F49',
  targetBand: '#12373D',
  low: '#FF9BAE',
  high: '#F1B66F',
  warning: '#F1B66F',
  danger: '#FF9BAE',
  border: '#29454C',
  divider: '#1D363C',
  grid: '#274149',
  tabBar: '#08171B',
  shadow: '#000000',
  overlay: 'rgba(0, 0, 0, 0.76)',
};

const editorialLightColors: AppColors = {
  background: '#F5F1EA',
  backgroundGlow: '#E5E9F8',
  surface: '#FFFDF9',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#ECE7DE',
  surfaceGradientStart: '#FFFFFF',
  surfaceGradientMiddle: '#FCF9F4',
  surfaceGradientEnd: '#F4EFE7',
  surfaceBorder: '#DDD4C8',
  surfaceShadow: '#322A24',
  text: '#1B1D24',
  textSecondary: '#50535E',
  textTertiary: '#6A6C75',
  primary: '#3156B8',
  primaryStrong: '#24449A',
  onPrimary: '#FFFFFF',
  accent: '#527038',
  glucose: '#3156B8',
  insulin: '#B85A2A',
  insulinSoft: '#F5E2D4',
  targetBand: '#E1E7FA',
  low: '#B72D4B',
  high: '#92520B',
  warning: '#8A4B07',
  danger: '#B4233E',
  border: '#DDD5CB',
  divider: '#E8E1D8',
  grid: '#DAD3CA',
  tabBar: '#FAF7F1',
  shadow: '#2D2925',
  overlay: 'rgba(23, 21, 24, 0.62)',
};

const editorialDarkColors: AppColors = {
  background: '#111217',
  backgroundGlow: '#202B59',
  surface: '#1B1D24',
  surfaceElevated: '#252731',
  surfaceMuted: '#2D303A',
  surfaceGradientStart: '#292C36',
  surfaceGradientMiddle: '#20222A',
  surfaceGradientEnd: '#181A20',
  surfaceBorder: '#3F424E',
  surfaceShadow: '#000000',
  text: '#F8F5EE',
  textSecondary: '#C4C1BC',
  textTertiary: '#9B9AA0',
  primary: '#8EA7FF',
  primaryStrong: '#B8C7FF',
  onPrimary: '#141826',
  accent: '#A7C978',
  glucose: '#8EA7FF',
  insulin: '#F0A06A',
  insulinSoft: '#392A23',
  targetBand: '#26345A',
  low: '#FF8DA2',
  high: '#F2B66E',
  warning: '#F2B66E',
  danger: '#FF8DA2',
  border: '#3F424E',
  divider: '#30323B',
  grid: '#3A3D47',
  tabBar: '#15161B',
  shadow: '#000000',
  overlay: 'rgba(0, 0, 0, 0.78)',
};

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
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  return useContext(ThemeContext);
}
