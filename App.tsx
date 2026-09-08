import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { LocalDataEraseRecoveryGate } from '@/components/LocalDataEraseRecoveryGate';
import { AppNavigator } from '@/navigation/AppNavigator';
import { DataProvider } from '@/providers/DataProvider';
import { GlucoseAppearanceProvider } from '@/providers/GlucoseAppearanceProvider';
import { RegionalProfileProvider } from '@/providers/RegionalProfileProvider';
import { AppThemeProvider, useAppTheme } from '@/theme/theme';

function AppContent() {
  const { dark } = useAppTheme();
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
        <LocalDataEraseRecoveryGate>
          <AppContent />
        </LocalDataEraseRecoveryGate>
      </AppErrorBoundary>
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
