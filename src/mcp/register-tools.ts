import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppUser } from "../auth/app-user";
import { getConnection } from "../auth/token-store";
import { GoogleHealthClient } from "../google-health/client";
import {
  GoogleHealthError,
  MissingScopeError,
  RateLimitedError,
} from "../google-health/errors";
import { listDataTypes } from "../google-health/registry";
import { getHealthContext } from "../health-services/context";
import { getExerciseWeek } from "../health-services/exercise";
import { getLatestHeartRate } from "../health-services/heart";
import { getNutritionLog } from "../health-services/nutrition";
import { getProfileCached, getSettingsCached } from "../health-services/profile";
import { queryHealthData, rollupHealthData } from "../health-services/query";
import { getSleepSummary } from "../health-services/sleep";
import { getSyncStatus } from "../health-services/status";
import { getTodaySteps } from "../health-services/steps";
import { resolveAppUser } from "../health-services/user";
import {
  createHydrationLog,
  createNutritionLog,
  deleteNutritionLogs,
  updateMeasurement,
  updateNutritionLog,
} from "../health-services/writes";
import { redactError } from "../security/redact";

/**
 * The MCP tool/resource surface (docs/PLAN.md §"MCP surface (v1)").
 * Handlers are THIN: parse/validate → call a health-service → serialize.
 * Orchestration lives in src/health-services/ so a future REST surface
 * (#api) reuses it. Absent by design: sleep/exercise/settings writes.
 */

export interface ToolContext {
  /** better-auth user id from the verified MCP access token. */
  userId: string;
}

interface ResolvedContext {
  user: AppUser;
  client: GoogleHealthClient;
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(payload: unknown): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

/** Maps service errors to the handoff §21 client-facing shapes. */
async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (error) {
    if (error instanceof MissingScopeError) {
      return fail({
        error: error.code,
        requiredScopes: error.requiredScopes,
        message: error.message,
      });
    }
    if (error instanceof RateLimitedError) {
      return fail({
        error: error.code,
        retryAfterSeconds: error.retryAfterSeconds,
        message: error.message,
      });
    }
    if (error instanceof GoogleHealthError) {
      return fail({ error: error.code, message: error.message });
    }
    return fail({ error: "internal_error", message: redactError(error).message });
  }
}

const dateArg = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
  .describe("Civil date, YYYY-MM-DD, in the user's timezone");
const timezoneArg = z
  .string()
  .max(64)
  .describe("IANA timezone override, e.g. America/Chicago (defaults to the user's Google Health setting)");

export function registerTools(server: McpServer, ctx: ToolContext): void {
  let resolved: Promise<ResolvedContext> | null = null;
  const getCtx = (): Promise<ResolvedContext> =>
    (resolved ??= (async () => {
      const user = await resolveAppUser(ctx.userId);
      return { user, client: new GoogleHealthClient(user.id) };
    })());

  // ── diagnostics ───────────────────────────────────────────────────────────
  server.registerTool(
    "ping",
    {
      title: "Ping",
      description:
        "Connectivity diagnostic: confirms the MCP connection, auth, and server identity. Takes an optional echo string.",
      inputSchema: {
        echo: z.string().max(200).optional().describe("Optional string to echo back"),
      },
    },
    async ({ echo }) =>
      ok({
        pong: true,
        server: "shaughv-health-mcp",
        authenticatedUserId: ctx.userId,
        echo: echo ?? null,
        time: new Date().toISOString(),
      }),
  );

  server.registerTool(
    "get_sync_status",
    {
      title: "Get sync status",
      description:
        "Google Health connection health: status, granted scopes, identity mapping, paired-device battery, and a synced-through estimate. Use when data seems missing or stale.",
      inputSchema: {},
    },
    async () =>
      run(async () => {
        const { user, client } = await getCtx();
        return getSyncStatus(user, client);
      }),
  );

  // ── activity ──────────────────────────────────────────────────────────────
  server.registerTool(
    "get_today_steps",
    {
      title: "Get steps for a day",
      description:
        "Step count for today (or a given date) with hourly breakdown and freshness. The API exposes NO step goal — pass goalSteps only if the user has stated their goal; never invent one.",
      inputSchema: {
        date: dateArg.optional(),
        timezone: timezoneArg.optional(),
        goalSteps: z
          .number()
          .int()
          .positive()
          .max(200000)
          .optional()
          .describe("The user's step goal, ONLY if they have stated it"),
      },
    },
    async (args) =>
      run(async () => {
        const { user, client } = await getCtx();
        return getTodaySteps(user, client, args);
      }),
  );

  server.registerTool(
    "get_exercise_week",
    {
      title: "Get exercise for a week",
      description:
        "Exercise sessions plus daily active-zone-minutes and active-minutes since the week start (ISO Monday). Distances in meters; calories in kcal.",
      inputSchema: {
        weekStartDate: dateArg
          .optional()
          .describe("Any date in the desired week; snaps to that week's Monday"),
        timezone: timezoneArg.optional(),
      },
    },
    async (args) =>
      run(async () => {
        const { user, client } = await getCtx();
        return getExerciseWeek(user, client, args);
      }),
  );

  // ── sleep ─────────────────────────────────────────────────────────────────
  server.registerTool(
    "get_sleep_summary",
    {
      title: "Get sleep summary",
      description:
        "Sleep for last night (default) or the night ENDING on a given date: duration, stage summary, main + other sessions. Sessions cross midnight; freshness notes flag still-processing data. Sessions are STAGES (deep/light/REM) or CLASSIC (single asleep block — a device capture condition, NOT poor sleep; see stagesStatus).",
      inputSchema: {
        date: dateArg.optional().describe("The morning the sleep ENDED on"),
        timezone: timezoneArg.optional(),
        mode: z.enum(["last_night", "date"]).optional(),
        includeStages: z
          .boolean()
          .optional()
          .describe("Include the per-segment stage list (larger payload)"),
      },
    },
    async (args) =>
      run(async () => {
        const { user, client } = await getCtx();
        return getSleepSummary(user, client, args);
      }),
  );

  // ── heart ─────────────────────────────────────────────────────────────────
  server.registerTool(
    "get_latest_heart_rate",
    {
      title: "Get latest heart rate",
      description:
        "The latest SYNCED heart-rate sample (never live), with optional context (recent exercise, last-night sleep, resting-HR baseline). Data only — do not present medical conclusions.",
      inputSchema: {
        lookbackMinutes: z.number().int().min(5).max(1440).optional(),
        includeContext: z.boolean().optional(),
      },
    },
    async (args) =>
      run(async () => {
        const { user, client } = await getCtx();
        return getLatestHeartRate(user, client, args);
      }),
  );

  // ── nutrition ─────────────────────────────────────────────────────────────
  server.registerTool(
    "get_nutrition_log",
    {
      title: "Get nutrition log for a day",
      description:
        "Meals and hydration LOGGED for a civil day, with calorie/hydration totals and the data-point names needed for editing/deleting. Empty means nothing logged, not nothing eaten.",
      inputSchema: {
        date: dateArg.optional(),
        timezone: timezoneArg.optional(),
      },
    },
    async (args) =>
      run(async () => {
        const { user, client } = await getCtx();
        return getNutritionLog(user, client, args);
      }),
  );

  // ── context bundle ────────────────────────────────────────────────────────
  server.registerTool(
    "get_health_context",
    {
      title: "Get health context bundle",
      description:
        'One-call context for "why am I tired?" / "why is my heart rate high?" questions: sleep, latest HR + resting baseline, steps, nutrition — plus explicit limitations. Returns data for YOU to reason over; it never diagnoses.',
      inputSchema: {
        questionType: z.enum(["fatigue", "heart_rate", "general"]),
        timezone: timezoneArg.optional(),
      },
    },
    async (args) =>
      run(async () => {
        const { user, client } = await getCtx();
        return getHealthContext(user, client, args);
      }),
  );

  // ── generic escape hatches ────────────────────────────────────────────────
  server.registerTool(
    "query_health_data",
    {
      title: "Query raw health data",
      description:
        "Generic list/reconcile over any supported data type (see the health://data-types resource). Prefer the dedicated tools for common questions. Filters use snake_case field prefixes. Mode 'reconcile' reads Google's merged/deduped stream — prefer it if per-source duplication is suspected (e.g. tracker + phone both logging steps).",
      inputSchema: {
        dataType: z.string().max(64).describe("Kebab-case data type, e.g. body-fat"),
        mode: z.enum(["list", "reconcile"]).optional(),
        filter: z
          .string()
          .max(500)
          .optional()
          .describe(
            'e.g. body_fat.sample_time.physical_time >= "2026-07-01T00:00:00Z"; daily-* types filter on a civil date: daily_heart_rate_variability.date >= "2026-07-05"',
          ),
        startTime: z
          .string()
          .max(40)
          .optional()
          .describe(
            "ISO instant or YYYY-MM-DD; auto-builds the right filter per data type when no filter given (daily-* types constrain by civil date)",
          ),
        pageSize: z.number().int().min(1).max(100).optional(),
        pageToken: z.string().max(200).optional(),
      },
    },
    async (args) =>
      run(async () => {
        const { user, client } = await getCtx();
        return queryHealthData(user, client, args);
      }),
  );

  server.registerTool(
    "rollup_health_data",
    {
      title: "Aggregate health data",
      description:
        "Aggregates over time: physical windows (startTime/endTime + windowSize like '3600s') or civil days (daily=true + startDate/endDate + windowSizeDays). Use for daily/weekly totals and averages.",
      inputSchema: {
        dataType: z.string().max(64),
        daily: z.boolean().optional(),
        startTime: z.string().max(40).optional(),
        endTime: z.string().max(40).optional(),
        windowSize: z.string().max(20).optional().describe('Seconds suffix form, e.g. "3600s"'),
        startDate: dateArg.optional(),
        endDate: dateArg.optional(),
        windowSizeDays: z.number().int().min(1).max(31).optional(),
        timezone: timezoneArg.optional(),
      },
    },
    async (args) =>
      run(async () => {
        const { user, client } = await getCtx();
        return rollupHealthData(user, client, args);
      }),
  );

  // ── write tools (nutrition/hydration/measurements/profile ONLY — sleep,
  //    exercise, and settings writes are absent by design) ──────────────────
  const mealTypeArg = z
    .enum([
      "breakfast",
      "lunch",
      "dinner",
      "snack",
      "anytime",
      "before_breakfast",
      "before_lunch",
      "before_dinner",
      "after_dinner",
    ])
    .optional();
  const dateTimeArg = z
    .string()
    .max(40)
    .optional()
    .describe("When it happened (ISO; naive values use the user's timezone). Defaults to now.");

  server.registerTool(
    "create_nutrition_log",
    {
      title: "Log a meal or snack",
      description:
        "Records a nutrition entry (the Fitbit Air can't track food). Use ONLY values the user stated — never estimate silently. Returns the data-point name needed for later edits/deletion.",
      inputSchema: {
        description: z.string().min(1).max(200).describe("What was eaten, e.g. 'Greek yogurt'"),
        dateTime: dateTimeArg,
        timezone: timezoneArg.optional(),
        mealType: mealTypeArg,
        caloriesKcal: z.number().min(0).max(20000).optional(),
        carbohydrateGrams: z.number().min(0).max(5000).optional(),
        fatGrams: z.number().min(0).max(5000).optional(),
        proteinGrams: z.number().min(0).max(5000).optional(),
        fiberGrams: z.number().min(0).max(1000).optional(),
        sugarGrams: z.number().min(0).max(5000).optional(),
        sodiumMilligrams: z.number().min(0).max(100000).optional(),
      },
    },
    async (args) =>
      run(async () => {
        const { user, client } = await getCtx();
        return createNutritionLog(user, client, args);
      }),
  );

  server.registerTool(
    "update_nutrition_log",
    {
      title: "Edit a nutrition entry",
      description:
        "Updates an app-created nutrition entry by its data-point name (from get_nutrition_log or a create result). Only provided fields change.",
      inputSchema: {
        dataPointName: z.string().max(300).describe("Full resource name of the entry"),
        description: z.string().min(1).max(200).optional(),
        dateTime: dateTimeArg,
        timezone: timezoneArg.optional(),
        mealType: mealTypeArg,
        caloriesKcal: z.number().min(0).max(20000).optional(),
        carbohydrateGrams: z.number().min(0).max(5000).optional(),
        fatGrams: z.number().min(0).max(5000).optional(),
        proteinGrams: z.number().min(0).max(5000).optional(),
        fiberGrams: z.number().min(0).max(1000).optional(),
        sugarGrams: z.number().min(0).max(5000).optional(),
        sodiumMilligrams: z.number().min(0).max(100000).optional(),
      },
    },
    async (args) =>
      run(async () => {
        const { user, client } = await getCtx();
        return updateNutritionLog(user, client, args);
      }),
  );

  server.registerTool(
    "delete_nutrition_log",
    {
      title: "Delete nutrition/hydration entries",
      description:
        "Deletes entries by their exact data-point names (all nutrition-log, or all hydration-log, per call). Confirm with the user before deleting.",
      inputSchema: {
        dataPointNames: z.array(z.string().max(300)).min(1).max(20),
      },
    },
    async (args) =>
      run(async () => {
        const { user, client } = await getCtx();
        return deleteNutritionLogs(user, client, args);
      }),
  );

  server.registerTool(
    "create_hydration_log",
    {
      title: "Log water/hydration",
      description: "Records fluid intake. Stored in milliliters; unit is preserved for display.",
      inputSchema: {
        volume: z.number().positive().max(20000),
        unit: z.enum(["mL", "L", "fl_oz", "cup"]),
        dateTime: dateTimeArg,
        timezone: timezoneArg.optional(),
      },
    },
    async (args) =>
      run(async () => {
        const { user, client } = await getCtx();
        return createHydrationLog(user, client, args);
      }),
  );

  server.registerTool(
    "update_measurement",
    {
      title: "Record a body measurement",
      description:
        "Records weight (lb/kg/g), body fat (percent), or height (in/cm/mm) at a point in time. Use ONLY user-stated values — never infer a measurement.",
      inputSchema: {
        measurementType: z.enum(["weight", "body-fat", "height"]),
        value: z.number().positive().max(1000000),
        unit: z.enum(["lb", "kg", "g", "percent", "in", "cm", "mm"]),
        dateTime: dateTimeArg,
        timezone: timezoneArg.optional(),
        notes: z.string().max(200).optional().describe("Optional note (weight only)"),
      },
    },
    async (args) =>
      run(async () => {
        const { user, client } = await getCtx();
        return updateMeasurement(user, client, args);
      }),
  );

  // update_profile is deliberately NOT registered: the live updateProfile
  // endpoint returns 403 MISSING_OAUTH_SCOPE even with the documented
  // profile.writeonly scope verifiably on the token (probed 2026-07-09,
  // server-side enforcement bug). Service code exists in
  // health-services/writes.ts (updateProfileStrides) for when Google fixes it.

  // ── resources ─────────────────────────────────────────────────────────────
  const jsonResource = (uri: string, data: unknown) => ({
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(data, null, 2),
      },
    ],
  });

  server.registerResource(
    "profile",
    "health://profile",
    {
      title: "Google Health profile",
      description: "Age, membership start, stride lengths (cached ~1h)",
      mimeType: "application/json",
    },
    async (uri) => {
      const { user, client } = await getCtx();
      return jsonResource(uri.href, await getProfileCached(user, client));
    },
  );

  server.registerResource(
    "settings",
    "health://settings",
    {
      title: "Google Health settings",
      description: "Units, locale, timezone (cached ~1h). No step goal exists in the API.",
      mimeType: "application/json",
    },
    async (uri) => {
      const { user, client } = await getCtx();
      return jsonResource(uri.href, await getSettingsCached(user, client));
    },
  );

  server.registerResource(
    "connected-user",
    "health://connected-user",
    {
      title: "Connected user",
      description: "App user, identity mapping, and connection status",
      mimeType: "application/json",
    },
    async (uri) => {
      const { user } = await getCtx();
      const connection = await getConnection(user.id);
      return jsonResource(uri.href, {
        email: user.email,
        defaultTimezone: user.defaultTimezone,
        healthUserId: user.googleHealthUserId,
        legacyFitbitUserId: user.legacyFitbitUserId,
        connection: connection
          ? {
              status: connection.status,
              scopes: connection.scopes,
              connectedAt: connection.connectedAt?.toISOString(),
            }
          : null,
      });
    },
  );

  server.registerResource(
    "data-types",
    "health://data-types",
    {
      title: "Supported data types",
      description:
        "The 41 Google Health data types this server can query, with record types, operations, and scope groups",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri.href, listDataTypes()),
  );

  server.registerResource(
    "freshness",
    "health://freshness",
    {
      title: "Data freshness semantics",
      description: "How to interpret freshness metadata and data gaps",
      mimeType: "application/json",
    },
    async (uri) =>
      jsonResource(uri.href, {
        model:
          "Fitbit Air → Fitbit app sync → Google Health cloud → this server. Data exists here only AFTER a device sync; nothing is live.",
        fields: {
          retrievedAt: "When this server fetched from Google Health (always fresh).",
          latestDataTime: "Timestamp of the newest data point seen in the response.",
          isPossiblyStale:
            "True when no data-point timestamp was seen in the last ~3 hours.",
          note: "Human-readable caveat specific to the response.",
        },
        gaps: "A gap or zero can mean off-wrist, unsynced, or genuinely inactive — steps/distance/floors/altitude/total-calories support explicit true zeros; other types do not.",
        goal: "The v4 API exposes no step goal; goals are only known if the user states them.",
      }),
  );
}
