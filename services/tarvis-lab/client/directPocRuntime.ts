import T1ArcTarvisDirect from '../../../modules/t1arc-tarvis-direct';
import { runTarvisDirectConversation } from './directConversation';
import { TarvisDirectLocalToolExecutor } from './directLocalTools';
import type { TarvisConversationTurn } from '@/data/tarvis/types';
import type { TimelineData, TimeRange } from '@/domain/models';
import { formatTime, toDateKey } from '@/domain/time';
import { glucoseUnitLabel } from '@/domain/regionalFormat';
import { getRuntimeRegionalDefaults } from '@/domain/regionalProfileRuntime';

export interface TarvisDirectPocRequest {
  allowedRange: TimeRange;
  history: TarvisConversationTurn[];
  loadTimelineData(range: TimeRange): Promise<TimelineData>;
  question: string;
}

export function isTarvisDirectPocRequested() {
  return process.env.EXPO_PUBLIC_TARVIS_DIRECT_MTLS_POC_ENABLED === '1';
}

export async function askTarvisDirectPoc(request: TarvisDirectPocRequest) {
  if (!isTarvisDirectPocRequested()) {
    throw new Error('The isolated TARV1S direct-mTLS proof of concept is disabled.');
  }
  if (!T1ArcTarvisDirect) {
    throw new Error(
      'This private T1 Arc build does not contain the direct-mTLS Android module.',
    );
  }
  const config = readConfig();
  let status = await T1ArcTarvisDirect.getStatusAsync();
  if (!status.enabled) {
    throw new Error(
      'The native TARV1S direct-mTLS feature flag is disabled in this build.',
    );
  }
  if (
    !status.enrolled ||
    (status.certificateExpiresAtMs ?? 0) <= Date.now() + 60_000
  ) {
    await T1ArcTarvisDirect.enrollAsync(
      config.enrollmentUrl,
      config.enrollmentBearer,
    );
    status = await T1ArcTarvisDirect.getStatusAsync();
  }
  if (!status.enrolled) {
    throw new Error('This phone could not establish its hardware-bound identity.');
  }
  try {
    await T1ArcTarvisDirect.exchangeOpenAiTokenAsync(
      config.identityProviderId,
      config.serviceAccountId,
    );
  } catch (error) {
    if (!isInvalidSubjectTokenError(error)) throw error;
    await T1ArcTarvisDirect.clearAsync();
    await T1ArcTarvisDirect.enrollAsync(
      config.enrollmentUrl,
      config.enrollmentBearer,
    );
    await T1ArcTarvisDirect.exchangeOpenAiTokenAsync(
      config.identityProviderId,
      config.serviceAccountId,
    );
  }
  const tools = new TarvisDirectLocalToolExecutor({
    allowedRange: request.allowedRange,
    loadTimelineData: request.loadTimelineData,
    question: request.question,
  });
  const regional = getRuntimeRegionalDefaults();
  return runTarvisDirectConversation({
    model: config.model,
    question: request.question,
    history: request.history.map(({ role, text }) => ({ role, text })),
    context: `T1 Arc's current local date is ${toDateKey(Date.now())} and local time is ${formatTime(Date.now())} in ${regional.timeZone}. The user's locale is ${regional.locale}, preferred glucose unit is ${glucoseUnitLabel(regional.glucoseUnit)}, measurement system is ${regional.measurementSystem}, energy unit is ${regional.energyUnit}, and clinical-guidance jurisdiction is ${regional.clinicalJurisdiction}. Present all user-facing values and dates for those preferences while preserving exact recorded quantities. The authorised local evidence window is ${request.allowedRange.start} through ${request.allowedRange.end} Unix milliseconds. Resolve exact local calendar boundaries with the date-range tool before querying relative periods such as today, yesterday, or named weekdays.`,
    transport: T1ArcTarvisDirect,
    tools,
    reasoningEffort: config.reasoningEffort,
  });
}

function isInvalidSubjectTokenError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /invalid subject token/i.test(message);
}

function readConfig() {
  return {
    enrollmentUrl: required(
      process.env.EXPO_PUBLIC_TARVIS_DIRECT_ENROLLMENT_URL,
      'EXPO_PUBLIC_TARVIS_DIRECT_ENROLLMENT_URL',
    ),
    enrollmentBearer: required(
      process.env.EXPO_PUBLIC_TARVIS_DIRECT_ENROLLMENT_BEARER,
      'EXPO_PUBLIC_TARVIS_DIRECT_ENROLLMENT_BEARER',
    ),
    identityProviderId: required(
      process.env.EXPO_PUBLIC_TARVIS_DIRECT_OPENAI_IDENTITY_PROVIDER_ID,
      'EXPO_PUBLIC_TARVIS_DIRECT_OPENAI_IDENTITY_PROVIDER_ID',
    ),
    serviceAccountId: required(
      process.env.EXPO_PUBLIC_TARVIS_DIRECT_OPENAI_SERVICE_ACCOUNT_ID,
      'EXPO_PUBLIC_TARVIS_DIRECT_OPENAI_SERVICE_ACCOUNT_ID',
    ),
    model:
      process.env.EXPO_PUBLIC_TARVIS_DIRECT_MODEL?.trim() || 'gpt-5.6-luna',
    reasoningEffort: reasoningEffort(
      process.env.EXPO_PUBLIC_TARVIS_DIRECT_REASONING_EFFORT,
    ),
  };
}

function required(value: string | undefined, name: string) {
  const cleaned = value?.trim();
  if (!cleaned) throw new Error(`${name} is missing from this private test build.`);
  return cleaned;
}

function reasoningEffort(value: string | undefined) {
  const cleaned = value?.trim() || 'low';
  if (!['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(cleaned)) {
    throw new Error('EXPO_PUBLIC_TARVIS_DIRECT_REASONING_EFFORT is invalid.');
  }
  return cleaned as 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}
