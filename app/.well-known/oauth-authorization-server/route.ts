import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { auth } from "@/src/auth/auth";

export const runtime = "nodejs";
export const preferredRegion = "iad1";

const metadata = oauthProviderAuthServerMetadata(auth, {
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
  },
});

export const GET = metadata;
export const HEAD = metadata;
