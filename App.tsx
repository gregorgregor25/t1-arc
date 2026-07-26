import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppNavigator } from '@/navigation/AppNavigator';
import { DataProvider } from '@/providers/DataProvider';
import { GlucoseAppearanceProvider } from '@/providers/GlucoseAppearanceProvider';
import { AppThemeProvider, useAppTheme } from '@/theme/theme';

function AppContent() {
  const { dark } = useAppTheme();
  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <GlucoseAppearanceProvider>
        <DataProvider>
          <AppNavigator />
        </DataProvider>
      </GlucoseAppearanceProvider>
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppThemeProvider>
        <AppContent />
      </AppThemeProvider>
    </SafeAreaProvider>
  );
}
