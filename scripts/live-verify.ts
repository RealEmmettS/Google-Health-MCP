/**
 * Live verification harness: runs EVERY read service against the real Google
 * Health API with the stored connection. This is the Phase 5 acceptance run.
 * Usage: npx tsx scripts/live-verify.ts [email]
 */
import { config } from "dotenv";

config({ path: ".env.development.local", quiet: true });

type Check = { name: string; run: () => Promise<string> };

async function main() {
  const { getAppUserByEmail } = await import("../src/auth/app-user");
  const { GoogleHealthClient } = await import("../src/google-health/client");
  const services = {
    steps: await import("../src/health-services/steps"),
    sleep: await import("../src/health-services/sleep"),
    heart: await import("../src/health-services/heart"),
    exercise: await import("../src/health-services/exercise"),
    nutrition: await import("../src/health-services/nutrition"),
    context: await import("../src/health-services/context"),
    query: await import("../src/health-services/query"),
    status: await import("../src/health-services/status"),
    profile: await import("../src/health-services/profile"),
  };

  const email = process.argv[2] ?? "eshaughv@gmail.com";
  const user = await getAppUserByEmail(email);
  if (!user) throw new Error(`no app user for ${email}`);
  const client = new GoogleHealthClient(user.id);

  const checks: Check[] = [
    {
      name: "get_today_steps",
      run: async () => {
        const r = await services.steps.getTodaySteps(user, client, { goalSteps: 10000 });
        return `steps=${r.steps} remaining=${r.remainingToGoal} hourlyBuckets=${r.hourly.length} latest=${r.freshness.latestDataTime}`;
      },
    },
    {
      name: "get_sleep_summary (last_night)",
      run: async () => {
        const r = await services.sleep.getSleepSummary(user, client, {});
        return `asleepMin=${r.totalSleepMinutes} sessions=${(r.mainSession ? 1 : 0) + r.otherSessions.length} stale=${r.freshness.isPossiblyStale}`;
      },
    },
    {
      name: "get_latest_heart_rate (+context)",
      run: async () => {
        const r = await services.heart.getLatestHeartRate(user, client, {
          lookbackMinutes: 720,
          includeContext: true,
        });
        return `bpm=${r.latest?.beatsPerMinute} at=${r.latest?.time} resting=${r.restingHeartRate?.value} exCtx=${r.context?.recentExercise.length}`;
      },
    },
    {
      name: "get_exercise_week",
      run: async () => {
        const r = await services.exercise.getExerciseWeek(user, client, {});
        return `sessions=${r.sessionCount} kcal=${r.totals.caloriesKcal} azmDays=${r.activeZoneMinutesDaily.length}`;
      },
    },
    {
      name: "get_nutrition_log (today)",
      run: async () => {
        const r = await services.nutrition.getNutritionLog(user, client, {});
        return `meals=${r.meals.length} hydration=${r.hydration.length} kcal=${r.totals.caloriesKcal}`;
      },
    },
    {
      name: "get_health_context (fatigue)",
      run: async () => {
        const r = await services.context.getHealthContext(user, client, {
          questionType: "fatigue",
        });
        return `sections={sleep:${!!r.sleep},hr:${!!r.latestHeartRate},steps:${!!r.todaySteps},nutrition:${!!r.nutritionToday}} errors=${JSON.stringify(r.sectionErrors)}`;
      },
    },
    {
      name: "query_health_data (heart-rate, 2h)",
      run: async () => {
        const since = new Date(Date.now() - 2 * 3600e3).toISOString().replace(/\.\d{3}Z$/, "Z");
        const r = await services.query.queryHealthData(user, client, {
          dataType: "heart-rate",
          startTime: since,
          pageSize: 10,
        });
        return `points=${r.dataPoints.length} nextPage=${!!r.nextPageToken}`;
      },
    },
    {
      name: "query_health_data rejects bad type",
      run: async () => {
        try {
          await services.query.queryHealthData(user, client, { dataType: "nope" });
          return "FAIL: did not reject";
        } catch (e) {
          return `rejected as expected (${(e as { code?: string }).code})`;
        }
      },
    },
    {
      name: "rollup_health_data (daily distance, this week)",
      run: async () => {
        const r = await services.query.rollupHealthData(user, client, {
          dataType: "distance",
          daily: true,
          startDate: new Date(Date.now() - 6 * 86400e3).toISOString().slice(0, 10),
          endDate: new Date().toISOString().slice(0, 10),
        });
        return `buckets=${r.rollupDataPoints.length}`;
      },
    },
    {
      name: "get_sync_status",
      run: async () => {
        const r = await services.status.getSyncStatus(user, client);
        const device = r.devices[0] as { deviceVersion?: string; batteryLevel?: number } | undefined;
        return `status=${r.connection?.status} scopes=${r.connection?.scopes.length} device=${device?.deviceVersion}@${device?.batteryLevel}% syncedThrough=${r.syncedThrough}`;
      },
    },
    {
      name: "profile+settings (cached)",
      run: async () => {
        const p = (await services.profile.getProfileCached(user, client)) as {
          age?: number;
        };
        const s = await services.profile.getSettingsCached(user, client);
        const tz = await services.profile.getUserTimezone(user, client);
        return `age=${p.age} tz=${tz} weightUnit=${s.weightUnit}`;
      },
    },
  ];

  let failures = 0;
  for (const check of checks) {
    const started = Date.now();
    try {
      const summary = await check.run();
      console.log(`PASS  ${check.name}  (${Date.now() - started}ms)  ${summary}`);
    } catch (error) {
      failures += 1;
      console.log(
        `FAIL  ${check.name}  (${Date.now() - started}ms)  ${(error as Error)?.message}`,
      );
    }
  }
  console.log(failures === 0 ? "\nALL LIVE CHECKS PASSED" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("live-verify crashed:", error?.message ?? error);
  process.exit(1);
});
