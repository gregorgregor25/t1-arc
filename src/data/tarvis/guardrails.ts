import { evidenceIds } from './evidencePacket';
import { TarvisAnswer, TarvisEvidencePacket, TarvisUsage } from './types';

export const MAX_TARVIS_REQUESTS_PER_HOUR = 10;
export const MAX_TARVIS_REQUESTS_PER_DAY = 30;
const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const MAX_EVIDENCE_REFERENCES = 5;

function cleanModelText(value: unknown, validEvidenceIds: Set<string>) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\[([^\]]+)\]/g, (match, contents: string) => {
      const referencesKnownEvidence = [...validEvidenceIds].some((id) =>
        contents.includes(id),
      );
      return referencesKnownEvidence ? '' : match;
    })
    .replace(/\*\*|__|`/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function checkTarvisRateLimit(usage: TarvisUsage, now = Date.now()) {
  const recent = usage.requestTimestamps.filter(
    (timestamp) => now - timestamp < DAY_MS,
  );
  const hourly = recent.filter((timestamp) => now - timestamp < HOUR_MS);
  if (hourly.length >= MAX_TARVIS_REQUESTS_PER_HOUR) {
    throw new Error(
      'TARV1S has reached its 10-question hourly safety limit. Try again later.',
    );
  }
  if (recent.length >= MAX_TARVIS_REQUESTS_PER_DAY) {
    throw new Error(
      'TARV1S has reached its 30-question daily safety limit. Try again tomorrow.',
    );
  }
  return recent;
}

export function parseTarvisAnswer(
  value: string,
  packet?: TarvisEvidencePacket,
): TarvisAnswer {
  let parsed: Partial<TarvisAnswer>;
  try {
    parsed = JSON.parse(value) as Partial<TarvisAnswer>;
  } catch {
    throw new Error('TARV1S returned an unreadable answer. Please try again.');
  }
  const validEvidenceIds = packet ? evidenceIds(packet) : new Set<string>();
  const confidence =
    parsed.confidence === 'high' ||
    parsed.confidence === 'moderate' ||
    parsed.confidence === 'limited'
      ? parsed.confidence
      : 'limited';
  const answer = cleanModelText(parsed.answer, validEvidenceIds);
  if (!answer) {
    throw new Error('TARV1S returned an empty answer. Please try again.');
  }
  return {
    headline: cleanModelText(parsed.headline, validEvidenceIds)
      ? cleanModelText(parsed.headline, validEvidenceIds)
      : 'Evidence review',
    answer,
    confidence,
    evidenceIds: Array.isArray(parsed.evidenceIds)
      ? [...new Set(parsed.evidenceIds)]
          .filter(
            (id): id is string =>
              typeof id === 'string' && validEvidenceIds.has(id),
          )
          .slice(0, MAX_EVIDENCE_REFERENCES)
      : [],
    limitations: Array.isArray(parsed.limitations)
      ? parsed.limitations
          .filter((item): item is string => typeof item === 'string')
          .map((item) => cleanModelText(item, validEvidenceIds))
          .filter(Boolean)
          .slice(0, 5)
      : [],
  };
}
