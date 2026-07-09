/**
 * The MCP server is private: only Google accounts listed in
 * ALLOWED_GOOGLE_EMAILS may sign in (docs/PLAN.md auth layer 4). To grant
 * someone access, add their Google email to the env var — nothing else.
 */

export interface AllowlistEnv {
  ALLOWED_GOOGLE_EMAILS?: string;
  [key: string]: string | undefined;
}

export function getAllowedEmails(env: AllowlistEnv = process.env): string[] {
  return (env.ALLOWED_GOOGLE_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

export function isAllowedEmail(
  email: string | null | undefined,
  env: AllowlistEnv = process.env,
): boolean {
  if (!email) return false;
  return getAllowedEmails(env).includes(email.trim().toLowerCase());
}
