import type { AppUser } from "../auth/app-user";
import type { GoogleHealthClient } from "../google-health/client";
import { makeFreshness, type Freshness } from "./freshness";
import { getLatestHeartRate } from "./heart";
import { getNutritionLog } from "./nutrition";
import { getUserTimezone } from "./profile";
import { getSleepSummary } from "./sleep";
import { getTodaySteps } from "./steps";

export interface HealthContext {
  questionType: "fatigue" | "heart_rate" | "general";
  timezone: string;
  sleep?: unknown;
  latestHeartRate?: unknown;
  todaySteps?: unknown;
  nutritionToday?: unknown;
  sectionErrors: Record<string, string>;
  limitations: string[];
  freshness: Freshness;
}

/**
 * One-call context bundle for "why am I tired?" / "why is my heart rate
 * high?" questions. Returns DATA plus explicit limitations — synthesis and
 * any "possible contributors" framing belong to the LLM, and nothing here
 * may be treated as diagnostic (docs/PLAN.md §"Safety").
 */
export async function getHealthContext(
  user: AppUser,
  client: GoogleHealthClient,
  args: { questionType: "fatigue" | "heart_rate" | "general"; timezone?: string },
): Promise<HealthContext> {
  const timezone = args.timezone ?? (await getUserTimezone(user, client));
  const sectionErrors: Record<string, string> = {};

  const wants = {
    sleep: true,
    heart: args.questionType !== "fatigue" || true, // HR context helps fatigue too
    steps: true,
    nutrition: args.questionType !== "heart_rate" || true,
  };

  const [sleep, heart, steps, nutrition] = await Promise.all([
    wants.sleep
      ? getSleepSummary(user, client, { timezone }).catch((e: Error) => {
          sectionErrors.sleep = e.message;
          return undefined;
        })
      : undefined,
    wants.heart
      ? getLatestHeartRate(user, client, {
          lookbackMinutes: 180,
          includeContext: true,
        }).catch((e: Error) => {
          sectionErrors.latestHeartRate = e.message;
          return undefined;
        })
      : undefined,
    wants.steps
      ? getTodaySteps(user, client, { timezone }).catch((e: Error) => {
          sectionErrors.todaySteps = e.message;
          return undefined;
        })
      : undefined,
    wants.nutrition
      ? getNutritionLog(user, client, { timezone }).catch((e: Error) => {
          sectionErrors.nutritionToday = e.message;
          return undefined;
        })
      : undefined,
  ]);

  return {
    questionType: args.questionType,
    timezone,
    sleep,
    latestHeartRate: heart,
    todaySteps: steps,
    nutritionToday: nutrition,
    sectionErrors,
    limitations: [
      "This bundle is context, not a diagnosis — do not state medical causes as fact.",
      "All values reflect the last device sync; recent activity may be missing.",
      "Absent nutrition/hydration logs mean nothing was LOGGED, not that nothing was consumed.",
      "If severe symptoms are present (chest pain, fainting, shortness of breath), suggest seeking medical care rather than analyzing data.",
    ],
    freshness: makeFreshness(),
  };
}
