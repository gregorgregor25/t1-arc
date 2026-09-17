import type { TimelineData } from './models';

/** Descriptive observations only. Never infer a treatment effect or an amount to take. */
export function hypoTreatmentReviews(data: TimelineData) {
  const treatments = data.context.filter(event => event.observation?.kind === 'hypo-treatment').sort((a, b) => a.start - b.start);
  const glucose = [...data.glucose].sort((a, b) => a.timestamp - b.timestamp);
  return treatments.map(treatment => {
    const before = glucose.filter(reading => reading.timestamp <= treatment.start && reading.timestamp >= treatment.start - 10 * 60_000).at(-1);
    const after = glucose.find(reading => reading.timestamp >= treatment.start + 15 * 60_000 && reading.timestamp <= treatment.start + 25 * 60_000);
    const window = before && after ? glucose.filter(reading => reading.timestamp >= before.timestamp && reading.timestamp <= after.timestamp) : [];
    const continuous = window.length > 1 && !window.some((reading, index) => index > 0 && reading.timestamp - window[index - 1]!.timestamp > 12 * 60_000);
    return { treatment, before, after: continuous ? after : undefined, repeatCount: treatments.filter(other => other.id !== treatment.id && other.start > treatment.start && other.start <= treatment.start + 60 * 60_000).length };
  });
}
