import { auth } from "./auth";

export async function requireSameOriginSession(request: Request) {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.BETTER_AUTH_URL ??
    new URL(request.url).origin;
  const expectedOrigin = new URL(appUrl).origin;
  const origin = request.headers.get("origin");
  if (!origin || origin !== expectedOrigin) return null;
  return auth.api.getSession({ headers: request.headers });
}
