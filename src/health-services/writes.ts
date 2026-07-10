import { recordMutation } from "../audit/mutation-audit";
import type { AppUser } from "../auth/app-user";
import { getConnection } from "../auth/token-store";
import type { GoogleHealthClient } from "../google-health/client";
import { GoogleHealthError, MissingScopeError } from "../google-health/errors";
import { parseUserDateTime, toObservationSampleTime, toSessionInterval } from "../time/ranges";
import { getUserTimezone } from "./profile";
import { asRec, str } from "./shape";

/**
 * Mutation services (docs/PLAN.md §"MCP surface" write tools). Rules:
 * explicit-input-only (nothing inferred), every attempt audited (success AND
 * failure), created/updated/deleted data-point names returned. Payload
 * shapes are live-verified against the API discovery document (2026-07-09):
 * EnergyQuantity{kcal}, WeightQuantity{grams}, VolumeQuantity{milliliters},
 * HydrationLog{interval, amountConsumed}, intervals need start < end.
 * Absent by design: sleep/exercise/settings writes.
 */

const MEAL_TYPES = {
  breakfast: "BREAKFAST",
  lunch: "LUNCH",
  dinner: "DINNER",
  snack: "SNACK",
  anytime: "ANYTIME",
  before_breakfast: "BEFORE_BREAKFAST",
  before_lunch: "BEFORE_LUNCH",
  before_dinner: "BEFORE_DINNER",
  after_dinner: "AFTER_DINNER",
} as const;
export type MealTypeInput = keyof typeof MEAL_TYPES;

async function audited<T>(
  user: AppUser,
  toolName: string,
  dataType: string,
  operation: "create" | "update" | "delete",
  requestPayload: unknown,
  fn: () => Promise<{ result: T; dataPointName?: string; response?: unknown }>,
): Promise<T> {
  try {
    const { result, dataPointName, response } = await fn();
    await recordMutation({
      userId: user.id,
      toolName,
      dataType,
      operation,
      requestPayload,
      responsePayload: response,
      googleDataPointName: dataPointName,
      status: "success",
    });
    return result;
  } catch (error) {
    await recordMutation({
      userId: user.id,
      toolName,
      dataType,
      operation,
      requestPayload,
      status: "error",
      errorMessage: (error as Error)?.message?.slice(0, 500),
    }).catch(() => undefined); // auditing must never mask the real error
    throw error;
  }
}

/** Extracts the created/patched point from the API's operation wrapper. */
function unwrapDataPoint(response: unknown): { name?: string; point: unknown } {
  const record = asRec(response);
  const point = record.response ?? record;
  return { name: str(asRec(point).name), point };
}

function gramsQuantity(grams: number, unit = "GRAM") {
  return { grams, userProvidedUnit: unit };
}

export interface CreateNutritionArgs {
  description: string;
  dateTime?: string;
  timezone?: string;
  mealType?: MealTypeInput;
  caloriesKcal?: number;
  carbohydrateGrams?: number;
  fatGrams?: number;
  proteinGrams?: number;
  fiberGrams?: number;
  sugarGrams?: number;
  sodiumMilligrams?: number;
}

export async function createNutritionLog(
  user: AppUser,
  client: GoogleHealthClient,
  args: CreateNutritionArgs,
): Promise<{ name?: string; logged: unknown }> {
  const timezone = args.timezone ?? (await getUserTimezone(user, client));
  const at = parseUserDateTime(args.dateTime, timezone);

  const nutrients: unknown[] = [];
  if (args.proteinGrams !== undefined) {
    nutrients.push({ nutrient: "PROTEIN", quantity: gramsQuantity(args.proteinGrams) });
  }
  if (args.fiberGrams !== undefined) {
    nutrients.push({
      nutrient: "DIETARY_FIBER",
      quantity: gramsQuantity(args.fiberGrams),
    });
  }
  if (args.sugarGrams !== undefined) {
    nutrients.push({ nutrient: "SUGAR", quantity: gramsQuantity(args.sugarGrams) });
  }
  if (args.sodiumMilligrams !== undefined) {
    nutrients.push({
      nutrient: "SODIUM",
      quantity: gramsQuantity(args.sodiumMilligrams / 1000, "MILLIGRAM"),
    });
  }

  const nutritionLog: Record<string, unknown> = {
    interval: toSessionInterval(at),
    foodDisplayName: args.description,
    ...(args.mealType ? { mealType: MEAL_TYPES[args.mealType] } : {}),
    ...(args.caloriesKcal !== undefined
      ? { energy: { kcal: args.caloriesKcal, userProvidedUnit: "KILOCALORIE" } }
      : {}),
    ...(args.carbohydrateGrams !== undefined
      ? { totalCarbohydrate: gramsQuantity(args.carbohydrateGrams) }
      : {}),
    ...(args.fatGrams !== undefined ? { totalFat: gramsQuantity(args.fatGrams) } : {}),
    ...(nutrients.length ? { nutrients } : {}),
  };

  return audited(user, "create_nutrition_log", "nutrition-log", "create", args, async () => {
    const response = await client.createDataPoint("nutrition-log", { nutritionLog });
    const { name, point } = unwrapDataPoint(response);
    return { result: { name, logged: point }, dataPointName: name, response: point };
  });
}

const NUTRITION_NAME = /^users\/[^/]+\/dataTypes\/nutrition-log\/dataPoints\/[^/]+$/;
const HYDRATION_NAME = /^users\/[^/]+\/dataTypes\/hydration-log\/dataPoints\/[^/]+$/;

export interface UpdateNutritionArgs extends Omit<CreateNutritionArgs, "description"> {
  dataPointName: string;
  description?: string;
}

/**
 * Update = read → merge → REPLACE (create new, delete old). The API's PATCH
 * for nutrition-log returns 500 INTERNAL for every body/mask variant
 * (exhaustively probed 2026-07-09 — see .tasks/tasks/p6w.md), so replacement
 * is the reliable edit path. The entry gets a NEW data-point name, returned
 * as `name`; the old name is in `replacedName`.
 */
export async function updateNutritionLog(
  user: AppUser,
  client: GoogleHealthClient,
  args: UpdateNutritionArgs,
): Promise<{ name?: string; replacedName: string; updated: unknown; warning?: string }> {
  if (!NUTRITION_NAME.test(args.dataPointName)) {
    throw new GoogleHealthError(
      "invalid_arguments",
      "dataPointName must be a full nutrition-log data point resource name (get it from get_nutrition_log).",
    );
  }
  const timezone = args.timezone ?? (await getUserTimezone(user, client));

  const existing = asRec(await client.getDataPoint(args.dataPointName));
  const current = asRec(existing.nutritionLog);
  if (Object.keys(current).length === 0) {
    throw new GoogleHealthError("invalid_arguments", "Data point has no nutritionLog payload.");
  }

  const merged: Record<string, unknown> = { ...current };
  if (args.dateTime) merged.interval = toSessionInterval(parseUserDateTime(args.dateTime, timezone));
  if (args.description !== undefined) merged.foodDisplayName = args.description;
  if (args.mealType) merged.mealType = MEAL_TYPES[args.mealType];
  if (args.caloriesKcal !== undefined) {
    merged.energy = { kcal: args.caloriesKcal, userProvidedUnit: "KILOCALORIE" };
  }
  if (args.carbohydrateGrams !== undefined) {
    merged.totalCarbohydrate = gramsQuantity(args.carbohydrateGrams);
  }
  if (args.fatGrams !== undefined) merged.totalFat = gramsQuantity(args.fatGrams);
  const nutrientPatches: Array<[string, number, string?]> = [];
  if (args.proteinGrams !== undefined) nutrientPatches.push(["PROTEIN", args.proteinGrams]);
  if (args.fiberGrams !== undefined) nutrientPatches.push(["DIETARY_FIBER", args.fiberGrams]);
  if (args.sugarGrams !== undefined) nutrientPatches.push(["SUGAR", args.sugarGrams]);
  if (args.sodiumMilligrams !== undefined) {
    nutrientPatches.push(["SODIUM", args.sodiumMilligrams / 1000, "MILLIGRAM"]);
  }
  if (nutrientPatches.length) {
    const existingNutrients = (Array.isArray(current.nutrients) ? current.nutrients : [])
      .map(asRec)
      .filter((n) => !nutrientPatches.some(([nutrient]) => n.nutrient === nutrient));
    merged.nutrients = [
      ...existingNutrients,
      ...nutrientPatches.map(([nutrient, value, unit]) => ({
        nutrient,
        quantity: gramsQuantity(value, unit ?? "GRAM"),
      })),
    ];
  }

  // Strip output-only interval members before re-creating.
  const interval = { ...asRec(merged.interval) };
  delete interval.civilStartTime;
  delete interval.civilEndTime;
  merged.interval = interval;

  return audited(user, "update_nutrition_log", "nutrition-log", "update", args, async () => {
    const createResponse = await client.createDataPoint("nutrition-log", {
      nutritionLog: merged,
    });
    const { name: newName, point } = unwrapDataPoint(createResponse);

    let warning: string | undefined;
    try {
      await client.batchDeleteDataPoints("nutrition-log", [args.dataPointName]);
    } catch (error) {
      warning = `Replacement created (${newName}) but deleting the original failed — a duplicate may exist: ${args.dataPointName}. Original error: ${(error as Error).message.slice(0, 150)}`;
    }

    return {
      result: {
        name: newName,
        replacedName: args.dataPointName,
        updated: point,
        warning,
      },
      dataPointName: newName,
      response: point,
    };
  });
}

export async function deleteNutritionLogs(
  user: AppUser,
  client: GoogleHealthClient,
  args: { dataPointNames: string[] },
): Promise<{ deleted: string[] }> {
  const names = args.dataPointNames;
  if (!names.length) {
    throw new GoogleHealthError("invalid_arguments", "dataPointNames must be non-empty.");
  }
  const isNutrition = names.every((n) => NUTRITION_NAME.test(n));
  const isHydration = names.every((n) => HYDRATION_NAME.test(n));
  if (!isNutrition && !isHydration) {
    throw new GoogleHealthError(
      "invalid_arguments",
      "All names must be nutrition-log data points, or all hydration-log data points (one type per call).",
    );
  }
  const dataType = isNutrition ? "nutrition-log" : "hydration-log";

  return audited(user, "delete_nutrition_log", dataType, "delete", args, async () => {
    await client.batchDeleteDataPoints(dataType, names);
    return { result: { deleted: names }, dataPointName: names.join(",") };
  });
}

export async function createHydrationLog(
  user: AppUser,
  client: GoogleHealthClient,
  args: { volume: number; unit: "mL" | "L" | "fl_oz" | "cup"; dateTime?: string; timezone?: string },
): Promise<{ name?: string; logged: unknown }> {
  const timezone = args.timezone ?? (await getUserTimezone(user, client));
  const at = parseUserDateTime(args.dateTime, timezone);

  const toMl: Record<string, number> = { mL: 1, L: 1000, fl_oz: 29.5735, cup: 236.588 };
  const unitEnum: Record<string, string> = {
    mL: "MILLILITER",
    L: "LITER",
    fl_oz: "FLUID_OUNCE_US",
    cup: "CUP_US",
  };
  const hydrationLog = {
    interval: toSessionInterval(at),
    amountConsumed: {
      milliliters: Math.round(args.volume * toMl[args.unit] * 100) / 100,
      userProvidedUnit: unitEnum[args.unit],
    },
  };

  return audited(user, "create_hydration_log", "hydration-log", "create", args, async () => {
    const response = await client.createDataPoint("hydration-log", { hydrationLog });
    const { name, point } = unwrapDataPoint(response);
    return { result: { name, logged: point }, dataPointName: name, response: point };
  });
}

export interface UpdateMeasurementArgs {
  measurementType: "weight" | "body-fat" | "height";
  value: number;
  unit: "lb" | "kg" | "g" | "percent" | "in" | "cm" | "mm";
  dateTime?: string;
  timezone?: string;
  notes?: string;
}

export async function updateMeasurement(
  user: AppUser,
  client: GoogleHealthClient,
  args: UpdateMeasurementArgs,
): Promise<{ name?: string; recorded: unknown }> {
  const timezone = args.timezone ?? (await getUserTimezone(user, client));
  const sampleTime = toObservationSampleTime(parseUserDateTime(args.dateTime, timezone));

  let body: Record<string, unknown>;
  if (args.measurementType === "weight") {
    const toGrams: Partial<Record<string, number>> = { lb: 453.59237, kg: 1000, g: 1 };
    const factor = toGrams[args.unit];
    if (!factor) {
      throw new GoogleHealthError("invalid_arguments", "weight units: lb | kg | g");
    }
    body = {
      weight: {
        sampleTime,
        weightGrams: Math.round(args.value * factor * 100) / 100,
        ...(args.notes ? { notes: args.notes } : {}),
      },
    };
  } else if (args.measurementType === "body-fat") {
    if (args.unit !== "percent" || args.value < 0 || args.value > 100) {
      throw new GoogleHealthError("invalid_arguments", "body-fat takes percent in [0,100]");
    }
    body = { bodyFat: { sampleTime, percentage: args.value } };
  } else {
    const toMm: Partial<Record<string, number>> = { in: 25.4, cm: 10, mm: 1 };
    const factor = toMm[args.unit];
    if (!factor) {
      throw new GoogleHealthError("invalid_arguments", "height units: in | cm | mm");
    }
    // heightMillimeters is int64 → serialized as a string.
    body = {
      height: { sampleTime, heightMillimeters: String(Math.round(args.value * factor)) },
    };
  }

  return audited(
    user,
    "update_measurement",
    args.measurementType,
    "create",
    args,
    async () => {
      const response = await client.createDataPoint(args.measurementType, body);
      const { name, point } = unwrapDataPoint(response);
      return { result: { name, recorded: point }, dataPointName: name, response: point };
    },
  );
}

const PROFILE_WRITE_SCOPE = "https://www.googleapis.com/auth/googlehealth.profile.writeonly";

/**
 * NOT EXPOSED AS A TOOL (2026-07-09): the live updateProfile endpoint returns
 * 403 MISSING_OAUTH_SCOPE even though tokeninfo proves the token carries the
 * documented required scope (googlehealth.profile.writeonly) — a server-side
 * enforcement bug. Kept for re-enabling when Google fixes it. Stride lengths
 * are the only writable profile fields per the discovery document.
 */
export async function updateProfileStrides(
  user: AppUser,
  client: GoogleHealthClient,
  args: { walkingStrideLengthMm?: number; runningStrideLengthMm?: number },
): Promise<{ profile: unknown }> {
  if (
    args.walkingStrideLengthMm === undefined &&
    args.runningStrideLengthMm === undefined
  ) {
    throw new GoogleHealthError("invalid_arguments", "Provide at least one stride length.");
  }
  const connection = await getConnection(user.id);
  if (!connection?.scopes.includes(PROFILE_WRITE_SCOPE)) {
    throw new MissingScopeError([PROFILE_WRITE_SCOPE]);
  }

  const body: Record<string, unknown> = {};
  const maskParts: string[] = [];
  if (args.walkingStrideLengthMm !== undefined) {
    body.userConfiguredWalkingStrideLengthMm = args.walkingStrideLengthMm;
    maskParts.push("userConfiguredWalkingStrideLengthMm");
  }
  if (args.runningStrideLengthMm !== undefined) {
    body.userConfiguredRunningStrideLengthMm = args.runningStrideLengthMm;
    maskParts.push("userConfiguredRunningStrideLengthMm");
  }

  return audited(user, "update_profile", "profile", "update", args, async () => {
    const response = await client.updateProfile(body, maskParts.join(","));
    return { result: { profile: response }, response };
  });
}
