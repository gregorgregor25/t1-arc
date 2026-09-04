import { relativeAge } from '@/domain/time';

function readableList(values: string[]) {
  if (values.length < 2) return values[0] ?? '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')} and ${values.at(-1)}`;
}

export function glucoseAutomationScope(sourceLabels: string[]) {
  const labels = Array.from(
    new Set(sourceLabels.map((label) => label.trim()).filter(Boolean)),
  );
  if (!labels.length) {
    return {
      label: 'Live glucose',
      connectedDetail: undefined,
    };
  }
  const sources = readableList(labels);
  return {
    label: 'Live glucose',
    connectedDetail: `${sources} ${labels.length === 1 ? 'is' : 'are'} connected and checked through this one update.`,
  };
}

export type AutomationHeaderKind =
  | 'checking'
  | 'refresh-failed'
  | 'unavailable'
  | 'attention'
  | 'active'
  | 'not-set-up';

interface AutomationHeaderInput {
  hasStatus: boolean;
  schedulerAvailable?: boolean;
  checkedAt?: number;
  latestRunAt?: number;
  loading: boolean;
  refreshFailed: boolean;
  hasAttention: boolean;
  registeredCount: number;
  now: number;
}

export function automationHeaderPresentation({
  hasStatus,
  schedulerAvailable,
  checkedAt,
  latestRunAt,
  loading,
  refreshFailed,
  hasAttention,
  registeredCount,
  now,
}: AutomationHeaderInput): {
  kind: AutomationHeaderKind;
  label: string;
  summary: string;
} {
  if (!hasStatus) {
    if (loading) {
      return {
        kind: 'checking',
        label: 'Checking',
        summary: 'Checking automatic update status…',
      };
    }
    return {
      kind: 'refresh-failed',
      label: 'Couldn’t check',
      summary: 'Automatic update status could not be checked.',
    };
  }

  if (refreshFailed) {
    return {
      kind: 'refresh-failed',
      label: 'Couldn’t refresh',
      summary:
        checkedAt === undefined
          ? 'Status could not be refreshed. Showing the previous result.'
          : `Status could not be refreshed. Last checked ${relativeAge(
              checkedAt,
              now,
            ).toLowerCase()}.`,
    };
  }

  const summary =
    latestRunAt === undefined
      ? 'Waiting for the first automatic check.'
      : `Last automatic check ${relativeAge(
          latestRunAt,
          checkedAt ?? now,
        ).toLowerCase()}.`;
  if (!schedulerAvailable) {
    return { kind: 'unavailable', label: 'Unavailable', summary };
  }
  if (hasAttention) {
    return { kind: 'attention', label: 'Check status', summary };
  }
  if (registeredCount) {
    return { kind: 'active', label: 'Active', summary };
  }
  return { kind: 'not-set-up', label: 'Not set up', summary };
}
