import { TarvisIntentV1 } from "./types";

const provenanceSchema = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: ["explicit", "conversation", "profile", "default", "derived"],
    },
    sourceText: { type: ["string", "null"] },
    sourceStart: { type: ["integer", "null"], minimum: 0 },
    sourceEnd: { type: ["integer", "null"], minimum: 0 },
    turnId: { type: ["string", "null"] },
    note: { type: ["string", "null"] },
  },
  required: [
    "kind",
    "sourceText",
    "sourceStart",
    "sourceEnd",
    "turnId",
    "note",
  ],
  additionalProperties: false,
} as const;

function fieldSchema(value: object) {
  return {
    type: "object",
    properties: {
      value,
      provenance: provenanceSchema,
    },
    required: ["value", "provenance"],
    additionalProperties: false,
  } as const;
}

const temporalScopeSchema = {
  anyOf: [
    {
      type: "object",
      properties: {
        kind: { const: "rolling" },
        amount: { type: "integer", minimum: 1 },
        unit: { type: "string", enum: ["minute", "hour", "day", "week"] },
        anchor: { const: "now" },
      },
      required: ["kind", "amount", "unit", "anchor"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "recent_local_days" },
        count: { type: "integer", minimum: 1 },
        include: {
          type: "string",
          enum: [
            "through_now",
            "completed_days",
            "most_recent_completed_windows",
          ],
        },
      },
      required: ["kind", "count", "include"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "calendar_period" },
        period: {
          type: "string",
          enum: [
            "today",
            "yesterday",
            "this_week",
            "last_week",
            "this_month",
            "last_month",
          ],
        },
      },
      required: ["kind", "period"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "calendar_date" },
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      },
      required: ["kind", "date"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "calendar_date_range" },
        startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        endDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        inclusiveEndDate: { const: true },
      },
      required: ["kind", "startDate", "endDate", "inclusiveEndDate"],
      additionalProperties: false,
    },
  ],
} as const;

const clockTimeSchema = {
  type: "object",
  properties: {
    hour: { type: "integer", minimum: 0, maximum: 23 },
    minute: { type: "integer", minimum: 0, maximum: 59 },
  },
  required: ["hour", "minute"],
  additionalProperties: false,
} as const;

const clockWindowFieldSchema = fieldSchema({
  type: "object",
  properties: {
    start: clockTimeSchema,
    end: clockTimeSchema,
    crossesMidnight: { type: "boolean" },
    occurrenceAnchor: { const: "start_date" },
  },
  required: ["start", "end", "crossesMidnight", "occurrenceAnchor"],
  additionalProperties: false,
});

const metricValues = [
  "glucose.current",
  "glucose.mean",
  "glucose.median",
  "glucose.minimum",
  "glucose.maximum",
  "glucose.standard_deviation",
  "glucose.coefficient_of_variation",
  "glucose.gmi",
  "glucose.time_in_range",
  "glucose.low_episodes",
  "glucose.high_episodes",
  "glucose.low_readings",
  "glucose.high_readings",
  "insulin.delivered_total",
  "insulin.basal_total",
  "insulin.bolus_total",
  "food.carbohydrate_total",
  "activity.duration",
  "sleep.duration",
  "data_quality.coverage",
  "data_quality.gaps",
] as const;

/**
 * Strict contract suitable for an eventual Structured Outputs fallback. Every
 * property is required; optional concepts are represented by null, and every
 * object rejects additional properties.
 */
export const TARVIS_INTENT_V1_JSON_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: { const: 1 },
    question: { type: "string", minLength: 1 },
    normalizedQuestion: { type: "string", minLength: 1 },
    domain: fieldSchema({
      type: "string",
      enum: [
        "glucose",
        "insulin",
        "food",
        "activity",
        "sleep",
        "health",
        "data_quality",
      ],
    }),
    metrics: {
      type: "array",
      minItems: 1,
      items: fieldSchema({ type: "string", enum: metricValues }),
    },
    operation: fieldSchema({
      type: "string",
      enum: [
        "current",
        "aggregate",
        "count_episodes",
        "count_readings",
        "range_distribution",
        "inspect_data_quality",
      ],
    }),
    temporalScope: fieldSchema(temporalScopeSchema),
    clockWindow: { anyOf: [{ type: "null" }, clockWindowFieldSchema] },
    comparison: {
      anyOf: [
        { type: "null" },
        fieldSchema({
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: ["previous_equal_period", "explicit_periods"],
            },
          },
          required: ["kind"],
          additionalProperties: false,
        }),
      ],
    },
    thresholds: {
      type: "array",
      items: fieldSchema({
        type: "object",
        properties: {
          operator: { type: "string", enum: ["lt", "lte", "gt", "gte"] },
          value: { type: "number" },
          unit: { type: "string", enum: ["mmol/L", "mg/dL"] },
          role: {
            type: "string",
            enum: ["low", "high", "range_lower", "range_upper"],
          },
        },
        required: ["operator", "value", "unit", "role"],
        additionalProperties: false,
      }),
    },
  },
  required: [
    "schemaVersion",
    "question",
    "normalizedQuestion",
    "domain",
    "metrics",
    "operation",
    "temporalScope",
    "clockWindow",
    "comparison",
    "thresholds",
  ],
  additionalProperties: false,
} as const;

type JsonSchema = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaTypeMatches(value: unknown, type: string) {
  switch (type) {
    case "null":
      return value === null;
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    default:
      return false;
  }
}

function validateAgainstSchema(
  value: unknown,
  schema: JsonSchema,
  path: string,
  errors: string[],
): void {
  if (Array.isArray(schema.anyOf)) {
    const branchErrors = schema.anyOf.map((branch) => {
      const candidateErrors: string[] = [];
      validateAgainstSchema(value, branch as JsonSchema, path, candidateErrors);
      return candidateErrors;
    });
    if (!branchErrors.some((candidate) => candidate.length === 0)) {
      errors.push(`${path} does not match any allowed shape`);
    }
    return;
  }
  if ("const" in schema && value !== schema.const) {
    errors.push(`${path} must equal ${String(schema.const)}`);
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path} has an unrecognised value`);
    return;
  }
  const declaredTypes = Array.isArray(schema.type)
    ? (schema.type as string[])
    : typeof schema.type === "string"
      ? [schema.type]
      : [];
  if (
    declaredTypes.length > 0 &&
    !declaredTypes.some((type) => schemaTypeMatches(value, type))
  ) {
    errors.push(`${path} has the wrong type`);
    return;
  }
  if (value === null) return;
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(`${path} is below its minimum`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push(`${path} is above its maximum`);
    }
  }
  if (typeof value === "string") {
    if (
      typeof schema.minLength === "number" &&
      value.length < schema.minLength
    ) {
      errors.push(`${path} is too short`);
    }
    if (
      typeof schema.pattern === "string" &&
      !new RegExp(schema.pattern).test(value)
    ) {
      errors.push(`${path} has the wrong format`);
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`${path} has too few items`);
    }
    if (isRecord(schema.items)) {
      value.forEach((item, index) =>
        validateAgainstSchema(
          item,
          schema.items as JsonSchema,
          `${path}[${index}]`,
          errors,
        ),
      );
    }
    return;
  }
  if (isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required)
      ? (schema.required as string[])
      : [];
    for (const key of required) {
      if (!(key in value)) errors.push(`${path}.${key} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) errors.push(`${path}.${key} is not allowed`);
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (key in value && isRecord(propertySchema)) {
        validateAgainstSchema(
          value[key],
          propertySchema,
          `${path}.${key}`,
          errors,
        );
      }
    }
  }
}

export interface TarvisIntentValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateTarvisIntentV1(
  value: unknown,
): TarvisIntentValidationResult {
  const errors: string[] = [];
  validateAgainstSchema(
    value,
    TARVIS_INTENT_V1_JSON_SCHEMA as unknown as JsonSchema,
    "$",
    errors,
  );
  return { valid: errors.length === 0, errors };
}

export function isTarvisIntentV1(value: unknown): value is TarvisIntentV1 {
  return validateTarvisIntentV1(value).valid;
}
