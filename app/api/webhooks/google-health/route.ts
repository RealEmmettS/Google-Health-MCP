import { handleGoogleHealthWebhook } from "../../../../src/webhooks/google-health-handler";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleGoogleHealthWebhook(request);
}
