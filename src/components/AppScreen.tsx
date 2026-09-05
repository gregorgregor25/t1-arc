import { PropsWithChildren, ReactNode, RefObject } from "react";
import { LinearGradient } from "expo-linear-gradient";
import {
  RefreshControl,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  Edge,
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { useAppTheme } from "@/theme/theme";

import { DemoModeNotice } from "./DemoModeNotice";

interface AppScreenProps extends PropsWithChildren {
  title: string;
  header?: ReactNode;
  trailing?: ReactNode;
  footer?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  edges?: Edge[];
  scrollViewRef?: RefObject<ScrollView | null>;
  quietHeader?: boolean;
  fixedHeader?: boolean;
}

export function AppScreen({
  title,
  header,
  trailing,
  footer,
  refreshing = false,
  onRefresh,
  children,
  edges = ["top"],
  scrollViewRef,
  quietHeader = false,
  fixedHeader = false,
}: AppScreenProps) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const includesTopEdge = edges.includes("top");
  const topInset = includesTopEdge
    ? Math.max(
        insets.top,
        Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0,
      )
    : 0;
  const screenHeader = header ?? (
    <View style={[styles.header, quietHeader && styles.quietHeader]}>
      <View style={styles.headerCopy}>
        <Text
          accessibilityRole="header"
          style={[
            styles.title,
            quietHeader && styles.quietTitle,
            { color: colors.text },
          ]}
        >
          {title}
          <Text style={{ color: colors.primary }}>.</Text>
        </Text>
      </View>
      {trailing}
    </View>
  );
  return (
    <SafeAreaView
      edges={edges.filter((edge) => edge !== "top")}
      style={[
        styles.safeArea,
        {
          backgroundColor: colors.background,
          paddingTop: topInset,
        },
      ]}
    >
      <LinearGradient
        colors={[colors.backgroundGlow, colors.background, colors.background]}
        end={{ x: 0.82, y: 0.72 }}
        locations={[0, 0.42, 1]}
        pointerEvents="none"
        start={{ x: 0.02, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <DemoModeNotice />
      {fixedHeader ? (
        <View style={styles.fixedHeader}>{screenHeader}</View>
      ) : null}
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        style={styles.scrollView}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          ) : undefined
        }
        showsVerticalScrollIndicator={false}
      >
        {fixedHeader ? null : screenHeader}
        {children}
      </ScrollView>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

export function SectionHeading({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.sectionHeading}>
      <Text
        accessibilityRole="header"
        style={[styles.sectionTitle, { color: colors.text }]}
      >
        {title}
      </Text>
      {detail ? (
        <Text style={[styles.sectionDetail, { color: colors.textSecondary }]}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 116,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  footer: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  fixedHeader: {
    paddingHorizontal: 16,
    paddingTop: 12,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  header: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  headerCopy: {
    flexShrink: 1,
  },
  quietHeader: {
    minHeight: 56,
    marginBottom: 13,
  },
  title: {
    fontSize: 32,
    lineHeight: 39,
    fontWeight: "800",
    letterSpacing: -1,
  },
  quietTitle: {
    fontSize: 31,
    lineHeight: 37,
    fontWeight: "800",
    letterSpacing: -0.9,
  },
  sectionHeading: {
    marginTop: 28,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "600",
    letterSpacing: -0.15,
  },
  sectionDetail: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 3,
  },
});
