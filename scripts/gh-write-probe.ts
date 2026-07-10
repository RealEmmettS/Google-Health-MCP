/**
 * Phase 6 empirical probe: discovers the exact create-body schemas the live
 * API accepts (enums for energy/weight units, Nutrient values). EVERY
 * successful create is immediately deleted — no probe data is left behind.
 * Usage: npx tsx scripts/gh-write-probe.ts [email]
 */
import { config } from "dotenv";

config({ path: ".env.development.local", quiet: true });

async function main() {
  const { getAppUserByEmail } = await import("../src/auth/app-user");
  const { GoogleHealthClient } = await import("../src/google-health/client");

  const email = process.argv[2] ?? "eshaughv@gmail.com";
  const user = await getAppUserByEmail(email);
  if (!user) throw new Error(`no app user for ${email}`);
  const client = new GoogleHealthClient(user.id);

  const start = new Date(Date.now() - 60_000);
  const nowIso = start.toISOString().replace(/\.\d{3}Z$/, "Z");
  const endIso = new Date(start.getTime() + 60_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  const offset = "-18000s"; // America/Chicago (CDT)

  async function tryCreate(label: string, dataType: string, body: unknown) {
    try {
      const created = (await client.createDataPoint(dataType, body)) as {
        name?: string;
        response?: { name?: string };
      };
      const name = created.name ?? created.response?.name;
      console.log(`CREATE OK  ${label}  name=${name}`);
      console.log(JSON.stringify(created).slice(0, 600));
      if (name) {
        await client.batchDeleteDataPoints(dataType, [name]);
        console.log(`DELETED    ${label}`);
      } else {
        console.log(`!! no name returned — MANUAL CLEANUP may be needed: ${label}`);
      }
    } catch (error) {
      console.log(`CREATE FAIL ${label}: ${(error as Error).message}`);
    }
    console.log("---");
  }

  // Shapes from the API discovery document (health.googleapis.com/$discovery):
  // EnergyQuantity {kcal}, WeightQuantity {grams}, VolumeQuantity {milliliters},
  // HydrationLog {interval, amountConsumed}, NutrientQuantity {nutrient, quantity}.
  await tryCreate("nutrition full", "nutrition-log", {
    nutritionLog: {
      interval: {
        startTime: nowIso,
        startUtcOffset: offset,
        endTime: endIso,
        endUtcOffset: offset,
      },
      mealType: "SNACK",
      foodDisplayName: "__probe__ delete me",
      energy: { kcal: 150, userProvidedUnit: "KILOCALORIE" },
      totalCarbohydrate: { grams: 20, userProvidedUnit: "GRAM" },
      totalFat: { grams: 5, userProvidedUnit: "GRAM" },
      nutrients: [
        { nutrient: "PROTEIN", quantity: { grams: 15, userProvidedUnit: "GRAM" } },
        { nutrient: "SODIUM", quantity: { grams: 0.2, userProvidedUnit: "MILLIGRAM" } },
      ],
    },
  });

  await tryCreate("hydration", "hydration-log", {
    hydrationLog: {
      interval: {
        startTime: nowIso,
        startUtcOffset: offset,
        endTime: endIso,
        endUtcOffset: offset,
      },
      amountConsumed: { milliliters: 250, userProvidedUnit: "MILLILITER" },
    },
  });

  await tryCreate("weight", "weight", {
    weight: {
      sampleTime: { physicalTime: nowIso, utcOffset: offset },
      weightGrams: 80000,
      notes: "__probe__ delete me",
    },
  });

  console.log("probe complete");
}

main().catch((error) => {
  console.error("write-probe crashed:", error?.message ?? error);
  process.exit(1);
});
