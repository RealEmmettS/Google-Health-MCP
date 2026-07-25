import { getAppUserByEmail } from "@/src/auth/app-user";
import { requireSameOriginSession } from "@/src/auth/same-origin-session";
import { deleteStoredHealthData } from "@/src/health-services/data-controls";

export const runtime = "nodejs";

const CONFIRMATION = "DELETE MY STORED HEALTH DATA";

export async function POST(request: Request): Promise<Response> {
  const session = await requireSameOriginSession(request);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as
    | { confirmation?: unknown }
    | null;
  if (body?.confirmation !== CONFIRMATION) {
    return Response.json({ error: "confirmation_required" }, { status: 400 });
  }
  const user = await getAppUserByEmail(session.user.email);
  if (!user) {
    return Response.json({ deleted: true, googleRevocation: "not_available" });
  }
  return Response.json(await deleteStoredHealthData(user.id));
}
