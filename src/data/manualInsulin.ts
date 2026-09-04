import { MANUAL_CONTEXT_SOURCE_ID } from '@/data/manualContext';
import type { BolusDelivery } from '@/domain/models';

export type ManualInsulinType = 'rapid-acting' | 'long-acting' | 'other';

export interface ManualInsulinDraft {
  timestamp: number;
  units: number;
  insulinType: ManualInsulinType;
}

const DELIVERY_TYPE_BY_INSULIN_TYPE: Record<ManualInsulinType, string> = {
  'rapid-acting': 'Manual rapid-acting dose',
  'long-acting': 'Manual long-acting dose',
  other: 'Manual insulin dose',
};

export const MANUAL_INSULIN_DELIVERY_TYPES = Object.freeze(
  Object.values(DELIVERY_TYPE_BY_INSULIN_TYPE),
);

function assertTimestamp(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Choose a valid date and time.');
  }
}

function assertUnits(value: number) {
  if (!Number.isFinite(value) || value <= 0 || value > 300) {
    throw new Error('Insulin must be more than 0 and no more than 300 units.');
  }
}

function createLocalId(timestamp: number) {
  const entropy = Math.random().toString(36).slice(2, 12);
  return `${MANUAL_CONTEXT_SOURCE_ID}:insulin:${timestamp}:${Date.now().toString(36)}-${entropy}`;
}

function insulinTypeFromDeliveryType(
  deliveryType: string | undefined,
): ManualInsulinType | undefined {
  return (Object.entries(DELIVERY_TYPE_BY_INSULIN_TYPE) as [
    ManualInsulinType,
    string,
  ][]).find(([, value]) => value === deliveryType)?.[0];
}

export function isManualInsulinDelivery(delivery: BolusDelivery) {
  return (
    delivery.sourceId === MANUAL_CONTEXT_SOURCE_ID &&
    insulinTypeFromDeliveryType(delivery.deliveryType) !== undefined
  );
}

export function manualInsulinDraftFromDelivery(
  delivery: BolusDelivery,
): ManualInsulinDraft {
  const insulinType = insulinTypeFromDeliveryType(delivery.deliveryType);
  if (
    delivery.sourceId !== MANUAL_CONTEXT_SOURCE_ID ||
    insulinType === undefined
  ) {
    throw new Error('Only insulin doses recorded in T1 Arc can be edited.');
  }
  return {
    timestamp: delivery.timestamp,
    units: delivery.units,
    insulinType,
  };
}

export function createManualInsulinDelivery(
  draft: ManualInsulinDraft,
  options: { id?: string; recordedAt?: number } = {},
): BolusDelivery {
  assertTimestamp(draft.timestamp);
  assertUnits(draft.units);
  const deliveryType = DELIVERY_TYPE_BY_INSULIN_TYPE[draft.insulinType];
  if (!deliveryType) {
    throw new Error('Choose an insulin type.');
  }
  return {
    id: options.id ?? createLocalId(draft.timestamp),
    timestamp: draft.timestamp,
    units: draft.units,
    deliveryType,
    sourceId: MANUAL_CONTEXT_SOURCE_ID,
    importedAt: options.recordedAt ?? Date.now(),
  };
}

export function reviseManualInsulinDelivery(
  existing: BolusDelivery,
  draft: ManualInsulinDraft,
) {
  if (!isManualInsulinDelivery(existing)) {
    throw new Error('Only insulin doses recorded in T1 Arc can be edited.');
  }
  return createManualInsulinDelivery(draft, {
    id: existing.id,
    recordedAt: existing.importedAt,
  });
}
