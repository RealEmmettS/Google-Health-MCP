/** PATCH recipe hunt, round 2: sparse bodies, dataSource, name variants. */
import { config } from "dotenv";

config({ path: ".env.development.local", quiet: true });

async function main() {
  const { getAppUserByEmail } = await import("../src/auth/app-user");
  const { GoogleHealthClient } = await import("../src/google-health/client");
  const { toSessionInterval, parseUserDateTime } = await import("../src/time/ranges");

  const user = await getAppUserByEmail("eshaughv@gmail.com");
  if (!user) throw new Error("no user");
  const client = new GoogleHealthClient(user.id);

  const created = (await client.createDataPoint("nutrition-log", {
    nutritionLog: {
      interval: toSessionInterval(parseUserDateTime(undefined, "America/Chicago")),
      mealType: "SNACK",
      foodDisplayName: "__patchprobe2__",
      energy: { kcal: 100, userProvidedUnit: "KILOCALORIE" },
    },
  })) as {
    response?: {
      name?: string;
      dataSource?: unknown;
      nutritionLog?: Record<string, unknown>;
    };
  };
  const name = created.response?.name;
  const dataSource = created.response?.dataSource;
  const current = created.response?.nutritionLog ?? {};
  const interval = { ...(current.interval as Record<string, unknown>) };
  delete interval.civilStartTime;
  delete interval.civilEndTime;
  console.log("created", name);

  const sparse = { energy: { kcal: 175, userProvidedUnit: "KILOCALORIE" } };
  const sparseWithInterval = { interval, ...sparse };
  const full = { ...current, interval, ...sparse };

  const attempts: Array<[string, unknown]> = [
    ["sparse nutritionLog only", { nutritionLog: sparse }],
    ["sparse + interval", { nutritionLog: sparseWithInterval }],
    ["full + dataSource + name", { name, dataSource, nutritionLog: full }],
    ["full + dataSource, no name", { dataSource, nutritionLog: full }],
    ["full, no name", { nutritionLog: full }],
  ];

  for (const [label, body] of attempts) {
    try {
      const result = (await client.rawPatch(`/${name}`, body)) as {
        response?: { nutritionLog?: { energy?: { kcal?: number } } };
        nutritionLog?: { energy?: { kcal?: number } };
      };
      const kcal =
        result.response?.nutritionLog?.energy?.kcal ?? result.nutritionLog?.energy?.kcal;
      console.log(`PATCH OK (${label}) kcal=${kcal}`);
      break;
    } catch (error) {
      console.log(`PATCH FAIL (${label}): ${(error as Error).message.slice(0, 140)}`);
    }
  }

  if (name) {
    await client.batchDeleteDataPoints("nutrition-log", [name]);
    console.log("probe entry deleted");
  }
}

main().catch((error) => {
  console.error("crashed:", error?.message ?? error);
  process.exit(1);
});
