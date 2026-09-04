import Ionicons from "@expo/vector-icons/Ionicons";
import {
  DarkTheme,
  DefaultTheme,
  LinkingOptions,
  NavigationContainer,
} from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { loadLibreLinkUpCredentials } from "@/data/libreLinkUp/secureStore";
import {
  clearOnboardingState,
  loadOnboardingComplete,
  OnboardingStateError,
  saveOnboardingComplete,
} from "@/data/onboarding/onboardingStore";
import { HistoryScreen } from "@/screens/HistoryScreen";
import { InsightsScreen } from "@/screens/InsightsScreen";
import { OnboardingScreen } from "@/screens/OnboardingScreen";
import { HealthScreen } from "@/screens/RecordsScreen";
import { SourcesScreen } from "@/screens/SourcesScreen";
import { TodayScreen } from "@/screens/TodayScreen";
import { useAppTheme } from "@/theme/theme";

import { APP_LINK_PREFIXES } from "./appLinks";
import { resolveAppEntry } from "./appEntry";
import type { SourceJump } from "./sourceNavigation";

export type RootTabParamList = {
  Today: { action?: "log-food" | "log-context"; request?: string } | undefined;
  History: { focus?: "glucose" | "insulin"; request?: string } | undefined;
  Health: undefined;
  Insights: undefined;
  Sources: { focused?: boolean; source?: SourceJump } | undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

const linking: LinkingOptions<RootTabParamList> = {
  prefixes: APP_LINK_PREFIXES,
  config: {
    screens: {
      Today: "today/:action?",
      History: "history",
      Health: "health",
      Insights: "insights",
      Sources: "sources/:source?",
    },
  },
};

const ICONS: Record<
  keyof RootTabParamList,
  {
    active: keyof typeof Ionicons.glyphMap;
    inactive: keyof typeof Ionicons.glyphMap;
  }
> = {
  Today: { active: "pulse", inactive: "pulse-outline" },
  History: { active: "calendar", inactive: "calendar-outline" },
  Health: { active: "fitness", inactive: "fitness-outline" },
  Insights: { active: "compass", inactive: "compass-outline" },
  Sources: { active: "server", inactive: "server-outline" },
};

export function AppNavigator() {
  const { colors, dark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [entry, setEntry] = useState<
    "loading" | "error" | "onboarding" | "app"
  >("loading");
  const [entryAttempt, setEntryAttempt] = useState(0);
  const [entryError, setEntryError] = useState<"onboarding-state" | "unknown">(
    "unknown",
  );
  const [clearingTourState, setClearingTourState] = useState(false);
  const [initialTab, setInitialTab] = useState<keyof RootTabParamList>("Today");
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
    void resolveAppEntry({
      loadOnboardingComplete,
      loadLegacyCredentials: loadLibreLinkUpCredentials,
      markOnboardingComplete: saveOnboardingComplete,
    })
      .then((destination) => {
        if (!active) return;
        setEntry(destination);
      })
      .catch((cause) => {
        if (active) {
          setEntryError(
            cause instanceof OnboardingStateError
              ? "onboarding-state"
              : "unknown",
          );
          setEntry("error");
        }
      });
    return () => {
      active = false;
    };
  }, [entryAttempt]);

  async function resetTourState() {
    if (clearingTourState) return;
    setClearingTourState(true);
    try {
      await clearOnboardingState();
      setEntry("loading");
      setEntryAttempt((attempt) => attempt + 1);
    } catch {
      setEntryError("unknown");
    } finally {
      setClearingTourState(false);
    }
  }

  if (entry === "loading") {
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
        <ActivityIndicator
          color={colors.primary}
          style={styles.launchSpinner}
        />
      </View>
    );
  }

  if (entry === "error") {
    return (
      <View
        accessibilityLabel="T1 Arc setup status could not be checked"
        style={[styles.launch, { backgroundColor: colors.background }]}
      >
        <View
          style={[
            styles.launchIcon,
            {
              backgroundColor: `${colors.warning}18`,
              borderColor: `${colors.warning}44`,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.warning}
            name="warning-outline"
            size={30}
          />
        </View>
        <Text style={[styles.launchName, { color: colors.text }]}>T1 Arc</Text>
        <Text style={[styles.launchError, { color: colors.textSecondary }]}>
          T1 Arc could not check whether setup is complete. Your data has not
          been changed.
        </Text>
        <Pressable
          accessibilityHint="Checks setup status again"
          accessibilityRole="button"
          onPress={() => {
            setEntry("loading");
            setEntryAttempt((attempt) => attempt + 1);
          }}
          style={({ pressed }) => [
            styles.retry,
            {
              backgroundColor: colors.primary,
              opacity: pressed ? 0.72 : 1,
            },
          ]}
        >
          <Text style={[styles.retryText, { color: colors.onPrimary }]}>
            Try again
          </Text>
        </Pressable>
        {entryError === "onboarding-state" ? (
          <>
            <Text style={[styles.resetNote, { color: colors.textSecondary }]}>
              If retrying does not help, reset only the saved tour progress.
              Your health history and connected sources will not be changed.
            </Text>
            <Pressable
              accessibilityHint="Clears only saved walkthrough progress, then opens the tour again"
              accessibilityRole="button"
              accessibilityState={{ busy: clearingTourState }}
              disabled={clearingTourState}
              onPress={() => void resetTourState()}
              style={({ pressed }) => [
                styles.resetTour,
                {
                  borderColor: colors.border,
                  opacity: pressed || clearingTourState ? 0.72 : 1,
                },
              ]}
            >
              {clearingTourState ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : null}
              <Text style={[styles.resetTourText, { color: colors.primary }]}>
                Reset app tour only
              </Text>
            </Pressable>
          </>
        ) : null}
      </View>
    );
  }

  if (entry === "onboarding") {
    return (
      <OnboardingScreen
        onComplete={(destination = "Today") => {
          setInitialTab(destination);
          setEntry("app");
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
          freezeOnBlur: true,
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textTertiary,
          tabBarHideOnKeyboard: true,
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: "700",
            marginTop: 1,
          },
          tabBarStyle: {
            backgroundColor: colors.tabBar,
            borderTopColor: colors.border,
            borderTopWidth: 1,
            height: Platform.OS === "android" ? 64 + insets.bottom : undefined,
            paddingTop: 8,
            paddingBottom:
              Platform.OS === "android"
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
              name={
                focused ? ICONS[route.name].active : ICONS[route.name].inactive
              }
              size={Math.max(22, size)}
            />
          ),
        })}
      >
        <Tab.Screen name="Today" component={TodayScreen} />
        <Tab.Screen name="History" component={HistoryScreen} />
        <Tab.Screen name="Health" component={HealthScreen} />
        <Tab.Screen name="Insights" component={InsightsScreen} />
        <Tab.Screen
          name="Sources"
          component={SourcesScreen}
          options={{
            tabBarButton: () => null,
            tabBarItemStyle: { display: "none" },
            tabBarStyle: { display: "none" },
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  launch: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  launchIcon: {
    width: 62,
    height: 62,
    borderWidth: 1,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  launchName: {
    fontSize: 23,
    lineHeight: 30,
    fontWeight: "900",
    letterSpacing: -0.5,
    marginTop: 14,
  },
  launchSpinner: {
    marginTop: 22,
  },
  launchError: {
    maxWidth: 310,
    marginTop: 12,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  retry: {
    minWidth: 132,
    minHeight: 48,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
    paddingHorizontal: 20,
  },
  retryText: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
  },
  resetNote: {
    maxWidth: 310,
    marginTop: 20,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
  resetTour: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 20,
  },
  resetTourText: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
  },
});
