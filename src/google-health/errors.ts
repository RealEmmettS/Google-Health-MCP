/**
 * Normalized error types (docs/PLAN.md / handoff §21). MCP tools map these to
 * the specified client-facing error shapes; messages must never contain token
 * material (use redact helpers when wrapping upstream errors).
 */

export class GoogleHealthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotConnectedError extends GoogleHealthError {
  constructor() {
    super(
      "google_health_not_connected",
      "Google Health is not connected. Visit /api/auth/google-health/start to connect.",
    );
  }
}

export class ReauthRequiredError extends GoogleHealthError {
  constructor() {
    super(
      "reauth_required",
      "Google Health access needs to be reauthorized. Visit /api/auth/google-health/start to reconnect.",
    );
  }
}

export class MissingScopeError extends GoogleHealthError {
  constructor(public readonly requiredScopes: string[]) {
    super(
      "missing_scope",
      `This operation requires additional Google Health scope(s): ${requiredScopes.join(", ")}. Reconnect to grant them.`,
    );
  }
}

export class RateLimitedError extends GoogleHealthError {
  constructor(public readonly retryAfterSeconds: number) {
    super(
      "rate_limited",
      `Google Health API rate limit hit. Retry after ~${retryAfterSeconds}s.`,
    );
  }
}

export class GoogleApiError extends GoogleHealthError {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super("google_api_error", message);
  }
}

/** Token endpoint returned invalid_grant — the refresh token is dead. */
export class InvalidGrantError extends GoogleHealthError {
  constructor() {
    super("invalid_grant", "Google refresh token is expired or revoked.");
  }
}

export class TokenExchangeError extends GoogleHealthError {
  constructor(message: string) {
    super("token_exchange_failed", message);
  }
}
