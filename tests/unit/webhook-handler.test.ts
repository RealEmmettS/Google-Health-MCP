import { describe, expect, it, vi } from "vitest";
import {
  handleGoogleHealthWebhook,
  type WebhookHandlerDependencies,
} from "../../src/webhooks/google-health-handler";

const secret = "Bearer webhook-test-secret";
const notification = {
  data: {
    version: "1",
    healthUserId: "health-user-1",
    operation: "UPSERT",
    dataType: "steps",
    intervals: [],
  },
};

function request(
  body: unknown,
  options?: { authorized?: boolean; signature?: string },
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (options?.authorized !== false) headers.set("authorization", secret);
  if (options?.signature) {
    headers.set("google-health-api-signature", options.signature);
  }
  return new Request("https://health.example/api/webhooks/google-health", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function dependencies(
  overrides?: Partial<WebhookHandlerDependencies>,
): WebhookHandlerDependencies {
  return {
    authorizationSecret: secret,
    verifySignature: vi.fn(async () => true),
    processNotification: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("Google Health webhook handler", () => {
  it("passes the authorized verification handshake", async () => {
    const deps = dependencies();
    const response = await handleGoogleHealthWebhook(
      request({ type: "verification" }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.verifySignature).not.toHaveBeenCalled();
    expect(deps.processNotification).not.toHaveBeenCalled();
  });

  it("rejects Google's unauthorized verification challenge", async () => {
    const response = await handleGoogleHealthWebhook(
      request({ type: "verification" }, { authorized: false }),
      dependencies(),
    );
    expect(response.status).toBe(401);
  });

  it("rejects a notification with a bad Google signature", async () => {
    const deps = dependencies({ verifySignature: vi.fn(async () => false) });
    const response = await handleGoogleHealthWebhook(
      request(notification, { signature: "bad" }),
      deps,
    );

    expect(response.status).toBe(403);
    expect(deps.processNotification).not.toHaveBeenCalled();
  });

  it("durably processes a valid notification before returning 204", async () => {
    const processNotification = vi.fn(async () => undefined);
    const deps = dependencies({ processNotification });
    const response = await handleGoogleHealthWebhook(
      request(notification, { signature: "valid" }),
      deps,
    );

    expect(response.status).toBe(204);
    expect(processNotification).toHaveBeenCalledTimes(1);
    expect(processNotification).toHaveBeenCalledWith(
      notification.data,
      expect.any(Buffer),
    );
  });

  it("returns 500 so Google retries when durable processing fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await handleGoogleHealthWebhook(
        request(notification, { signature: "valid" }),
        dependencies({
          processNotification: vi.fn(async () => {
            throw new Error("database unavailable");
          }),
        }),
      );
      expect(response.status).toBe(500);
    } finally {
      consoleError.mockRestore();
    }
  });
});
