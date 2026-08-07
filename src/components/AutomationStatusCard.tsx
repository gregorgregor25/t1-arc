import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { SectionCard } from './SectionCard';
import {
  AutomationConnector,
  AutomationOutcome,
  AutomationRun,
  isInterruptedAutomationRun,
} from '@/data/background/automationRunLog';
import type { AutomationDataEvidence } from '@/data/background/automationEvidence';
import {
  AutomationConnectorIssue,
  automationIssueDetail,
  automationIssueForOutcome,
  automationIssueMeta,
  automationOutcomeWithIssue,
} from '@/data/background/automationIssue';
import {
  AutomationStatus,
  getAutomationStatus,
} from '@/data/background/automationStatus';
import type { AutomationTiming } from '@/data/background/automationTiming';
import { formatTime, relativeAge } from '@/domain/time';
import { AppColors, useAppTheme } from '@/theme/theme';

interface ConnectorPresentation {
  connector: AutomationConnector;
  label: string;
  disabledDetail: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const CONNECTORS: ConnectorPresentation[] = [
  {
    connector: 'glucose',
    label: 'Glucose',
    disabledDetail:
      'Connect a live glucose source to enable automatic checks.',
    icon: 'pulse-outline',
  },
  {
    connector: 'health-connect',
    label: 'Health data',
    disabledDetail: 'Allow background access in Health Connect to enable.',
    icon: 'fitness-outline',
  },
  {
    connector: 'glooko',
    label: 'Glooko',
    disabledDetail: 'Complete one Glooko sync to enable automatic updates.',
    icon: 'archive-outline',
  },
  {
    connector: 'insight-review',
    label: 'Scheduled reviews',
    disabledDetail: 'Turn on scheduled reviews to enable.',
    icon: 'sparkles-outline',
  },
];

function outcomePresentation(
  outcome: AutomationOutcome,
  colors: AppColors,
  staleRunning: boolean,
  interrupted: boolean,
) {
  if (interrupted || (outcome === 'running' && staleRunning)) {
    return { label: 'Interrupted', tone: colors.warning };
  }
  switch (outcome) {
    case 'running':
      return { label: 'Updating', tone: colors.primary };
    case 'success':
      return { label: 'Updated', tone: colors.accent };
    case 'partial':
      return { label: 'Some issues', tone: colors.warning };
    case 'skipped':
      return { label: 'Checked', tone: colors.textSecondary };
    case 'needs-attention':
      return { label: 'Needs attention', tone: colors.warning };
    case 'failed':
      return { label: 'Couldn’t update', tone: colors.danger };
  }
}

function runCounts(run: AutomationRun) {
  const parts: string[] = [];
  if (run.recordsProcessed) {
    parts.push(
      `${run.recordsProcessed.toLocaleString('en-GB')} records handled`,
    );
  }
  if (run.recordsRemoved) {
    parts.push(
      `${run.recordsRemoved.toLocaleString('en-GB')} removed`,
    );
  }
  return parts.join(' · ');
}

export function automationEvidenceMeta(
  evidence: AutomationDataEvidence,
  now: number,
  checkedAt?: number,
) {
  const parts: string[] = [];
  if (checkedAt !== undefined) {
    parts.push(`Checked ${relativeAge(checkedAt, now).toLowerCase()}`);
  } else if (evidence.lastStoredAt !== undefined) {
    parts.push(
      `Stored ${relativeAge(evidence.lastStoredAt, now).toLowerCase()}`,
    );
  }
  if (evidence.dataThrough !== undefined) {
    parts.push(
      `Data through ${relativeAge(evidence.dataThrough, now).toLowerCase()}`,
    );
  }
  parts.push(
    evidence.recordCount
      ? `${evidence.recordCount.toLocaleString('en-GB')} stored`
      : 'No records stored',
  );
  return parts.join(' · ');
}

function friendlyRunDetail(
  run: AutomationRun,
  connectorLabel: string,
) {
  if (
    run.detail &&
    !/Call to function|java\.|SQLite|Exception|stack|rejected/i.test(
      run.detail,
    )
  ) {
    return run.detail;
  }
  if (isInterruptedAutomationRun(run)) {
    return 'Android stopped this update. T1 Arc will try again automatically.';
  }
  if (run.outcome === 'running') return 'The update is still in progress.';
  if (run.outcome === 'failed') {
    return `${connectorLabel} did not finish updating. T1 Arc will try again automatically.`;
  }
  return run.detail;
}

function ConnectorRow({
  item,
  registered,
  run,
  issue,
  evidence,
  timing,
  now,
  last,
}: {
  item: ConnectorPresentation;
  registered: boolean;
  run?: AutomationRun;
  issue?: AutomationConnectorIssue;
  evidence: AutomationDataEvidence;
  timing: AutomationTiming;
  now: number;
  last: boolean;
}) {
  const { colors, radius } = useAppTheme();
  const staleRunning =
    run?.outcome === 'running' && now - run.startedAt > 15 * 60 * 1000;
  const visibleIssue = automationIssueForOutcome(run?.outcome, issue);
  const effectiveOutcome = automationOutcomeWithIssue(
    run?.outcome,
    visibleIssue,
  );
  const presentation = effectiveOutcome
    ? outcomePresentation(
        effectiveOutcome,
        colors,
        staleRunning,
        visibleIssue ? false : Boolean(run && isInterruptedAutomationRun(run)),
      )
    : registered
      ? {
          label: evidence.recordCount ? 'Ready' : 'Waiting',
          tone: evidence.recordCount
            ? colors.primary
            : colors.textSecondary,
        }
      : evidence.recordCount
        ? {
            label: 'Stored',
            tone: colors.textSecondary,
          }
        : {
            label: 'Not enabled',
            tone: colors.textTertiary,
          };
  const detail =
    (visibleIssue ? automationIssueDetail(visibleIssue) : undefined) ??
    (run ? friendlyRunDetail(run, item.label) : undefined) ??
    (registered
      ? evidence.recordCount
        ? 'Android is waiting for the next suitable background window.'
        : 'The background worker is ready; no source records have arrived yet.'
      : evidence.recordCount
        ? 'Stored data is available; automatic updates are not enabled.'
        : item.disabledDetail);
  const meta = visibleIssue
    ? automationIssueMeta(visibleIssue, evidence, now)
    : automationEvidenceMeta(
        evidence,
        now,
        run?.completedAt ?? run?.startedAt,
      );

  return (
    <View
      style={[
        styles.connectorRow,
        !last && {
          borderBottomColor: colors.divider,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View
        style={[
          styles.connectorIcon,
          {
            backgroundColor: `${presentation.tone}14`,
            borderRadius: radius.sm,
          },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={presentation.tone}
          name={item.icon}
          size={21}
        />
      </View>
      <View style={styles.connectorCopy}>
        <View style={styles.connectorTitleRow}>
          <Text style={[styles.connectorTitle, { color: colors.text }]}>
            {item.label}
          </Text>
          <View style={styles.statusLabel}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: presentation.tone },
              ]}
            />
            <Text
              style={[
                styles.statusText,
                { color: presentation.tone },
              ]}
            >
              {presentation.label}
            </Text>
          </View>
        </View>
        <Text
          numberOfLines={2}
          style={[styles.connectorDetail, { color: colors.textSecondary }]}
        >
          {detail}
        </Text>
        <Text style={[styles.connectorMeta, { color: colors.textTertiary }]}>
          {meta}
        </Text>
        <View style={styles.timingRow}>
          <Ionicons
            accessibilityElementsHidden
            color={
              timing.state === 'due' || timing.state === 'paused'
                ? colors.warning
                : colors.textTertiary
            }
            name={
              timing.state === 'paused'
                ? 'pause-circle-outline'
                : timing.state === 'due'
                  ? 'timer-outline'
                  : 'calendar-outline'
            }
            size={13}
          />
          <Text
            style={[
              styles.timingText,
              {
                color:
                  timing.state === 'due' || timing.state === 'paused'
                    ? colors.textSecondary
                    : colors.textTertiary,
              },
            ]}
          >
            {timing.nextEligibleAt !== undefined
              ? `Next eligible ${formatTime(timing.nextEligibleAt)} · `
              : ''}
            {timing.detail}
          </Text>
        </View>
      </View>
    </View>
  );
}

export function AutomationStatusCard() {
  const { colors, radius } = useAppTheme();
  const [status, setStatus] = useState<AutomationStatus>();
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await getAutomationStatus());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      const appState = AppState.addEventListener('change', (nextState) => {
        if (nextState === 'active') void refresh();
      });
      const interval = setInterval(() => {
        void refresh();
      }, 60_000);
      return () => {
        appState.remove();
        clearInterval(interval);
      };
    }, [refresh]),
  );

  const latestByConnector = useMemo(() => {
    const result = new Map<AutomationConnector, AutomationRun>();
    status?.runs.forEach((run) => {
      if (!result.has(run.connector)) result.set(run.connector, run);
    });
    return result;
  }, [status?.runs]);

  const registeredCount = status
    ? Object.values(status.registered).filter(Boolean).length
    : 0;
  const hasAttention = CONNECTORS.some(({ connector }) => {
    const run = latestByConnector.get(connector);
    const outcome = automationOutcomeWithIssue(
      run?.outcome,
      status?.issues[connector],
    );
    return (
      outcome === 'failed' ||
      outcome === 'needs-attention' ||
      outcome === 'partial' ||
      Boolean(run && isInterruptedAutomationRun(run))
    );
  });
  const overall = !status?.schedulerAvailable
    ? { label: 'Unavailable', tone: colors.danger }
    : hasAttention
      ? { label: 'Check status', tone: colors.warning }
    : registeredCount
      ? { label: 'Active', tone: colors.accent }
      : { label: 'Not set up', tone: colors.textTertiary };
  const latestRun = status?.runs[0];
  const history = status?.runs.slice(0, 8) ?? [];

  return (
    <SectionCard accessibilityLabel="Automatic update status">
      <View style={styles.header}>
        <View
          style={[
            styles.headerIcon,
            {
              backgroundColor: `${overall.tone}16`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={overall.tone}
            name="sync-outline"
            size={24}
          />
        </View>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]}>
            Automatic updates
          </Text>
          <Text style={[styles.summary, { color: colors.textSecondary }]}>
            {latestRun
              ? `Last background activity ${relativeAge(
                  latestRun.completedAt ?? latestRun.startedAt,
                  status?.checkedAt,
                ).toLowerCase()}.`
              : 'Android is waiting for the first background run.'}
          </Text>
        </View>
        <View
          style={[
            styles.overallPill,
            {
              backgroundColor: `${overall.tone}14`,
              borderColor: `${overall.tone}55`,
            },
          ]}
        >
          <View style={[styles.statusDot, { backgroundColor: overall.tone }]} />
          <Text style={[styles.overallText, { color: overall.tone }]}>
            {overall.label}
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.explanation,
          {
            backgroundColor: colors.surfaceMuted,
            borderRadius: radius.md,
          },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={colors.primary}
          name="time-outline"
          size={20}
        />
        <Text style={[styles.explanationText, { color: colors.textSecondary }]}>
          Android chooses the exact battery-friendly time. Each connected
          source still keeps its own refresh interval and records every
          background check locally.
        </Text>
      </View>

      {loading && !status ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Checking automatic updates…
          </Text>
        </View>
      ) : error && !status ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void refresh()}
          style={({ pressed }) => [
            styles.retry,
            {
              borderColor: colors.border,
              borderRadius: radius.md,
              backgroundColor: pressed
                ? colors.surfaceMuted
                : colors.surface,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.warning}
            name="warning-outline"
            size={20}
          />
          <Text style={[styles.retryText, { color: colors.text }]}>
            Status could not be checked. Tap to retry.
          </Text>
        </Pressable>
      ) : status ? (
        <View>
          {CONNECTORS.map((item, index) => (
            <ConnectorRow
              item={item}
              key={item.connector}
              last={index === CONNECTORS.length - 1}
              now={status.checkedAt}
              registered={status.registered[item.connector]}
              run={latestByConnector.get(item.connector)}
              issue={status.issues[item.connector]}
              evidence={status.evidence[item.connector]}
              timing={status.timing[item.connector]}
            />
          ))}
        </View>
      ) : null}

      {history.length ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            onPress={() => setExpanded((value) => !value)}
            style={({ pressed }) => [
              styles.historyButton,
              {
                borderColor: colors.border,
                borderRadius: radius.md,
                backgroundColor: pressed
                  ? colors.surfaceMuted
                  : colors.surface,
              },
            ]}
          >
            <Text style={[styles.historyButtonText, { color: colors.primary }]}>
              {expanded ? 'Hide update history' : 'View update history'}
            </Text>
            <Ionicons
              accessibilityElementsHidden
              color={colors.primary}
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={18}
            />
          </Pressable>
          {expanded ? (
            <View
              style={[
                styles.history,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderRadius: radius.md,
                },
              ]}
            >
              {history.map((run, index) => {
                const item = CONNECTORS.find(
                  (candidate) => candidate.connector === run.connector,
                );
                const stale =
                  run.outcome === 'running' &&
                  status!.checkedAt - run.startedAt > 15 * 60 * 1000;
                const presentation = outcomePresentation(
                  run.outcome,
                  colors,
                  stale,
                  isInterruptedAutomationRun(run),
                );
                const detail = friendlyRunDetail(
                  run,
                  item?.label ?? 'Automatic update',
                );
                return (
                  <View
                    key={run.id}
                    style={[
                      styles.historyRow,
                      index < history.length - 1 && {
                        borderBottomColor: colors.divider,
                        borderBottomWidth: StyleSheet.hairlineWidth,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.historyDot,
                        { backgroundColor: presentation.tone },
                      ]}
                    />
                    <View style={styles.historyCopy}>
                      <Text style={[styles.historyTitle, { color: colors.text }]}>
                        {item?.label ?? 'Automatic update'} ·{' '}
                        {presentation.label}
                      </Text>
                      <Text
                        style={[
                          styles.historyMeta,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {relativeAge(
                          run.completedAt ?? run.startedAt,
                          status!.checkedAt,
                        )}
                        {runCounts(run) ? ` · ${runCounts(run)}` : ''}
                        {detail ? ` · ${detail}` : ''}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}
        </>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
  },
  summary: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  overallPill: {
    minHeight: 30,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    gap: 6,
  },
  overallText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 99,
  },
  explanation: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    marginTop: 16,
  },
  explanationText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  loading: {
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  loadingText: {
    fontSize: 12,
    lineHeight: 18,
  },
  retry: {
    minHeight: 52,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 16,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  retryText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  connectorRow: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
  },
  connectorIcon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectorCopy: {
    flex: 1,
    minWidth: 0,
  },
  connectorTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  connectorTitle: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  statusLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
  },
  connectorDetail: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  connectorMeta: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 3,
  },
  timingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    marginTop: 4,
  },
  timingText: {
    flex: 1,
    fontSize: 9,
    lineHeight: 14,
  },
  historyButton: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  historyButtonText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  history: {
    marginTop: 10,
    paddingHorizontal: 12,
  },
  historyRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    paddingVertical: 11,
  },
  historyDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
    marginTop: 5,
  },
  historyCopy: {
    flex: 1,
  },
  historyTitle: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
  },
  historyMeta: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
});
