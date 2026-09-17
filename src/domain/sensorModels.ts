/** Manufacturer warm-up guidance checked 15 September 2026; see docs/SENSOR_WARMUP.md. */
export const SENSOR_MODELS = [
  { id: 'libre-2', label: 'FreeStyle Libre 2', warmupMinutes: 60 },
  { id: 'libre-2-plus', label: 'FreeStyle Libre 2 Plus', warmupMinutes: 60 },
  { id: 'libre-3', label: 'FreeStyle Libre 3', warmupMinutes: 60 },
  { id: 'libre-3-plus', label: 'FreeStyle Libre 3 Plus', warmupMinutes: 60 },
  { id: 'dexcom-g6', label: 'Dexcom G6', warmupMinutes: 120 },
  { id: 'dexcom-g7', label: 'Dexcom G7', warmupMinutes: 30 },
  { id: 'dexcom-g7-15-day', label: 'Dexcom G7 15 Day', warmupMinutes: 60 },
  { id: 'dexcom-one-plus', label: 'Dexcom ONE+', warmupMinutes: 30 },
  { id: 'other', label: 'Other / not sure', warmupMinutes: undefined },
] as const;

export type SensorModelId = typeof SENSOR_MODELS[number]['id'];

export function sensorModel(id?: string) {
  return SENSOR_MODELS.find((model) => model.id === id);
}

export function validSensorWarmupMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1440;
}

export function sensorSelection(modelId?: string, customMinutes?: number) {
  const model = sensorModel(modelId);
  if (modelId !== undefined && !model) throw new Error('Choose a sensor model, or Other / not sure.');
  if (customMinutes !== undefined && !validSensorWarmupMinutes(customMinutes)) {
    throw new Error('Enter a whole warm-up time between 1 and 1440 minutes, or leave it blank.');
  }
  return { modelId: model?.id, warmupMinutes: model?.warmupMinutes ?? customMinutes };
}
