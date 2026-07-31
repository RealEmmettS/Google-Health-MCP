import type {
  CallToolResult,
  McpServer,
  ToolAnnotations,
} from "@modelcontextprotocol/server";
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
import { getHealthTrends, TREND_METRICS } from "../health-services/trends";
import {
  acknowledgeHealthUpdates,
  getHealthUpdates,
} from "../health-services/updates";
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

type ToolResult = CallToolResult;

type ToolName =
  | "ping"
  | "get_sync_status"
  | "get_today_steps"
  | "get_exercise_week"
  | "get_sleep_summary"
  | "get_latest_heart_rate"
  | "get_nutrition_log"
  | "get_health_context"
  | "get_health_trends"
  | "get_health_updates"
  | "acknowledge_health_updates"
  | "query_health_data"
  | "rollup_health_data"
  | "create_nutrition_log"
  | "update_nutrition_log"
  | "delete_nutrition_log"
  | "create_hydration_log"
  | "update_measurement";

const writeToolNames = new Set<ToolName>([
  "acknowledge_health_updates",
  "create_nutrition_log",
  "update_nutrition_log",
  "delete_nutrition_log",
  "create_hydration_log",
  "update_measurement",
]);

function securitySchemesForTool(name: ToolName): Record<string, unknown> {
  return {
    securitySchemes: [
      {
        type: "oauth2",
        scopes: writeToolNames.has(name)
          ? ["health:read", "health:write"]
          : ["health:read"],
      },
    ],
  };
}

const readExternal: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
const readLocal: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const createExternal: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

const jsonObjectSchema = z.looseObject({});
const healthReadOutputSchema = z.looseObject({
  dataProvenance: z.looseObject({}),
});
const updatesOutputSchema = z.object({
  updates: z.array(
    z.object({
      id: z.string().uuid(),
      dataType: z.string(),
      operation: z.string(),
      intervals: z.json(),
      status: z.string(),
      notifiedAt: z.string(),
      expiresAt: z.string(),
    }),
  ),
  pendingCount: z.number().int().nonnegative(),
  note: z.string(),
});

const toolMetadata: Record<
  ToolName,
  { outputSchema: z.ZodType; annotations: ToolAnnotations }
> = {
  ping: {
    outputSchema: z.object({
      pong: z.literal(true),
      server: z.literal("shaughv-health-mcp"),
      authenticatedUserId: z.string(),
      echo: z.string().nullable(),
      time: z.string(),
    }),
    annotations: readLocal,
  },
  get_sync_status: { outputSchema: healthReadOutputSchema, annotations: readExternal },
  get_today_steps: { outputSchema: healthReadOutputSchema, annotations: readExternal },
  get_exercise_week: { outputSchema: healthReadOutputSchema, annotations: readExternal },
  get_sleep_summary: { outputSchema: healthReadOutputSchema, annotations: readExternal },
  get_latest_heart_rate: { outputSchema: healthReadOutputSchema, annotations: readExternal },
  get_nutrition_log: { outputSchema: healthReadOutputSchema, annotations: readExternal },
  get_health_context: { outputSchema: healthReadOutputSchema, annotations: readExternal },
  get_health_trends: { outputSchema: healthReadOutputSchema, annotations: readExternal },
  get_health_updates: { outputSchema: updatesOutputSchema, annotations: readLocal },
  acknowledge_health_updates: {
    outputSchema: z.object({
      acknowledged: z.number().int().nonnegative(),
      acknowledgedAt: z.string(),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  query_health_data: { outputSchema: healthReadOutputSchema, annotations: readExternal },
  rollup_health_data: { outputSchema: healthReadOutputSchema, annotations: readExternal },
  create_nutrition_log: {
    outputSchema: z.looseObject({ name: z.string().optional(), logged: z.json() }),
    annotations: createExternal,
  },
  update_nutrition_log: {
    outputSchema: z.looseObject({
      name: z.string().optional(),
      replacedName: z.string(),
      updated: z.json(),
      warning: z.string().optional(),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  delete_nutrition_log: {
    outputSchema: z.object({ deleted: z.array(z.string()) }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  create_hydration_log: {
    outputSchema: z.looseObject({ name: z.string().optional(), logged: z.json() }),
    annotations: createExternal,
  },
  update_measurement: {
    outputSchema: z.looseObject({ name: z.string().optional(), recorded: z.json() }),
    annotations: createExternal,
  },
};

function structuredObject(data: unknown): Record<string, unknown> {
  const serialized = JSON.stringify(data);
  const parsed = serialized === undefined ? null : (JSON.parse(serialized) as unknown);
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : { data: parsed };
}

function ok(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) ?? "null" }],
    structuredContent: structuredObject(data),
  };
}

function fail(payload: unknown): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function attachProvenance(data: unknown, client: GoogleHealthClient): unknown {
  const dataProvenance = client.getDataProvenance();
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return { ...(data as Record<string, unknown>), dataProvenance };
  }
  return { data, dataProvenance };
}

async function runRead<T>(
  client: GoogleHealthClient,
  forceRefresh: boolean | undefined,
  read: () => Promise<T>,
): Promise<unknown> {
  client.setCacheBypass(forceRefresh === true);
  return attachProvenance(await read(), client);
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
const forceRefreshArg = z
  .boolean()
  .optional()
  .describe("Bypass the short-lived encrypted cache and refresh this answer from Google");

export function registerTools(server: McpServer, ctx: ToolContext): void {
  let resolved: Promise<ResolvedContext> | null = null;
  const getCtx = (): Promise<ResolvedContext> =>
    (resolved ??= (async () => {
      const user = await resolveAppUser(ctx.userId);
      return { user, client: new GoogleHealthClient(user.id) };
    })());

  const registerTool = <Input extends z.ZodRawShape>(
    name: ToolName,
    config: {
      title: string;
      description: string;
      inputSchema: Input;
    },
    callback: (
      args: z.infer<z.ZodObject<Input>>,
    ) => ToolResult | Promise<ToolResult>,
  ): void => {
    const metadata = toolMetadata[name];
    server.registerTool(
      name,
      {
        ...config,
        inputSchema: z.object(config.inputSchema),
        outputSchema: metadata.outputSchema,
        annotations: metadata.annotations,
        // MCP v2 preserves arbitrary tool metadata here. ChatGPT reads this
        // back-compat mirror to render the tool's OAuth requirement.
        _meta: securitySchemesForTool(name),
      },
      callback,
    );
  };

  // ── diagnostics ───────────────────────────────────────────────────────────
  registerTool(
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

  registerTool(
    "get_sync_status",
    {
      title: "Get sync status",
      description:
        "Google Health connection health: status, granted scopes, identity mapping, paired-device battery, and a synced-through estimate. Use when data seems missing or stale.",
      inputSchema: { forceRefresh: forceRefreshArg },
    },
    async ({ forceRefresh }) =>
      run(async () => {
        const { user, client } = await getCtx();
        return runRead(client, forceRefresh, () => getSyncStatus(user, client));
      }),
  );

  // ── activity ──────────────────────────────────────────────────────────────
  registerTool(
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
        forceRefresh: forceRefreshArg,
      },
    },
    async (args) =>
      run(async () => {
        const { user, client } = await getCtx();
        return runRead(client, args.forceRefresh, () => getTodaySteps(user, client, args));
      }),
  );

  registerTool(
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
        forceRefresh: forceRefreshArg,
      },
    },
    async (args) =>
      run(async () => {
        const { user, client } = await getCtx();
        return runRead(client, args.forceRefresh, () => getExerciseWeek(user, client, args));
      }),
  );

  // ── sleep ─────────────────────────────────────────────────────────────────
  registerTool(
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
        forceRefresh: forceRefreshArg,
      },
    },
    async (args) =>
      run(async () => {
        const { user, client } = await getCtx();
        return runRead(client, args.forceRefresh, () => getSleepSummary(user, client, args));
      }),
  );

  // ── heart ─────────────────────────────────────────────────────────────────
  registerTool(
    "get_latest_heart_rate",
    {
      title: "Get latest heart rate",
      description:
        "The latest SYNCED heart-rate sample (never live), with optional context (recent exercise, last-night sleep, resting-HR baseline). Data only — do not present medical conclusions.",
      inputSchema: {
        lookbackMinutes: z.number().int().min(5).max(1440).optional(),
        includeContext: z.boolean().optional(),
        forceRefresh: forceRefreshArg,
      },
    },
    async (args) =>
      run(async () => {
        const { user, client } = await getCtx();
        return runRead(client, args.forceRefresh, () => getLatestHeartRate(user, client, args));
      }),
  );

  // ── nutrition ─────────────────────────────────────────────────────────────
  registerTool(
    "get_nutrition_log",
    {
      title: "Get nutrition log for a day",
      description:
        "Meals and hydration LOGGED for a civil day, with calorie/hydration totals and the data-point names needed for editing/deleting. Empty means nothing logged, not nothing eaten.",
      inputSchema: {
        date: dateArg.optional(),
        timezone: timezoneArg.optional(),
        forceRefresh: forceRefreshArg,
      },
    },
    async (args) =>
      run(async () => {
        const { user, client } = await getCtx();
        return runRead(client, args.forceRefresh, () => getNutritionLog(user, client, args));
      }),
  );

  // ── context bundle ────────────────────────────────────────────────────────
  registerTool(
    "get_health_context",
    {
      title: "Get health context bundle",
      description:
        'One-call context for "why am I tired?" / "why is my heart rate high?" questions: sleep, latest HR + resting baseline, steps, nutrition — plus explicit limitations. Returns data for YOU to reason over; it never diagnoses.',
      inputSchema: {
        questionType: z.enum(["fatigue", "heart_rate", "general"]),
        timezone: timezoneArg.optional(),
        forceRefresh: forceRefreshArg,
      },
    },
    async (args) =>
      run(async () => {
        const { user, client } = await getCtx();
        return runRead(client, args.forceRefresh, () => getHealthContext(user, client, args));
      }),
  );

  registerTool(
    "get_health_trends",
    {
      title: "Get bounded health trends",
      description:
        "Returns gap-preserving 7, 30, or 90-day series for selected health metrics. Mechanical summaries only; compare coverage before interpreting change and do not make medical claims.",
      inputSchema: {
        days: z
          .union([z.literal(7), z.literal(30), z.literal(90)])
          .default(30)
          .describe("Bounded trend window"),
        metrics: z
          .array(z.enum(TREND_METRICS))
          .min(1)
          .max(TREND_METRICS.length)
          .optional()
          .describe("Defaults to all supported trend metrics"),
        timezone: timezoneArg.optional(),
        forceRefresh: forceRefreshArg,
      },
    },
    async (args) =>
      run(async () => {
        const { user, client } = await getCtx();
        return runRead(client, args.forceRefresh, () =>
          getHealthTrends(user, client, args),
        );
      }),
  );

  registerTool(
    "get_health_updates",
    {
      title: "Get new health-data notifications",
      description:
        "Lists short-lived Google Health change notifications that have not been acknowledged. Notifications contain pointers only; use a matching read or trend tool for current values.",
      inputSchema: {
        includeAcknowledged: z.boolean().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async (args) =>
      run(async () => {
        const { user } = await getCtx();
        return getHealthUpdates(user.id, args);
      }),
  );

  registerTool(
    "acknowledge_health_updates",
    {
      title: "Acknowledge health-data notifications",
      description:
        "Marks selected local notification pointers as acknowledged. This does not change or delete any Google Health data.",
      inputSchema: {
        updateIds: z.array(z.string().uuid()).max(50).optional(),
        allPending: z.boolean().optional(),
      },
    },
    async (args) =>
      run(async () => {
        const { user } = await getCtx();
        return acknowledgeHealthUpdates(user.id, args);
      }),
  );

  // ── generic escape hatches ────────────────────────────────────────────────
  registerTool(
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
        forceRefresh: forceRefreshArg,
      },
    },
    async (args) =>
      run(async () => {
        const { user, client } = await getCtx();
        return runRead(client, args.forceRefresh, () => queryHealthData(user, client, args));
      }),
  );

  registerTool(
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
        forceRefresh: forceRefreshArg,
      },
    },
    async (args) =>
      run(async () => {
        const { user, client } = await getCtx();
        return runRead(client, args.forceRefresh, () => rollupHealthData(user, client, args));
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

  registerTool(
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

  registerTool(
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

  registerTool(
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

  registerTool(
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

  registerTool(
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
      cacheHint: { ttlMs: 60 * 60 * 1000, cacheScope: "private" },
    },
    async (uri) => {
      const { user, client } = await getCtx();
      return jsonResource(
        uri.href,
        attachProvenance(await getProfileCached(user, client), client),
      );
    },
  );

  server.registerResource(
    "settings",
    "health://settings",
    {
      title: "Google Health settings",
      description: "Units, locale, timezone (cached ~1h). No step goal exists in the API.",
      mimeType: "application/json",
      cacheHint: { ttlMs: 60 * 60 * 1000, cacheScope: "private" },
    },
    async (uri) => {
      const { user, client } = await getCtx();
      return jsonResource(
        uri.href,
        attachProvenance(await getSettingsCached(user, client), client),
      );
    },
  );

  server.registerResource(
    "connected-user",
    "health://connected-user",
    {
      title: "Connected user",
      description: "App user, identity mapping, and connection status",
      mimeType: "application/json",
      cacheHint: { ttlMs: 0, cacheScope: "private" },
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
      cacheHint: { ttlMs: 24 * 60 * 60 * 1000, cacheScope: "private" },
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
      cacheHint: { ttlMs: 24 * 60 * 60 * 1000, cacheScope: "private" },
    },
    async (uri) =>
      jsonResource(uri.href, {
        model:
          "Fitbit Air → Fitbit app sync → Google Health cloud → this server. Data exists here only AFTER a device sync; nothing is live.",
         fields: {
          retrievedAt: "When this server assembled the response.",
          latestDataTime: "Timestamp of the newest data point seen in the response.",
          isPossiblyStale:
            "True when no data-point timestamp was seen in the last ~3 hours.",
          note: "Human-readable caveat specific to the response.",
          dataProvenance:
            "Whether exact Google responses came from the live API, the short-lived encrypted cache, or a mixture, with source fetch and expiry times.",
          lastNotifiedAt:
            "When Google most recently notified this server that a data type changed; the notification itself contains no health value.",
        },
        gaps: "A gap or zero can mean off-wrist, unsynced, or genuinely inactive — steps/distance/floors/altitude/total-calories support explicit true zeros; other types do not.",
        goal: "The v4 API exposes no step goal; goals are only known if the user states them.",
      }),
  );

  server.registerResource(
    "updates",
    "health://updates",
    {
      title: "Pending health-data notifications",
      description:
        "Short-lived pointer-only notifications that new Google Health data may be available",
      mimeType: "application/json",
      cacheHint: { ttlMs: 0, cacheScope: "private" },
    },
    async (uri) => {
      const { user } = await getCtx();
      return jsonResource(uri.href, await getHealthUpdates(user.id));
    },
  );
}
