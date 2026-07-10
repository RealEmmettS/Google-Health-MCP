/** One-off: clean orphaned test entries + find the working PATCH recipe. */
import { config } from "dotenv";

config({ path: ".env.development.local", quiet: true });

async function main() {
  const { getAppUserByEmail } = await import("../src/auth/app-user");
  const { GoogleHealthClient } = await import("../src/google-health/client");
  const { toSessionInterval, parseUserDateTime } = await import("../src/time/ranges");

  const user = await getAppUserByEmail("eshaughv@gmail.com");
  if (!user) throw new Error("no user");
  const client = new GoogleHealthClient(user.id);

  // 1) Clean any orphaned __test__/__probe__ nutrition entries from today.
  const page = await client.listDataPoints({
    dataType: "nutrition-log",
    filter: `nutrition_log.interval.civil_start_time >= "2026-07-09T00:00:00"`,
    pageSize: 100,
  });
  const orphans = (page.dataPoints ?? [])
    .map((dp) => dp as { name?: string; nutritionLog?: { foodDisplayName?: string } })
    .filter((dp) => dp.nutritionLog?.foodDisplayName?.startsWith("__"));
  if (orphans.length) {
    await client.batchDeleteDataPoints(
      "nutrition-log",
      orphans.map((o) => o.name!),
    );
    console.log(`cleaned ${orphans.length} orphan(s)`);
  } else {
    console.log("no orphans found");
  }

  // 2) Create a fresh probe entry and try PATCH recipes until one works.
  const created = (await client.createDataPoint("nutrition-log", {
    nutritionLog: {
      interval: toSessionInterval(parseUserDateTime(undefined, "America/Chicago")),
      mealType: "SNACK",
      foodDisplayName: "__patchprobe__",
      energy: { kcal: 100, userProvidedUnit: "KILOCALORIE" },
    },
  })) as { response?: { name?: string; nutritionLog?: Record<string, unknown> } };
  const name = created.response?.name;
  console.log("created", name);
  const current = created.response?.nutritionLog ?? {};

  // Strip output-only members from the interval.
  const interval = { ...(current.interval as Record<string, unknown>) };
  delete interval.civilStartTime;
  delete interval.civilEndTime;
  const cleanLog = { ...current, interval, energy: { kcal: 175, userProvidedUnit: "KILOCALORIE" } };

  const attempts: Array<[string, string]> = [
    ["stripped body, no mask", `/${name}`],
    ["stripped body, mask=nutritionLog", `/${name}?updateMask=nutritionLog`],
    [
      "stripped body, granular mask",
      `/${name}?updateMask=${encodeURIComponent("nutritionLog.energy")}`,
    ],
  ];
  for (const [label, path] of attempts) {
    try {
      const result = (await client.rawPatch(path, { name, nutritionLog: cleanLog })) as {
        response?: { nutritionLog?: { energy?: { kcal?: number } } };
      };
      console.log(
        `PATCH OK (${label}) kcal=`,
        result.response?.nutritionLog?.energy?.kcal ?? JSON.stringify(result).slice(0, 200),
      );
      break;
    } catch (error) {
      console.log(`PATCH FAIL (${label}):`, (error as Error).message.slice(0, 200));
    }
  }

  // 3) Always clean up.
  if (name) {
    await client.batchDeleteDataPoints("nutrition-log", [name]);
    console.log("probe entry deleted");
  }
}

main().catch((error) => {
  console.error("crashed:", error?.message ?? error);
  process.exit(1);
});
