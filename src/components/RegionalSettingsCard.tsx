import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { observeRegionalProfile, saveRegionalProfile } from "@/data/regionalProfile";
import {
  DEFAULT_REGIONAL_PROFILE,
  isIanaTimeZone,
  normaliseCountryCode,
  regionalProfileLabel,
  resolveRegionalDefaults,
  type T1ArcRegion,
  type T1ArcGlucoseUnit,
  type T1ArcMeasurementSystem,
  type T1ArcEnergyUnit,
  type T1ArcRegionalProfile,
} from "@/domain/regionalProfile";
import {
  countryOptions,
  timeZoneLabel,
  timeZoneOptions,
} from "@/domain/regionalPickerOptions";
import { useAppTheme } from "@/theme/theme";
import { SearchablePickerModal } from "./SearchablePickerModal";
import { SectionCard } from "./SectionCard";

const OPTIONS: { label: string; value: T1ArcRegion }[] = [
  { label: "Automatic", value: "automatic" },
  { label: "UK & Europe", value: "europe" },
  { label: "US", value: "us" },
  { label: "Japan", value: "japan" },
  { label: "Other", value: "other" },
];

const GLUCOSE_OPTIONS: { label: string; value: T1ArcGlucoseUnit }[] = [
  { label: "Automatic", value: "automatic" },
  { label: "mmol/L", value: "mmolL" },
  { label: "mg/dL", value: "mgDl" },
];

const MEASUREMENT_OPTIONS: {
  label: string;
  value: T1ArcMeasurementSystem;
}[] = [
  { label: "Automatic", value: "automatic" },
  { label: "Metric", value: "metric" },
  { label: "Imperial", value: "imperial" },
];

const ENERGY_OPTIONS: { label: string; value: T1ArcEnergyUnit }[] = [
  { label: "Automatic", value: "automatic" },
  { label: "kcal", value: "kcal" },
  { label: "kJ", value: "kJ" },
];

const COUNTRY_OPTIONS = [
  { label: "Device", value: "automatic" },
  { label: "UK", value: "GB" },
  { label: "Ireland", value: "IE" },
  { label: "France", value: "FR" },
  { label: "Germany", value: "DE" },
  { label: "Spain", value: "ES" },
  { label: "Italy", value: "IT" },
  { label: "Netherlands", value: "NL" },
  { label: "US", value: "US" },
  { label: "Canada", value: "CA" },
  { label: "Australia", value: "AU" },
  { label: "New Zealand", value: "NZ" },
  { label: "Japan", value: "JP" },
];

const CLINICAL_OPTIONS = [
  { label: "Automatic", value: "automatic" },
  { label: "General only", value: "generic" },
];

const LANGUAGE_OPTIONS = [
  { label: "Device", value: "automatic" },
  { label: "English (UK)", value: "en-GB" },
  { label: "English (US)", value: "en-US" },
  { label: "Français", value: "fr-FR" },
  { label: "Deutsch", value: "de-DE" },
  { label: "Español", value: "es-ES" },
  { label: "Italiano", value: "it-IT" },
  { label: "Nederlands", value: "nl-NL" },
  { label: "日本語", value: "ja-JP" },
];

export function RegionalSettingsCard({
  moreOptionsOpen,
  onChange,
  onToggleMoreOptions,
  showHeading = true,
}: {
  /** When given with onToggleMoreOptions, the parent controls "More options". */
  moreOptionsOpen?: boolean;
  onChange?(profile: T1ArcRegionalProfile): void;
  onToggleMoreOptions?(): void;
  showHeading?: boolean;
}) {
  const { colors, radius } = useAppTheme();
  const [profile, setProfile] = useState<T1ArcRegionalProfile>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const [timeZoneDraft, setTimeZoneDraft] = useState("");
  const [countryDraft, setCountryDraft] = useState("");
  const [localMoreOpen, setLocalMoreOpen] = useState(false);
  const [picker, setPicker] = useState<"country" | "timeZone">();
  const controlled = moreOptionsOpen !== undefined && onToggleMoreOptions !== undefined;
  const showMore = controlled ? moreOptionsOpen : localMoreOpen;

  useEffect(
    () =>
      observeRegionalProfile((next) => {
        setProfile(next);
        setTimeZoneDraft(
          next.analysisTimeZone === "automatic"
            ? resolveRegionalDefaults(next).timeZone
            : next.analysisTimeZone,
        );
        setCountryDraft(next.countryCode === "automatic" ? "" : next.countryCode);
        onChange?.(next);
      }),
    [onChange],
  );
  const defaults = useMemo(
    () => resolveRegionalDefaults(profile ?? DEFAULT_REGIONAL_PROFILE),
    [profile],
  );
  const timeZoneList = useMemo(() => timeZoneOptions(), []);
  const countryList = useMemo(() => countryOptions(defaults.locale), [defaults.locale]);
  const selectedTimeZone =
    profile && profile.analysisTimeZone !== "automatic"
      ? profile.analysisTimeZone
      : defaults.timeZone;
  const otherCountryName =
    profile &&
    profile.countryCode !== "automatic" &&
    !COUNTRY_OPTIONS.some((option) => option.value === profile.countryCode)
      ? (countryList?.find((option) => option.value === profile.countryCode)?.label ??
        profile.countryCode)
      : undefined;

  function toggleMoreOptions() {
    if (controlled) onToggleMoreOptions();
    else setLocalMoreOpen((open) => !open);
  }

  async function updateProfile(update: Partial<T1ArcRegionalProfile>) {
    if (!profile || working) return;
    const next = { ...profile, ...update };
    setWorking(true);
    setError(undefined);
    try {
      await saveRegionalProfile(next);
    } catch {
      setError("T1 Arc could not save this change. Please try again.");
    } finally {
      setWorking(false);
    }
  }

  function optionGroup<T extends string>(
    label: string,
    value: T,
    options: { label: string; value: T }[],
    select: (value: T) => void,
  ) {
    return (
      <View style={styles.group}>
        <Text style={[styles.groupLabel, { color: colors.textSecondary }]}>{label}</Text>
        <View accessibilityRole="radiogroup" style={styles.options}>
          {options.map((option) => {
            const active = value === option.value;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: active, disabled: working }}
                disabled={working}
                key={option.value}
                onPress={() => select(option.value)}
                style={({ pressed }) => [
                  styles.option,
                  {
                    backgroundColor: active ? `${colors.primary}1C` : colors.surfaceMuted,
                    borderColor: active ? colors.primary : colors.border,
                    borderRadius: radius.pill,
                    opacity: pressed ? 0.68 : 1,
                  },
                ]}
              >
                <Text style={[styles.optionText, { color: active ? colors.primary : colors.textSecondary }]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  function pickerButton(label: string, value: string, hint: string, open: () => void) {
    return (
      <Pressable
        accessibilityHint={hint}
        accessibilityLabel={`${label}: ${value}`}
        accessibilityRole="button"
        disabled={working}
        onPress={open}
        style={({ pressed }) => [
          styles.pickerButton,
          {
            borderColor: colors.border,
            borderRadius: radius.md,
            opacity: working ? 0.5 : pressed ? 0.68 : 1,
          },
        ]}
      >
        <Text numberOfLines={1} style={[styles.pickerValue, { color: colors.text }]}>
          {value}
        </Text>
        <Text style={[styles.pickerAction, { color: colors.primary }]}>Change</Text>
      </Pressable>
    );
  }

  function saveButton(onPress: () => void) {
    return (
      <Pressable
        accessibilityRole="button"
        disabled={working}
        onPress={onPress}
        style={({ pressed }) => [
          styles.saveSetting,
          {
            backgroundColor: colors.primary,
            borderRadius: radius.md,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Text style={[styles.saveSettingText, { color: colors.onPrimary }]}>Save</Text>
      </Pressable>
    );
  }

  return (
    <SectionCard>
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: `${colors.primary}18`, borderRadius: radius.md }]}>
          <Ionicons accessibilityElementsHidden color={colors.primary} name="globe-outline" size={22} />
        </View>
        <View style={styles.copy}>
          {showHeading ? <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Region and services</Text> : null}
          <Text style={[styles.detail, { color: colors.textSecondary }]}>
            Sets safe defaults for new cloud connections. Every source can still use its own account region.
          </Text>
        </View>
      </View>
      {!profile ? (
        <ActivityIndicator color={colors.primary} style={styles.loading} />
      ) : (
        <>
          {optionGroup("Glucose unit", profile.glucoseUnit, GLUCOSE_OPTIONS, (glucoseUnit) =>
            void updateProfile({ glucoseUnit }),
          )}
          <Text style={[styles.settingHelp, { color: colors.textTertiary }]}>
            Changes how glucose is shown. Your saved readings are not changed.
          </Text>
          <Pressable
            accessibilityHint="Shows country, number formats, measurements and time zone"
            accessibilityRole="button"
            accessibilityState={{ expanded: showMore }}
            onPress={toggleMoreOptions}
            style={({ pressed }) => [
              styles.moreButton,
              { borderTopColor: colors.divider, opacity: pressed ? 0.68 : 1 },
            ]}
          >
            <Text style={[styles.moreButtonText, { color: colors.text }]}>More options</Text>
            <Ionicons
              accessibilityElementsHidden
              color={colors.textSecondary}
              name={showMore ? "chevron-up" : "chevron-down"}
              size={18}
            />
          </Pressable>
          {showMore ? (
            <>
              {optionGroup("Region preset", profile.region, OPTIONS, (region) =>
                void updateProfile({ region }),
              )}
              {optionGroup("Country", profile.countryCode, COUNTRY_OPTIONS, (countryCode) =>
                void updateProfile({ countryCode, region: "automatic" }),
              )}
              <View style={styles.group}>
                <Text style={[styles.groupLabel, { color: colors.textSecondary }]}>
                  Another country or territory
                </Text>
                {countryList ? (
                  pickerButton(
                    "Another country or territory",
                    otherCountryName ?? "Not chosen",
                    "Opens a searchable list of countries and territories",
                    () => setPicker("country"),
                  )
                ) : (
                  <View style={styles.textSettingRow}>
                    <TextInput
                      accessibilityLabel="Two-letter country code, for example CA"
                      autoCapitalize="characters"
                      autoCorrect={false}
                      editable={!working}
                      maxLength={2}
                      onChangeText={setCountryDraft}
                      placeholder="CA"
                      placeholderTextColor={colors.textTertiary}
                      style={[
                        styles.countryInput,
                        {
                          borderColor: colors.controlBorder,
                          borderRadius: radius.md,
                          color: colors.text,
                        },
                      ]}
                      value={countryDraft}
                    />
                    {saveButton(() => {
                      const countryCode = normaliseCountryCode(countryDraft);
                      if (!countryCode) {
                        setError("Enter a two-letter country code, for example GB or CA.");
                        return;
                      }
                      void updateProfile({ countryCode, region: "automatic" });
                    })}
                  </View>
                )}
              </View>
              {optionGroup(
                "Numbers and dates",
                profile.languageTag,
                LANGUAGE_OPTIONS,
                (languageTag) => void updateProfile({ languageTag }),
              )}
              <Text style={[styles.settingHelp, { color: colors.textTertiary }]}>
                This changes number and date formats, food search language and spoken units. The app itself stays in English until reviewed translations are ready.
              </Text>
              {optionGroup(
                "Measurements",
                profile.measurementSystem,
                MEASUREMENT_OPTIONS,
                (measurementSystem) => void updateProfile({ measurementSystem }),
              )}
              {optionGroup("Energy", profile.energyUnit, ENERGY_OPTIONS, (energyUnit) =>
                void updateProfile({ energyUnit }),
              )}
              {optionGroup(
                "Calendar time zone",
                profile.followDeviceTimeZone ? "device" : "fixed",
                [
                  { label: "Follow phone", value: "device" },
                  { label: `Keep ${defaults.timeZone}`, value: "fixed" },
                ],
                (choice) =>
                  void updateProfile(
                    choice === "device"
                      ? { followDeviceTimeZone: true, analysisTimeZone: "automatic" }
                      : {
                          followDeviceTimeZone: false,
                          analysisTimeZone: defaults.timeZone,
                        },
                  ),
              )}
              {!profile.followDeviceTimeZone ? (
                <View style={styles.group}>
                  <Text style={[styles.groupLabel, { color: colors.textSecondary }]}>
                    Home time zone
                  </Text>
                  {timeZoneList ? (
                    pickerButton(
                      "Home time zone",
                      timeZoneLabel(selectedTimeZone),
                      "Opens a searchable list of time zones",
                      () => setPicker("timeZone"),
                    )
                  ) : (
                    <View style={styles.textSettingRow}>
                      <TextInput
                        accessibilityLabel="Time zone, for example Europe/London"
                        autoCapitalize="none"
                        autoCorrect={false}
                        editable={!working}
                        onChangeText={setTimeZoneDraft}
                        placeholder="Europe/London"
                        placeholderTextColor={colors.textTertiary}
                        style={[
                          styles.textSettingInput,
                          {
                            borderColor: colors.controlBorder,
                            borderRadius: radius.md,
                            color: colors.text,
                          },
                        ]}
                        value={timeZoneDraft}
                      />
                      {saveButton(() => {
                        const candidate = timeZoneDraft.trim();
                        if (!isIanaTimeZone(candidate)) {
                          setError(
                            "T1 Arc does not recognise that time zone. Use the form Region/City, for example Europe/London or America/New_York.",
                          );
                          return;
                        }
                        void updateProfile({
                          analysisTimeZone: candidate,
                          followDeviceTimeZone: false,
                        });
                      })}
                    </View>
                  )}
                  <Text style={[styles.settingHelp, { color: colors.textTertiary }]}>
                    Calendar days, reports, schedules and Tarv1s analysis use this zone while you travel.
                  </Text>
                </View>
              ) : null}
              {optionGroup(
                "Reviewed clinical guidance",
                profile.clinicalJurisdiction === "generic" ? "generic" : "automatic",
                CLINICAL_OPTIONS,
                (clinicalJurisdiction) => void updateProfile({ clinicalJurisdiction }),
              )}
              <Text style={[styles.settingHelp, { color: colors.textTertiary }]}>
                {defaults.clinicalJurisdiction === "GB"
                  ? "Reviewed UK guidance is available."
                  : "No reviewed country-specific clinical pack is available here; T1 Arc uses general safety wording and local emergency terminology only."}
              </Text>
            </>
          ) : null}
          <Text style={[styles.resolved, { color: colors.textTertiary }]}>
            {regionalProfileLabel(defaults)} · {defaults.timeZone} · {defaults.glucoseUnit === "mgDl" ? "mg/dL" : "mmol/L"} · {defaults.measurementSystem} · {defaults.energyUnit}
          </Text>
        </>
      )}
      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
      {countryList ? (
        <SearchablePickerModal
          onClose={() => setPicker(undefined)}
          onSelect={(countryCode) => {
            setPicker(undefined);
            void updateProfile({ countryCode, region: "automatic" });
          }}
          options={countryList}
          searchLabel="Search countries and territories"
          selected={profile?.countryCode}
          title="Country or territory"
          visible={picker === "country"}
        />
      ) : null}
      {timeZoneList ? (
        <SearchablePickerModal
          onClose={() => setPicker(undefined)}
          onSelect={(analysisTimeZone) => {
            setPicker(undefined);
            void updateProfile({ analysisTimeZone, followDeviceTimeZone: false });
          }}
          options={timeZoneList}
          searchLabel="Search time zones, for example London"
          selected={selectedTimeZone}
          title="Home time zone"
          visible={picker === "timeZone"}
        />
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1 },
  title: { fontSize: 16, lineHeight: 22, fontWeight: "800" },
  detail: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  loading: { marginTop: 18 },
  group: { marginTop: 16 },
  groupLabel: { fontSize: 11, lineHeight: 16, fontWeight: "800" },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 7 },
  option: { minHeight: 40, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" },
  optionText: { fontSize: 11, lineHeight: 16, fontWeight: "800" },
  textSettingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 7 },
  textSettingInput: { flex: 1, minHeight: 44, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, fontSize: 13 },
  countryInput: { width: 86, minHeight: 44, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, fontSize: 13 },
  saveSetting: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  saveSettingText: { fontSize: 11, fontWeight: "900" },
  moreButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 14,
    paddingTop: 4,
  },
  moreButtonText: { fontSize: 14, lineHeight: 19, fontWeight: "800" },
  pickerButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    marginTop: 7,
  },
  pickerValue: { flex: 1, fontSize: 13, lineHeight: 18 },
  pickerAction: { fontSize: 12, lineHeight: 17, fontWeight: "800" },
  settingHelp: { fontSize: 10, lineHeight: 15, marginTop: 6 },
  resolved: { fontSize: 10, lineHeight: 15, marginTop: 11 },
  error: { fontSize: 11, lineHeight: 17, marginTop: 9 },
});
