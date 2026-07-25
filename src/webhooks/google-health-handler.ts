import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { redactError } from "../security/redact";
import {
  processGoogleHealthNotification,
  type GoogleHealthNotification,
} from "./google-health-events";
import { verifyGoogleHealthSignature } from "./google-health-signature";

const notificationSchema = z.object({
  data: z.object({
    version: z.string().max(10),
    clientProvidedSubscriptionName: z.string().max(256).optional(),
    healthUserId: z.string().min(1).max(256),
    operation: z.enum(["UPSERT", "DELETE"]),
    dataType: z.string().min(1).max(64),
    intervals: z.array(z.unknown()).max(100).default([]),
  }),
});

function authorized(received: string | null, expected: string | undefined): boolean {
  if (!received || !expected) return false;
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return (
    receivedBytes.length === expectedBytes.length &&
    timingSafeEqual(receivedBytes, expectedBytes)
  );
}

export interface WebhookHandlerDependencies {
  verifySignature(
    rawBody: Buffer,
    encodedSignature: string,
  ): Promise<boolean>;
  processNotification(
    notification: GoogleHealthNotification,
    rawBody: Buffer,
  ): Promise<unknown>;
  authorizationSecret?: string;
}

const defaultDependencies: WebhookHandlerDependencies = {
  verifySignature: verifyGoogleHealthSignature,
  processNotification: processGoogleHealthNotification,
  authorizationSecret: process.env.WEBHOOK_AUTH_SECRET,
};

export async function handleGoogleHealthWebhook(
  request: Request,
  dependencies: WebhookHandlerDependencies = defaultDependencies,
): Promise<Response> {
  const rawBody = Buffer.from(await request.arrayBuffer());
  const isAuthorized = authorized(
    request.headers.get("authorization"),
    dependencies.authorizationSecret,
  );
  if (!isAuthorized) return new Response(null, { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (
    body &&
    typeof body === "object" &&
    (body as Record<string, unknown>).type === "verification"
  ) {
    return Response.json({ verified: true }, { status: 200 });
  }

  const parsed = notificationSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_notification" }, { status: 400 });
  }

  const signature = request.headers.get("google-health-api-signature");
  if (!signature || !(await dependencies.verifySignature(rawBody, signature))) {
    return new Response(null, { status: 403 });
  }

  try {
    await dependencies.processNotification(parsed.data.data, rawBody);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("google_health_webhook_processing_failed", {
      message: redactError(error).message,
    });
    return new Response(null, { status: 500 });
  }
}

export const _internal = { authorized, notificationSchema };
