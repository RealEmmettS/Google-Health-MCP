import { DateTime } from "luxon";
import type { AppUser } from "../auth/app-user";
import type { GoogleHealthClient } from "../google-health/client";
import { dayRange, nowIn, toCivilDateString } from "../time/ranges";
import { makeFreshness, maxTime, type Freshness } from "./freshness";
import { getUserTimezone } from "./profile";
import { asRec, bound, num, pickNum, str } from "./shape";

export interface NutritionDay {
  date: string;
  timezone: string;
  meals: unknown[];
  mealsTruncated?: string;
  hydration: unknown[];
  hydrationTruncated?: string;
  totals: { caloriesKcal?: number; hydrationMl?: number };
  freshness: Freshness;
}

function withinDay(startTime: string | undefined, endUtcIso: string): boolean {
  if (!startTime) return true;
  const dt = DateTime.fromISO(startTime);
  return dt.isValid && dt <= DateTime.fromISO(endUtcIso);
}

/**
 * "What did I eat yesterday?" — nutrition + hydration logs for one civil day.
 * Empty results are reported as "nothing LOGGED", never "nothing eaten".
 * Data-point resource `name`s are included — they're required for edit/delete.
 */
export async function getNutritionLog(
  user: AppUser,
  client: GoogleHealthClient,
  args: { date?: string; timezone?: string },
): Promise<NutritionDay> {
  const timezone = args.timezone ?? (await getUserTimezone(user, client));
  const date = args.date ?? toCivilDateString(nowIn(timezone));
  const day = dayRange(date, timezone);

  // Live-verified 2026-07-09: these types reject physical interval.start_time
  // filters (INVALID_DATA_POINT_FILTER_DATA_TYPE_MEMBER); civil_start_time
  // with a naive local timestamp works.
  const [mealsPage, hydrationPage] = await Promise.all([
    client.listDataPoints({
      dataType: "nutrition-log",
      filter: `nutrition_log.interval.civil_start_time >= "${date}T00:00:00"`,
      pageSize: 100,
    }),
    client.listDataPoints({
      dataType: "hydration-log",
      filter: `hydration_log.interval.civil_start_time >= "${date}T00:00:00"`,
      pageSize: 100,
    }),
  ]);

  const meals = (mealsPage.dataPoints ?? [])
    .map((dp) => {
      const record = asRec(dp);
      const log = asRec(record.nutritionLog);
      const interval = asRec(log.interval);
      return {
        name: str(record.name), // required for update/delete tools
        startTime: str(interval.startTime),
        mealType: str(log.mealType),
        food: str(log.food),
        foodDisplayName: str(log.foodDisplayName),
        energy: log.energy,
        totalCarbohydrate: log.totalCarbohydrate,
        totalFat: log.totalFat,
        nutrients: log.nutrients,
        serving: log.serving,
        createdByThisApp:
          str(asRec(asRec(record.dataSource).application).googleWebClientId) !==
          undefined,
      };
    })
    .filter((m) => withinDay(m.startTime, day.endTime));
  const boundedMeals = bound(meals, 40);

  const hydration = (hydrationPage.dataPoints ?? [])
    .map((dp) => {
      const record = asRec(dp);
      const log = asRec(record.hydrationLog);
      return {
        name: str(record.name),
        startTime: str(asRec(log.interval).startTime),
        volume: log.volume,
      };
    })
    .filter((h) => withinDay(h.startTime, day.endTime));
  const boundedHydration = bound(hydration, 40);

  const kcal = meals
    .map((m) => pickNum(asRec(m.energy), ["quantity", "value"]))
    .filter((v): v is number => v !== undefined);
  const hydrationMl = hydration
    .map((h) => {
      const volume = asRec(h.volume);
      const value = pickNum(volume, ["value", "quantity"]);
      if (value === undefined) return undefined;
      const unit = str(volume.unit);
      return unit === "LITER" ? value * 1000 : value; // MILLILITER default
    })
    .filter((v): v is number => v !== undefined);

  return {
    date,
    timezone,
    meals: boundedMeals.items,
    mealsTruncated: boundedMeals.truncated,
    hydration: boundedHydration.items,
    hydrationTruncated: boundedHydration.truncated,
    totals: {
      caloriesKcal: kcal.length ? kcal.reduce((a, b) => a + b, 0) : undefined,
      hydrationMl: hydrationMl.length
        ? hydrationMl.reduce((a, b) => a + b, 0)
        : undefined,
    },
    freshness: makeFreshness(
      maxTime(...meals.map((m) => m.startTime), ...hydration.map((h) => h.startTime)),
      meals.length === 0
        ? "No nutrition entries are LOGGED for this date — absence of logs is not evidence that nothing was eaten."
        : undefined,
    ),
  };
}

export const _internal = { withinDay, num };
