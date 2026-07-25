/**
 * Google Health API data-type registry — single source of truth.
 *
 * Source: Google Health API data types table, developers.google.com/health
 * — operations and webhook support last reconciled 2026-07-25.
 *
 * Rule (docs/PLAN.md "Watchouts"): kebab-case names are used in endpoint
 * paths (e.g. `body-fat`); snake_case names are used as filter-parameter
 * prefixes (e.g. `body_fat`). ALL kebab <-> snake conversion must go
 * through this registry — never ad-hoc `.replace("-", "_")` or similar
 * elsewhere in the codebase.
 */

export type DataTypeOp =
  | "list"
  | "get"
  | "reconcile"
  | "rollup"
  | "dailyRollup"
  | "create"
  | "update"
  | "batchDelete";

export type ScopeGroup =
  | "activity_and_fitness"
  | "health_metrics_and_measurements"
  | "nutrition"
  | "sleep"
  | "ecg"
  | "irn"
  | "location";

export type RecordType = "Interval" | "Sample" | "Daily" | "Session" | "Food";

export interface DataTypeSpec {
  /** Endpoint path segment, e.g. "body-fat". */
  kebab: string;
  /** Filter-parameter prefix, e.g. "body_fat". */
  snake: string;
  recordType: RecordType;
  scopeGroup: ScopeGroup;
  ops: readonly DataTypeOp[];
  webhookSupport: boolean;
  trueZeros: boolean;
}

export const DATA_TYPES: Readonly<Record<string, DataTypeSpec>> = {
  "active-energy-burned": {
    kebab: "active-energy-burned",
    snake: "active_energy_burned",
    recordType: "Interval",
    scopeGroup: "activity_and_fitness",
    ops: ["list", "reconcile", "rollup", "dailyRollup"],
    webhookSupport: false,
    trueZeros: false,
  },
  "active-minutes": {
    kebab: "active-minutes",
    snake: "active_minutes",
    recordType: "Interval",
    scopeGroup: "activity_and_fitness",
    ops: ["list", "reconcile", "rollup", "dailyRollup"],
    webhookSupport: false,
    trueZeros: false,
  },
  "active-zone-minutes": {
    kebab: "active-zone-minutes",
    snake: "active_zone_minutes",
    recordType: "Interval",
    scopeGroup: "activity_and_fitness",
    ops: ["list", "reconcile", "rollup", "dailyRollup"],
    webhookSupport: true,
    trueZeros: false,
  },
  "activity-level": {
    kebab: "activity-level",
    snake: "activity_level",
    recordType: "Interval",
    scopeGroup: "activity_and_fitness",
    ops: ["list", "reconcile"],
    webhookSupport: true,
    trueZeros: false,
  },
  altitude: {
    kebab: "altitude",
    snake: "altitude",
    recordType: "Interval",
    scopeGroup: "activity_and_fitness",
    ops: ["list", "reconcile", "rollup", "dailyRollup"],
    webhookSupport: true,
    trueZeros: true,
  },
  "basal-energy-burned": {
    kebab: "basal-energy-burned",
    snake: "basal_energy_burned",
    recordType: "Interval",
    scopeGroup: "activity_and_fitness",
    ops: ["list", "reconcile"],
    webhookSupport: false,
    trueZeros: false,
  },
  "basal-metabolic-rate": {
    kebab: "basal-metabolic-rate",
    snake: "basal_metabolic_rate",
    recordType: "Sample",
    scopeGroup: "nutrition",
    ops: ["list", "reconcile"],
    webhookSupport: false,
    trueZeros: false,
  },
  "blood-glucose": {
    kebab: "blood-glucose",
    snake: "blood_glucose",
    recordType: "Sample",
    scopeGroup: "health_metrics_and_measurements",
    ops: ["list", "get", "reconcile", "rollup", "dailyRollup"],
    webhookSupport: true,
    trueZeros: false,
  },
  "body-fat": {
    kebab: "body-fat",
    snake: "body_fat",
    recordType: "Sample",
    scopeGroup: "health_metrics_and_measurements",
    ops: ["list", "get", "reconcile", "rollup", "dailyRollup", "create", "update", "batchDelete"],
    webhookSupport: true,
    trueZeros: false,
  },
  "calories-in-heart-rate-zone": {
    kebab: "calories-in-heart-rate-zone",
    snake: "calories_in_heart_rate_zone",
    recordType: "Interval",
    scopeGroup: "activity_and_fitness",
    ops: ["rollup", "dailyRollup"],
    webhookSupport: true,
    trueZeros: false,
  },
  "core-body-temperature": {
    kebab: "core-body-temperature",
    snake: "core_body_temperature",
    recordType: "Sample",
    scopeGroup: "health_metrics_and_measurements",
    ops: ["list", "get", "reconcile", "rollup", "dailyRollup"],
    webhookSupport: false,
    trueZeros: false,
  },
  "daily-heart-rate-variability": {
    kebab: "daily-heart-rate-variability",
    snake: "daily_heart_rate_variability",
    recordType: "Daily",
    scopeGroup: "health_metrics_and_measurements",
    ops: ["list", "reconcile"],
    webhookSupport: true,
    trueZeros: false,
  },
  "daily-heart-rate-zones": {
    kebab: "daily-heart-rate-zones",
    snake: "daily_heart_rate_zones",
    recordType: "Daily",
    scopeGroup: "health_metrics_and_measurements",
    ops: ["list", "reconcile"],
    webhookSupport: true,
    trueZeros: false,
  },
  "daily-oxygen-saturation": {
    kebab: "daily-oxygen-saturation",
    snake: "daily_oxygen_saturation",
    recordType: "Daily",
    scopeGroup: "health_metrics_and_measurements",
    ops: ["list", "reconcile"],
    webhookSupport: true,
    trueZeros: false,
  },
  "daily-respiratory-rate": {
    kebab: "daily-respiratory-rate",
    snake: "daily_respiratory_rate",
    recordType: "Daily",
    scopeGroup: "health_metrics_and_measurements",
    ops: ["list", "reconcile"],
    webhookSupport: true,
    trueZeros: false,
  },
  "daily-resting-heart-rate": {
    kebab: "daily-resting-heart-rate",
    snake: "daily_resting_heart_rate",
    recordType: "Daily",
    scopeGroup: "health_metrics_and_measurements",
    ops: ["list", "reconcile"],
    webhookSupport: true,
    trueZeros: false,
  },
  "daily-sleep-temperature-derivations": {
    kebab: "daily-sleep-temperature-derivations",
    snake: "daily_sleep_temperature_derivations",
    recordType: "Daily",
    scopeGroup: "health_metrics_and_measurements",
    ops: ["list", "reconcile"],
    webhookSupport: true,
    trueZeros: false,
  },
  "daily-vo2-max": {
    kebab: "daily-vo2-max",
    snake: "daily_vo2_max",
    recordType: "Daily",
    scopeGroup: "activity_and_fitness",
    ops: ["list", "reconcile"],
    webhookSupport: false,
    trueZeros: false,
  },
  distance: {
    kebab: "distance",
    snake: "distance",
    recordType: "Interval",
    scopeGroup: "activity_and_fitness",
    ops: ["list", "reconcile", "rollup", "dailyRollup"],
    webhookSupport: true,
    trueZeros: true,
  },
  electrocardiogram: {
    kebab: "electrocardiogram",
    snake: "electrocardiogram",
    recordType: "Session",
    scopeGroup: "ecg",
    ops: ["list"],
    webhookSupport: false,
    trueZeros: false,
  },
  exercise: {
    kebab: "exercise",
    snake: "exercise",
    recordType: "Session",
    scopeGroup: "activity_and_fitness",
    ops: ["list", "get", "reconcile", "create", "update", "batchDelete"],
    webhookSupport: true,
    trueZeros: false,
  },
  floors: {
    kebab: "floors",
    snake: "floors",
    recordType: "Interval",
    scopeGroup: "activity_and_fitness",
    ops: ["reconcile", "rollup", "dailyRollup"],
    webhookSupport: true,
    trueZeros: true,
  },
  food: {
    kebab: "food",
    snake: "food",
    recordType: "Food",
    scopeGroup: "nutrition",
    ops: ["list", "get"],
    webhookSupport: false,
    trueZeros: false,
  },
  "food-measurement-unit": {
    kebab: "food-measurement-unit",
    snake: "food_measurement_unit",
    recordType: "Food",
    scopeGroup: "nutrition",
    ops: ["list", "get"],
    webhookSupport: false,
    trueZeros: false,
  },
  "heart-rate": {
    kebab: "heart-rate",
    snake: "heart_rate",
    recordType: "Sample",
    scopeGroup: "health_metrics_and_measurements",
    ops: ["list", "reconcile", "rollup", "dailyRollup"],
    webhookSupport: true,
    trueZeros: false,
  },
  "heart-rate-variability": {
    kebab: "heart-rate-variability",
    snake: "heart_rate_variability",
    recordType: "Sample",
    scopeGroup: "health_metrics_and_measurements",
    ops: ["list", "reconcile"],
    webhookSupport: true,
    trueZeros: false,
  },
  height: {
    kebab: "height",
    snake: "height",
    recordType: "Sample",
    scopeGroup: "health_metrics_and_measurements",
    ops: ["list", "get", "reconcile", "create", "update", "batchDelete"],
    webhookSupport: true,
    trueZeros: false,
  },
  "hydration-log": {
    kebab: "hydration-log",
    snake: "hydration_log",
    recordType: "Session",
    scopeGroup: "nutrition",
    ops: ["list", "get", "reconcile", "rollup", "dailyRollup", "create", "update", "batchDelete"],
    webhookSupport: true,
    trueZeros: false,
  },
  "irregular-rhythm-notification": {
    kebab: "irregular-rhythm-notification",
    snake: "irregular_rhythm_notification",
    recordType: "Session",
    scopeGroup: "irn",
    ops: ["list"],
    webhookSupport: false,
    trueZeros: false,
  },
  "nutrition-log": {
    kebab: "nutrition-log",
    snake: "nutrition_log",
    recordType: "Sample",
    scopeGroup: "nutrition",
    ops: ["list", "get", "reconcile", "rollup", "dailyRollup", "create", "update", "batchDelete"],
    webhookSupport: true,
    trueZeros: false,
  },
  "oxygen-saturation": {
    kebab: "oxygen-saturation",
    snake: "oxygen_saturation",
    recordType: "Sample",
    scopeGroup: "health_metrics_and_measurements",
    ops: ["list", "reconcile"],
    webhookSupport: false,
    trueZeros: false,
  },
  "respiratory-rate-sleep-summary": {
    kebab: "respiratory-rate-sleep-summary",
    snake: "respiratory_rate_sleep_summary",
    recordType: "Sample",
    scopeGroup: "health_metrics_and_measurements",
    ops: ["list", "reconcile"],
    webhookSupport: true,
    trueZeros: false,
  },
  "run-vo2-max": {
    kebab: "run-vo2-max",
    snake: "run_vo2_max",
    recordType: "Sample",
    scopeGroup: "activity_and_fitness",
    ops: ["list", "reconcile", "rollup", "dailyRollup"],
    webhookSupport: true,
    trueZeros: false,
  },
  "sedentary-period": {
    kebab: "sedentary-period",
    snake: "sedentary_period",
    recordType: "Interval",
    scopeGroup: "activity_and_fitness",
    ops: ["list", "reconcile", "rollup", "dailyRollup"],
    webhookSupport: true,
    trueZeros: false,
  },
  sleep: {
    kebab: "sleep",
    snake: "sleep",
    recordType: "Session",
    scopeGroup: "sleep",
    ops: ["list", "get", "reconcile", "create", "update", "batchDelete"],
    webhookSupport: true,
    trueZeros: false,
  },
  steps: {
    kebab: "steps",
    snake: "steps",
    recordType: "Interval",
    scopeGroup: "activity_and_fitness",
    ops: ["list", "reconcile", "rollup", "dailyRollup"],
    webhookSupport: true,
    trueZeros: true,
  },
  "swim-lengths-data": {
    kebab: "swim-lengths-data",
    snake: "swim_lengths_data",
    recordType: "Interval",
    scopeGroup: "activity_and_fitness",
    ops: ["list", "reconcile", "rollup", "dailyRollup"],
    webhookSupport: false,
    trueZeros: false,
  },
  "time-in-heart-rate-zone": {
    kebab: "time-in-heart-rate-zone",
    snake: "time_in_heart_rate_zone",
    recordType: "Interval",
    scopeGroup: "activity_and_fitness",
    ops: ["list", "reconcile", "rollup", "dailyRollup"],
    webhookSupport: true,
    trueZeros: false,
  },
  "total-calories": {
    kebab: "total-calories",
    snake: "total_calories",
    recordType: "Interval",
    scopeGroup: "activity_and_fitness",
    ops: ["rollup", "dailyRollup"],
    webhookSupport: false,
    trueZeros: true,
  },
  "vo2-max": {
    kebab: "vo2-max",
    snake: "vo2_max",
    recordType: "Sample",
    scopeGroup: "activity_and_fitness",
    ops: ["list", "reconcile"],
    webhookSupport: false,
    trueZeros: false,
  },
  weight: {
    kebab: "weight",
    snake: "weight",
    recordType: "Sample",
    scopeGroup: "health_metrics_and_measurements",
    ops: ["list", "get", "reconcile", "rollup", "dailyRollup", "create", "update", "batchDelete"],
    webhookSupport: true,
    trueZeros: false,
  },
};

export function getDataType(kebab: string): DataTypeSpec | undefined {
  return DATA_TYPES[kebab];
}

export function listDataTypes(): DataTypeSpec[] {
  return Object.values(DATA_TYPES);
}

export function supportsOp(kebab: string, op: DataTypeOp): boolean {
  return getDataType(kebab)?.ops.includes(op) ?? false;
}

export function readScopeFor(spec: DataTypeSpec): string {
  return `https://www.googleapis.com/auth/googlehealth.${spec.scopeGroup}.readonly`;
}

export function writeScopeFor(spec: DataTypeSpec): string {
  return `https://www.googleapis.com/auth/googlehealth.${spec.scopeGroup}.writeonly`;
}
