import * as SecureStore from 'expo-secure-store';

import {
  AppThemeMode,
  isAppThemeMode,
} from '@/domain/themePreference';

const THEME_PREFERENCE_KEY = 't1arc.app-theme.v1';

export async function loadThemePreference(): Promise<AppThemeMode> {
  const saved = await SecureStore.getItemAsync(THEME_PREFERENCE_KEY);
  return isAppThemeMode(saved) ? saved : 'system';
}

export async function saveThemePreference(mode: AppThemeMode) {
  await SecureStore.setItemAsync(THEME_PREFERENCE_KEY, mode);
  return mode;
}
