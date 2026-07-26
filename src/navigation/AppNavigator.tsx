import Ionicons from '@expo/vector-icons/Ionicons';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HistoryScreen } from '@/screens/HistoryScreen';
import { InsightsScreen } from '@/screens/InsightsScreen';
import { RecordsScreen } from '@/screens/RecordsScreen';
import { SourcesScreen } from '@/screens/SourcesScreen';
import { TodayScreen } from '@/screens/TodayScreen';
import { useAppTheme } from '@/theme/theme';

export type RootTabParamList = {
  Today: undefined;
  History: undefined;
  Insights: undefined;
  Records: undefined;
  Sources: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

const ICONS: Record<
  keyof RootTabParamList,
  { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }
> = {
  Today: { active: 'pulse', inactive: 'pulse-outline' },
  History: { active: 'calendar', inactive: 'calendar-outline' },
  Insights: { active: 'sparkles', inactive: 'sparkles-outline' },
  Records: { active: 'list', inactive: 'list-outline' },
  Sources: { active: 'server', inactive: 'server-outline' },
};

export function AppNavigator() {
  const { colors, dark } = useAppTheme();
  const insets = useSafeAreaInsets();
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

  return (
    <NavigationContainer theme={navigationTheme}>
      <Tab.Navigator
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
        <Tab.Screen name="Insights" component={InsightsScreen} />
        <Tab.Screen name="Records" component={RecordsScreen} />
        <Tab.Screen name="Sources" component={SourcesScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
