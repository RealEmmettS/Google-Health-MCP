import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/src/auth/auth";
import {
  normalizeRegistrationResponse,
  normalizeOAuthTokenResponse,
  prepareOAuthRegistrationRequest,
  prepareOAuthTokenRequest,
  validateAuthorizeResource,
  withOAuthNoStore,
} from "@/src/auth/oauth-provider-boundary";

// Better Auth handles Google sign-in/session routes plus the stable OAuth 2.1
// Provider endpoints under /api/auth/oauth2/*. Security-sensitive DCR and
// token normalization stays at this small, testable HTTP boundary.
export const runtime = "nodejs";
export const preferredRegion = "iad1";

const handlers = toNextJsHandler(auth);

export async function GET(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/auth/oauth2/authorize") {
    const invalidResource = validateAuthorizeResource(request);
    if (invalidResource) return invalidResource;
  }
  const response = await handlers.GET(request);
  return pathname.startsWith("/api/auth/oauth2/")
    ? withOAuthNoStore(response)
    : response;
}

export async function POST(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname;

  if (pathname === "/api/auth/oauth2/token") {
    const prepared = await prepareOAuthTokenRequest(request);
    if ("response" in prepared) return prepared.response;
    return normalizeOAuthTokenResponse(
      await handlers.POST(prepared.request),
      async (payload) => {
        const result = await auth.api.signJWT({ body: { payload } });
        return result.token;
      },
    );
  }

  if (pathname === "/api/auth/oauth2/register") {
    const prepared = await prepareOAuthRegistrationRequest(request);
    if ("response" in prepared) return prepared.response;
    return normalizeRegistrationResponse(
      await handlers.POST(prepared.request),
      prepared.applicationType,
    );
  }

  const response = await handlers.POST(request);
  return pathname.startsWith("/api/auth/oauth2/")
    ? withOAuthNoStore(response)
    : response;
}
