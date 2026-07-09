/**
 * Google Health API OAuth scopes (docs/PLAN.md §"Health scopes to request").
 * These are the NINE scopes the consent flow requests in v1 — the minimum for
 * the planned tool surface. location/ecg/irn are configured on the consent
 * screen but deliberately NOT requested. settings.writeonly is not configured
 * at all (no settings-write tools exist by design).
 */

const BASE = "https://www.googleapis.com/auth/googlehealth";

export const HEALTH_READ_SCOPES = [
  `${BASE}.activity_and_fitness.readonly`,
  `${BASE}.health_metrics_and_measurements.readonly`,
  `${BASE}.sleep.readonly`,
  `${BASE}.nutrition.readonly`,
  `${BASE}.profile.readonly`,
  `${BASE}.settings.readonly`,
] as const;

export const HEALTH_WRITE_SCOPES = [
  `${BASE}.nutrition.writeonly`,
  `${BASE}.health_metrics_and_measurements.writeonly`,
  `${BASE}.profile.writeonly`,
] as const;

export const HEALTH_SCOPES: readonly string[] = [
  ...HEALTH_READ_SCOPES,
  ...HEALTH_WRITE_SCOPES,
];

/** Space-separated scope string for the Google authorize URL. */
export const HEALTH_SCOPE_PARAM = HEALTH_SCOPES.join(" ");

export function hasScope(granted: readonly string[], required: string): boolean {
  return granted.includes(required);
}
