export const APP_THEME_MODES = ['system', 'light', 'dark'] as const;

export type AppThemeMode = (typeof APP_THEME_MODES)[number];

export function isAppThemeMode(value: unknown): value is AppThemeMode {
  return APP_THEME_MODES.includes(value as AppThemeMode);
}
