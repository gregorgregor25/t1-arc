import Ionicons from "@expo/vector-icons/Ionicons";
import { NavigationProp, useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppScreen } from "@/components/AppScreen";
import { SourceSetupGuide } from "@/components/SourceSetupGuide";
import { ScreenHeader } from "@/components/ui";
import { useAndroidBack } from "@/hooks/useAndroidBack";
import type { RootTabParamList } from "@/navigation/AppNavigator";
import {
  NOT_TESTED_WITH_REAL_ACCOUNT_LABEL,
  type SourceJump,
  type SourceSettingsPanel,
  resolveSettingsRequest,
  settingsBackLabel,
  settingsMenuItem,
  settingsParentPage,
  sourceJumpFromRoute,
  sourceSettingsBackTarget,
  sourceSettingsRouteParams,
} from "@/navigation/sourceNavigation";
import { SOURCE_SETUP_GUIDES } from "@/navigation/sourceSetupGuides";
import {
  searchSettings,
  type SettingsSearchEntry,
} from "@/navigation/settingsSearch";
import { useDataContext } from "@/providers/DataProvider";
import { OnboardingScreen } from "@/screens/OnboardingScreen";
import { SettingsHome } from "@/screens/settings/SettingsHome";
import {
  LibreDraftRetentionContext,
  type LibreDraftRetention,
} from "@/screens/settings/LibreSettingsPage";
import type { LibreLinkUpCredentials } from "@/data/libreLinkUp/types";
import {
  alarmKindFromPanel,
  SettingsPageContent,
  type SettingsScreenTarget,
} from "@/screens/settings/SettingsPages";
import {
  SettingsSearchBox,
  SettingsSearchResults,
} from "@/screens/settings/SettingsSearch";
import { useAppTheme } from "@/theme/theme";

/**
 * Settings: a home with "Is everything working?", six main places and a short
 * list, then one page per place. Route params are the durable record of the
 * open page, so links such as `t1arc://sources/glooko` keep working.
 */
export function SourcesScreen({
  route,
}: {
  route?: { params?: { focused?: boolean; source?: SourceJump; panel?: SourceSettingsPanel } };
}) {
  const navigation = useNavigation<NavigationProp<RootTabParamList>>();
  const { colors, radius } = useAppTheme();
  const { refreshData, reloadSources, syncing } = useDataContext();
  const scrollViewRef = useRef<ScrollView | null>(null);
  // Unsaved LibreLinkUp sign-in, kept only while Settings stays open.
  const [libreDraftRetention] = useState<LibreDraftRetention>(() => {
    let draft: LibreLinkUpCredentials | undefined;
    return {
      read: () => draft,
      write: (next) => {
        draft = next;
      },
    };
  });
  // Earlier links named the combined "Display and alerts" page; it now opens
  // "Phone, widget and car", which holds the same display controls.
  const activePage = resolveSettingsRequest(
    sourceJumpFromRoute(route?.params?.source),
  ).page;
  const [expandedSetting, setExpandedSetting] = useState<string>();
  const pendingExpandedSetting = useRef<string | undefined>(undefined);
  const [tourOpen, setTourOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchResults = useMemo(() => searchSettings(searchQuery), [searchQuery]);

  useEffect(() => {
    // Route changes are navigation commands. Collapse any previously expanded
    // card before showing the requested page so stale controls cannot linger.
    // A Settings search result may name the one panel it should open instead.
    setExpandedSetting(pendingExpandedSetting.current);
    pendingExpandedSetting.current = undefined;
  }, [activePage]);

  const requestedPanel = route?.params?.panel;
  useEffect(() => {
    if (!requestedPanel) return;
    // A one-off request (from a "data unavailable" state or the tour): open the
    // page and panel once, then clear the request so it does not reopen.
    const request = resolveSettingsRequest(
      sourceJumpFromRoute(route?.params?.source),
      requestedPanel,
    );
    pendingExpandedSetting.current = request.expand;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedSetting(request.expand);
    navigation.setParams({
      ...sourceSettingsRouteParams(request.page),
      panel: undefined,
    });
  }, [navigation, requestedPanel, route?.params?.source]);

  const showChangedPersonalData = useCallback(async () => {
    await reloadSources();
  }, [reloadSources]);

  const toggleSetting = useCallback((setting: string) => {
    setExpandedSetting((current) => (current === setting ? undefined : setting));
  }, []);

  const scrollToTop = useCallback(() => {
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    });
  }, []);

  const showPage = useCallback(
    (page: SourceJump | undefined, expand?: string) => {
      setSearchQuery("");
      pendingExpandedSetting.current = expand;
      setExpandedSetting(expand);
      navigation.setParams(sourceSettingsRouteParams(page));
      scrollToTop();
    },
    [navigation, scrollToTop],
  );

  const openScreen = useCallback(
    (screen: SettingsScreenTarget) => {
      if (screen === "Tour") setTourOpen(true);
      else if (screen === "TarvisSettings") {
        navigation.navigate('Insights', { settings: true });
      } else navigation.navigate(screen);
    },
    [navigation],
  );

  function openSearchResult(entry: SettingsSearchEntry) {
    const target = entry.target;
    setSearchQuery("");
    if (target.kind === "screen") {
      openScreen(target.screen);
      return;
    }
    showPage(target.source, target.expand);
  }

  const closeSettings = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Today");
  }, [navigation]);

  const alarmEditorOpen = activePage === "alarms" && alarmKindFromPanel(expandedSetting) !== undefined;

  const handleSettingsBack = useCallback(() => {
    if (alarmEditorOpen) {
      setExpandedSetting(undefined);
      return;
    }
    if (!activePage && searchQuery.trim()) {
      setSearchQuery("");
      return;
    }
    if (sourceSettingsBackTarget(activePage) === "overview" && activePage) {
      showPage(settingsParentPage(activePage));
      return;
    }
    closeSettings();
  }, [activePage, alarmEditorOpen, closeSettings, searchQuery, showPage]);

  useAndroidBack(!tourOpen, handleSettingsBack);

  if (tourOpen) {
    return (
      <OnboardingScreen
        mode="replay"
        onComplete={(destination) => {
          setTourOpen(false);
          if (destination === "Alerts") showPage("alarms");
        }}
        onRequestClose={() => setTourOpen(false)}
      />
    );
  }

  const closeButton = (
    <Pressable
      accessibilityLabel="Close settings"
      accessibilityRole="button"
      hitSlop={6}
      onPress={closeSettings}
      style={({ pressed }) => [
        styles.closeSettings,
        {
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.surfaceBorder,
          borderRadius: radius.pill,
          opacity: pressed ? 0.68 : 1,
        },
      ]}
    >
      <Ionicons
        accessibilityElementsHidden
        color={colors.textSecondary}
        name="close"
        size={24}
      />
    </Pressable>
  );

  const pageItem = activePage ? settingsMenuItem(activePage) : undefined;
  const header = (
    <ScreenHeader
      back={
        activePage
          ? alarmEditorOpen
            ? { label: "Alarms", onPress: () => setExpandedSetting(undefined) }
            : {
                label: settingsBackLabel(activePage),
                onPress: () => showPage(settingsParentPage(activePage)),
              }
          : undefined
      }
      title={pageItem?.label ?? "Settings"}
      trailing={closeButton}
    />
  );
  const guide = activePage ? SOURCE_SETUP_GUIDES[activePage] : undefined;

  return (
    <AppScreen
      title="Settings"
      header={header}
      fixedHeader
      tabBarHidden
      refreshing={syncing}
      onRefresh={() => void refreshData()}
      scrollViewRef={scrollViewRef}
    >
      {activePage && (guide || pageItem?.notTestedWithRealAccount) ? (
        <View style={styles.pageIntro}>
          {guide ? <SourceSetupGuide key={activePage} {...guide} /> : null}
          {pageItem?.notTestedWithRealAccount ? (
            <Text style={[styles.untestedNotice, { color: colors.textSecondary }]}>
              {NOT_TESTED_WITH_REAL_ACCOUNT_LABEL}. It is built to the
              provider’s published behaviour and checked with automated tests.
              Please report any problems in Help and support.
            </Text>
          ) : null}
        </View>
      ) : null}

      {!activePage ? (
        <View style={styles.home}>
          <SettingsSearchBox onChange={setSearchQuery} value={searchQuery} />
          {searchQuery.trim() ? (
            <SettingsSearchResults onSelect={openSearchResult} results={searchResults} />
          ) : (
            <SettingsHome onOpenPage={showPage} />
          )}
        </View>
      ) : (
        <LibreDraftRetentionContext.Provider value={libreDraftRetention}>
        <SettingsPageContent
          expanded={expandedSetting}
          key={activePage}
          onDataChanged={showChangedPersonalData}
          openPage={showPage}
          openScreen={openScreen}
          page={activePage}
          setExpanded={setExpandedSetting}
          toggle={toggleSetting}
        />
        </LibreDraftRetentionContext.Provider>
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  closeSettings: {
    width: 44,
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  home: {
    gap: 16,
  },
  pageIntro: {
    gap: 8,
    marginBottom: 12,
  },
  untestedNotice: {
    fontSize: 12,
    lineHeight: 18,
  },
});
