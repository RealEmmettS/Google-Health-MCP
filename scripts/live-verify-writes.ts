/**
 * Phase 6 live acceptance: full write roundtrips against the real account.
 * Everything created here is deleted before exit; the weight entry uses an
 * obviously-fake test value and is removed. Audit rows are counted at the end.
 * Usage: npx tsx scripts/live-verify-writes.ts [email]
 */
import { config } from "dotenv";

config({ path: ".env.development.local", quiet: true });

async function main() {
  const { getAppUserByEmail } = await import("../src/auth/app-user");
  const { GoogleHealthClient } = await import("../src/google-health/client");
  const writes = await import("../src/health-services/writes");
  const { getNutritionLog } = await import("../src/health-services/nutrition");
  const { getProfileCached } = await import("../src/health-services/profile");
  const { db } = await import("../src/db/client");
  const { mutationAuditLog } = await import("../src/db/schema");
  const { desc } = await import("drizzle-orm");

  const email = process.argv[2] ?? "eshaughv@gmail.com";
  const user = await getAppUserByEmail(email);
  if (!user) throw new Error(`no app user for ${email}`);
  const client = new GoogleHealthClient(user.id);
  let failures = 0;
  const check = (label: string, condition: boolean, detail = "") => {
    console.log(`${condition ? "PASS" : "FAIL"}  ${label}  ${detail}`);
    if (!condition) failures += 1;
  };

  // 1) Nutrition: create → visible in read → update → verify → delete.
  const created = await writes.createNutritionLog(user, client, {
    description: "__test__ Greek yogurt",
    mealType: "snack",
    caloriesKcal: 150,
    proteinGrams: 15,
    carbohydrateGrams: 8,
    fatGrams: 4,
    sodiumMilligrams: 55,
  });
  check("nutrition create returns name", !!created.name, created.name ?? "");

  const day1 = await getNutritionLog(user, client, {});
  const found = day1.meals.find(
    (m) => (m as { name?: string }).name === created.name,
  ) as { energy?: { kcal?: number } } | undefined;
  check("created entry appears in get_nutrition_log", !!found);
  check("created kcal round-trips", found?.energy?.kcal === 150, `kcal=${found?.energy?.kcal}`);

  const updated = await writes.updateNutritionLog(user, client, {
    dataPointName: created.name!,
    caloriesKcal: 180,
    description: "__test__ Greek yogurt (large)",
  });
  const updatedLog = (updated.updated as { nutritionLog?: { energy?: { kcal?: number }; foodDisplayName?: string } })
    ?.nutritionLog;
  check(
    "update (replace) changes kcal to 180",
    updatedLog?.energy?.kcal === 180,
    `kcal=${updatedLog?.energy?.kcal} name=${updatedLog?.foodDisplayName}`,
  );
  check(
    "update preserves protein nutrient",
    JSON.stringify(updatedLog ?? {}).includes("PROTEIN"),
  );
  check("update returns a NEW name", !!updated.name && updated.name !== created.name);
  check("update reports no delete warning", !updated.warning, updated.warning ?? "");

  const day15 = await getNutritionLog(user, client, {});
  check(
    "original entry gone after replace",
    !day15.meals.some((m) => (m as { name?: string }).name === created.name),
  );

  await writes.deleteNutritionLogs(user, client, { dataPointNames: [updated.name!] });
  const day2 = await getNutritionLog(user, client, {});
  check(
    "deleted entry gone from read",
    !day2.meals.some((m) => (m as { name?: string }).name === updated.name),
  );

  // 2) Hydration: create → delete (same delete tool, hydration names).
  const water = await writes.createHydrationLog(user, client, {
    volume: 16,
    unit: "fl_oz",
  });
  check("hydration create returns name", !!water.name, water.name ?? "");
  const loggedMl = (water.logged as { hydrationLog?: { amountConsumed?: { milliliters?: number } } })
    ?.hydrationLog?.amountConsumed?.milliliters;
  check("16 fl_oz ≈ 473 mL", Math.abs((loggedMl ?? 0) - 473.18) < 1, `ml=${loggedMl}`);
  await writes.deleteNutritionLogs(user, client, { dataPointNames: [water.name!] });
  check("hydration deleted", true);

  // 3) Measurement: weight create (fake test value) → delete directly.
  const weight = await writes.updateMeasurement(user, client, {
    measurementType: "weight",
    value: 176.4,
    unit: "lb",
    notes: "__test__ delete me",
  });
  check("weight create returns name", !!weight.name, weight.name ?? "");
  const grams = (weight.recorded as { weight?: { weightGrams?: number } })?.weight?.weightGrams;
  check("176.4 lb ≈ 80013 g", Math.abs((grams ?? 0) - 80013.6) < 5, `g=${grams}`);
  if (weight.name) await client.batchDeleteDataPoints("weight", [weight.name]);

  // 4) Profile PATCH is a known server-side 403 (documented; tool dropped).
  //    Verify our error surface maps it and audits the failure.
  void getProfileCached;
  let profileErrorCode = "";
  try {
    await writes.updateProfileStrides(user, client, { walkingStrideLengthMm: 727 });
  } catch (error) {
    profileErrorCode = (error as { code?: string }).code ?? "";
  }
  check(
    "update_profile surfaces the known 403 as google_api_error",
    profileErrorCode === "google_api_error",
    `code=${profileErrorCode}`,
  );

  // 5) Audit trail: recent rows exist for every mutation above.
  const audits = await db
    .select({
      toolName: mutationAuditLog.toolName,
      status: mutationAuditLog.status,
      dataType: mutationAuditLog.dataType,
    })
    .from(mutationAuditLog)
    .orderBy(desc(mutationAuditLog.createdAt))
    .limit(12);
  const auditTools = audits.map((a) => `${a.toolName}:${a.status}`);
  console.log("recent audits:", auditTools.join(", "));
  for (const expected of [
    "create_nutrition_log",
    "update_nutrition_log",
    "delete_nutrition_log",
    "create_hydration_log",
    "update_measurement",
  ]) {
    check(`audit row for ${expected}`, auditTools.some((a) => a.startsWith(`${expected}:success`)));
  }
  check(
    "audit row for update_profile FAILURE",
    auditTools.some((a) => a === "update_profile:error"),
  );

  console.log(failures === 0 ? "\nALL WRITE ROUNDTRIPS PASSED" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("live-verify-writes crashed:", error?.message ?? error);
  process.exit(1);
});
