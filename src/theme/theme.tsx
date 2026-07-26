import {
  createContext,
  PropsWithChildren,
  useContext,
  useMemo,
} from 'react';
import { ColorSchemeName, useColorScheme } from 'react-native';

export interface AppColors {
  background: string;
  backgroundGlow: string;
  surface: string;
  surfaceElevated: string;
  surfaceMuted: string;
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

const lightColors: AppColors = {
  background: '#F1F8FA',
  backgroundGlow: '#D9F4F7',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#EAF4F6',
  text: '#102B34',
  textSecondary: '#46636D',
  textTertiary: '#667F88',
  primary: '#087F99',
  primaryStrong: '#075E70',
  onPrimary: '#FFFFFF',
  accent: '#087A5C',
  glucose: '#087F99',
  insulin: '#6C4FB3',
  insulinSoft: '#EDE8FA',
  targetBand: '#DDF3E9',
  low: '#B74F64',
  high: '#A75C13',
  warning: '#9D5A10',
  danger: '#B4233A',
  border: '#D3E4E8',
  divider: '#E3ECEF',
  grid: '#D7E5E8',
  tabBar: '#FFFFFF',
  shadow: '#183E49',
  overlay: 'rgba(6, 30, 37, 0.58)',
};

const darkColors: AppColors = {
  background: '#071519',
  backgroundGlow: '#11343C',
  surface: '#102328',
  surfaceElevated: '#153038',
  surfaceMuted: '#18343B',
  text: '#F2FAFB',
  textSecondary: '#B7CDD2',
  textTertiary: '#8FABB2',
  primary: '#61C9DE',
  primaryStrong: '#89DCEC',
  onPrimary: '#06252D',
  accent: '#69D5AC',
  glucose: '#65D2E7',
  insulin: '#BBA6F5',
  insulinSoft: '#302A48',
  targetBand: '#143C33',
  low: '#FF9BAE',
  high: '#F1B66F',
  warning: '#F1B66F',
  danger: '#FF9BAE',
  border: '#29454C',
  divider: '#213A41',
  grid: '#29464D',
  tabBar: '#0E2228',
  shadow: '#000000',
  overlay: 'rgba(0, 5, 7, 0.72)',
};

function makeTheme(scheme: ColorSchemeName): AppTheme {
  const dark = scheme === 'dark';
  return {
    dark,
    colors: dark ? darkColors : lightColors,
    spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
    radius: { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 },
  };
}

const ThemeContext = createContext<AppTheme>(makeTheme('light'));

export function AppThemeProvider({ children }: PropsWithChildren) {
  const scheme = useColorScheme();
  const theme = useMemo(() => makeTheme(scheme), [scheme]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  return useContext(ThemeContext);
}
