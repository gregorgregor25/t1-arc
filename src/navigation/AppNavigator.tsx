import Ionicons from '@expo/vector-icons/Ionicons';
import {
  DarkTheme,
  DefaultTheme,
  LinkingOptions,
  NavigationContainer,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  loadLibreLinkUpCredentials,
  loadOnboardingComplete,
  saveOnboardingComplete,
} from '@/data/libreLinkUp/secureStore';
import { HistoryScreen } from '@/screens/HistoryScreen';
import { InsightsScreen } from '@/screens/InsightsScreen';
import { OnboardingScreen } from '@/screens/OnboardingScreen';
import { HealthScreen } from '@/screens/RecordsScreen';
import { SourcesScreen } from '@/screens/SourcesScreen';
import { TodayScreen } from '@/screens/TodayScreen';
import { useAppTheme } from '@/theme/theme';

export type RootTabParamList = {
  Today:
    | { action?: 'log-food' | 'log-context'; request?: string }
    | undefined;
  History: undefined;
  Health: undefined;
  Insights: undefined;
  Sources: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

const linking: LinkingOptions<RootTabParamList> = {
  prefixes: ['daymark://'],
  config: {
    screens: {
      Today: 'today/:action?',
      History: 'history',
      Health: 'health',
      Insights: 'insights',
      Sources: 'sources',
    },
  },
};

const ICONS: Record<
  keyof RootTabParamList,
  { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }
> = {
  Today: { active: 'pulse', inactive: 'pulse-outline' },
  History: { active: 'calendar', inactive: 'calendar-outline' },
  Health: { active: 'fitness', inactive: 'fitness-outline' },
  Insights: { active: 'sparkles', inactive: 'sparkles-outline' },
  Sources: { active: 'server', inactive: 'server-outline' },
};

export function AppNavigator() {
  const { colors, dark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [entry, setEntry] = useState<'loading' | 'onboarding' | 'app'>(
    'loading',
  );
  const [initialTab, setInitialTab] =
    useState<keyof RootTabParamList>('Today');
  const base = dark ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.tabBar,
      text: colors.text,
      border: colors.border,
      notification: colors.warning,
    },
  };

  useEffect(() => {
    let active = true;
    void Promise.all([
      loadOnboardingComplete(),
      loadLibreLinkUpCredentials(),
    ])
      .then(([completed, credentials]) => {
        if (!active) return;
        if (completed || credentials) {
          setEntry('app');
          if (!completed && credentials) {
            void saveOnboardingComplete().catch(() => undefined);
          }
        } else {
          setEntry('onboarding');
        }
      })
      .catch(() => {
        if (active) setEntry('onboarding');
      });
    return () => {
      active = false;
    };
  }, []);

  if (entry === 'loading') {
    return (
      <View
        accessibilityLabel="Opening T1 Arc"
        style={[styles.launch, { backgroundColor: colors.background }]}
      >
        <View
          style={[
            styles.launchIcon,
            {
              backgroundColor: `${colors.primary}18`,
              borderColor: `${colors.primary}44`,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.primary}
            name="pulse"
            size={30}
          />
        </View>
        <Text style={[styles.launchName, { color: colors.text }]}>T1 Arc</Text>
        <ActivityIndicator color={colors.primary} style={styles.launchSpinner} />
      </View>
    );
  }

  if (entry === 'onboarding') {
    return (
      <OnboardingScreen
        onComplete={(destination = 'Today') => {
          setInitialTab(destination);
          setEntry('app');
        }}
      />
    );
  }

  return (
    <NavigationContainer linking={linking} theme={navigationTheme}>
      <Tab.Navigator
        backBehavior="history"
        initialRouteName={initialTab}
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textTertiary,
          tabBarHideOnKeyboard: true,
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: '700',
            marginTop: 1,
          },
          tabBarStyle: {
            backgroundColor: colors.tabBar,
            borderTopColor: colors.border,
            borderTopWidth: 1,
            height:
              Platform.OS === 'android' ? 64 + insets.bottom : undefined,
            paddingTop: 8,
            paddingBottom:
              Platform.OS === 'android'
                ? Math.max(8, insets.bottom)
                : undefined,
          },
          tabBarItemStyle: {
            minHeight: 52,
          },
          tabBarIcon: ({ color, focused, size }) => (
            <Ionicons
              accessibilityElementsHidden
              color={color}
              name={focused ? ICONS[route.name].active : ICONS[route.name].inactive}
              size={Math.max(22, size)}
            />
          ),
        })}
      >
        <Tab.Screen name="Today" component={TodayScreen} />
        <Tab.Screen name="History" component={HistoryScreen} />
        <Tab.Screen name="Health" component={HealthScreen} />
        <Tab.Screen name="Insights" component={InsightsScreen} />
        <Tab.Screen name="Sources" component={SourcesScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  launch: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  launchIcon: {
    width: 62,
    height: 62,
    borderWidth: 1,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  launchName: {
    fontSize: 23,
    lineHeight: 30,
    fontWeight: '900',
    letterSpacing: -0.5,
    marginTop: 14,
  },
  launchSpinner: {
    marginTop: 22,
  },
});
