import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, View } from 'react-native';
import { recordDiagnostic } from '@/data/support/diagnosticStore';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { AppAlertHost } from '@/components/AppAlertHost';
import { ColdLaunchPresentation } from '@/components/ColdLaunchPresentation';
import { LocalDataEraseRecoveryGate } from '@/components/LocalDataEraseRecoveryGate';
import { AppNavigator } from '@/navigation/AppNavigator';
import { DataProvider } from '@/providers/DataProvider';
import { GlucoseAppearanceProvider } from '@/providers/GlucoseAppearanceProvider';
import { RegionalProfileProvider } from '@/providers/RegionalProfileProvider';
import { AppThemeProvider, useAppTheme } from '@/theme/theme';

function AppContent() {
  const { dark } = useAppTheme();
  useEffect(() => {
    recordDiagnostic('app_opened');
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') recordDiagnostic('app_foreground');
      if (state === 'background') recordDiagnostic('app_background');
    });
    return () => subscription.remove();
  }, []);
  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <RegionalProfileProvider>
        <GlucoseAppearanceProvider>
          <DataProvider>
            <AppNavigator />
          </DataProvider>
        </GlucoseAppearanceProvider>
      </RegionalProfileProvider>
    </>
  );
}

function AppSurface() {
  const { colors } = useAppTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppErrorBoundary>
        <ColdLaunchPresentation>
          <LocalDataEraseRecoveryGate>
            <AppContent />
          </LocalDataEraseRecoveryGate>
        </ColdLaunchPresentation>
      </AppErrorBoundary>
      <AppAlertHost />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppThemeProvider>
        <AppSurface />
      </AppThemeProvider>
    </SafeAreaProvider>
  );
}
