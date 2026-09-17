export const APP_RECOVERY_COPY = {
  eyebrow: "INTERFACE RECOVERY",
  title: "T1 Arc needs a moment",
  detail:
    "This screen could not finish loading. Reload the app interface to try again.",
  privacyTitle: "Your personal data was not changed",
  privacyDetail:
    "Reloading this screen does not edit, delete, or re-import your health records or settings. T1 Arc does not send the error or your health details anywhere from this screen.",
  action: "Reload T1 Arc",
} as const;

export interface AppRecoveryState {
  hasError: boolean;
  reloadKey: number;
}

export function initialAppRecoveryState(): AppRecoveryState {
  return {
    hasError: false,
    reloadKey: 0,
  };
}

export function markAppRecoveryNeeded(
  state: AppRecoveryState,
): AppRecoveryState {
  return {
    ...state,
    hasError: true,
  };
}

export function reloadAppInterface(state: AppRecoveryState): AppRecoveryState {
  return {
    hasError: false,
    reloadKey: state.reloadKey + 1,
  };
}
