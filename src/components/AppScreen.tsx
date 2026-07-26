import { PropsWithChildren, ReactNode, RefObject } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Edge, SafeAreaView } from 'react-native-safe-area-context';

import { useAppTheme } from '@/theme/theme';

interface AppScreenProps extends PropsWithChildren {
  title: string;
  eyebrow?: string;
  trailing?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  edges?: Edge[];
  scrollViewRef?: RefObject<ScrollView | null>;
}

export function AppScreen({
  title,
  eyebrow,
  trailing,
  refreshing = false,
  onRefresh,
  children,
  edges = ['top'],
  scrollViewRef,
}: AppScreenProps) {
  const { colors } = useAppTheme();
  return (
    <SafeAreaView
      edges={edges}
      style={[styles.safeArea, { backgroundColor: colors.background }]}
    >
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
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
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            {eyebrow ? (
              <Text style={[styles.eyebrow, { color: colors.primary }]}>
                {eyebrow.toUpperCase()}
              </Text>
            ) : null}
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: colors.text }]}
            >
              {title}
            </Text>
          </View>
          {trailing}
        </View>
        {children}
      </ScrollView>
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
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
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
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 116,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
  header: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  headerCopy: {
    flexShrink: 1,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.15,
    marginBottom: 3,
  },
  title: {
    fontSize: 31,
    lineHeight: 38,
    fontWeight: '700',
    letterSpacing: -0.75,
  },
  sectionHeading: {
    marginTop: 28,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    letterSpacing: -0.25,
  },
  sectionDetail: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 3,
  },
});
