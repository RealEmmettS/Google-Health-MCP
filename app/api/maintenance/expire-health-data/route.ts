import { timingSafeEqual } from "node:crypto";
import { expireShortLivedHealthData } from "../../../../src/health-services/retention";

export const runtime = "nodejs";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const received = request.headers.get("authorization");
  if (!secret || !received) return false;
  const expectedBytes = Buffer.from(`Bearer ${secret}`);
  const receivedBytes = Buffer.from(received);
  return (
    expectedBytes.length === receivedBytes.length &&
    timingSafeEqual(expectedBytes, receivedBytes)
  );
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return Response.json({
    ok: true,
    deleted: await expireShortLivedHealthData(),
    completedAt: new Date().toISOString(),
  });
}
