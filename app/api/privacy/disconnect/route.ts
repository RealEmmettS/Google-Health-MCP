import { getAppUserByEmail } from "@/src/auth/app-user";
import { requireSameOriginSession } from "@/src/auth/same-origin-session";
import { disconnectGoogleHealth } from "@/src/health-services/data-controls";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const session = await requireSameOriginSession(request);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const user = await getAppUserByEmail(session.user.email);
  if (!user) {
    return Response.json({
      disconnected: true,
      googleRevocation: "not_available",
    });
  }
  return Response.json(await disconnectGoogleHealth(user.id));
}
