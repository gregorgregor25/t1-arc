import Ionicons from "@expo/vector-icons/Ionicons";
import * as Application from "expo-application";
import Constants from "expo-constants";
import {
  Alert,
  Linking,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { SectionCard } from "@/components/SectionCard";
import { AppUpdateCard } from "@/components/AppUpdateCard";
import {
  buildDetailsText,
  describeBuildSource,
  parseBuildSource,
} from "@/domain/buildIdentity";
import { useAppTheme } from "@/theme/theme";

const repository = "https://github.com/gregorgregor25/t1-arc";

export function AppInfoCard() {
  const { colors, radius } = useAppTheme();
  const source = parseBuildSource(Constants.expoConfig?.extra?.t1arcBuild);
  const details = {
    applicationId: Application.applicationId,
    version: Application.nativeApplicationVersion,
    buildNumber: Application.nativeBuildVersion,
    source,
  };

  async function openLink(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(
        "Could not open the link",
        "Try again when a browser is available.",
      );
    }
  }

  async function shareDetails() {
    try {
      await Share.share({ message: buildDetailsText(details) });
    } catch {
      Alert.alert(
        "Could not share build details",
        "You can select and copy the details on this page.",
      );
    }
  }

  const rows = [
    [
      "Version",
      `${details.version ?? "Not available"} (${details.buildNumber ?? "unknown"})`,
    ],
    ["Android package", details.applicationId ?? "Not available"],
    ["Source revision", describeBuildSource(source)],
  ] as const;
  const links: { label: string; url: string }[] = [
    {
      label: "Source code",
      url: source.commit ? `${repository}/tree/${source.commit}` : repository,
    },
    { label: "Report a problem", url: `${repository}/issues` },
  ];
  if (source.commit) {
    links.push({
      label: "Licences and acknowledgements",
      url: `${repository}/blob/${source.commit}/THIRD_PARTY_NOTICES.md`,
    });
  }

  return (
    <SectionCard>
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: colors.text }]}
      >
        T1 Arc
      </Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        Your diabetes and health data, together. Ask Tarv1s to help you
        understand it.
      </Text>
      {rows.map(([label, value]) => (
        <View key={label} style={[styles.row, { borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            {label}
          </Text>
          <Text selectable style={[styles.value, { color: colors.text }]}>
            {value}
          </Text>
        </View>
      ))}
      <AppUpdateCard installed={details} />
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        Two apps can share a name. Android uses the package above to keep
        installations separate. Build details contain no health records, account
        names or API keys.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => void shareDetails()}
        style={({ pressed }) => [
          styles.action,
          {
            backgroundColor: colors.primary,
            borderRadius: radius.md,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Ionicons
          name="share-outline"
          size={20}
          color={colors.onPrimary}
          accessibilityElementsHidden
        />
        <Text style={[styles.actionText, { color: colors.onPrimary }]}>
          Share build details
        </Text>
      </Pressable>
      {links.map(({ label, url }) => (
        <Pressable
          key={label}
          accessibilityRole="link"
          onPress={() => void openLink(url)}
          style={({ pressed }) => [styles.link, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Text
            style={[
              styles.actionText,
              styles.linkText,
              { color: colors.primary },
            ]}
          >
            {label}
          </Text>
          <Ionicons
            name="open-outline"
            size={18}
            color={colors.primary}
            accessibilityElementsHidden
          />
        </Pressable>
      ))}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, lineHeight: 30, fontWeight: "700" },
  body: { fontSize: 14, lineHeight: 21, marginTop: 12 },
  row: {
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 5,
  },
  label: { fontSize: 13, lineHeight: 19 },
  value: { fontSize: 15, lineHeight: 22, fontWeight: "600" },
  action: {
    minHeight: 48,
    marginTop: 20,
    padding: 14,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
  },
  actionText: { fontSize: 14, lineHeight: 21, fontWeight: "600" },
  link: {
    minHeight: 48,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  linkText: { flex: 1 },
});
