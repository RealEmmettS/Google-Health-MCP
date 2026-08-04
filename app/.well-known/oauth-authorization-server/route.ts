import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { auth } from "@/src/auth/auth";
import { normalizeAuthorizationServerMetadata } from "@/src/auth/oauth-provider-boundary";

export const runtime = "nodejs";
export const preferredRegion = "iad1";

const providerMetadata = oauthProviderAuthServerMetadata(auth, {
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
  },
});

export async function GET(request: Request): Promise<Response> {
  return normalizeAuthorizationServerMetadata(await providerMetadata(request));
}

export const HEAD = providerMetadata;
