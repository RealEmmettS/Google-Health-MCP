import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/src/auth/auth";
import {
  boundMcpTokenRequest,
  isMcpAuthPath,
  repairAuthorizationServerMetadata,
  repairMcpTokenResponse,
  repairProtectedResourceMetadata,
  preflightMcpTokenSigning,
  validateMcpAuthorizeRequest,
  validateMcpTokenResource,
  validateMcpTokenMediaType,
  withNoStore,
  type McpIdTokenSigner,
} from "@/src/auth/mcp-oauth-compat";

// better-auth handler: Google sign-in, session management, and the MCP
// plugin's OAuth 2.1 authorization-server endpoints (authorize, token,
// dynamic client registration).
export const runtime = "nodejs";

const handlers = toNextJsHandler(auth);

const signMcpIdToken: McpIdTokenSigner = async (payload) => {
  const signed = await auth.api.signJWT({ body: { payload } });
  return signed.token;
};

export async function GET(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (isMcpAuthPath(pathname, "authorize")) {
    const invalidRequest = validateMcpAuthorizeRequest(request);
    if (invalidRequest) return invalidRequest;
  }

  const response = await handlers.GET(request);
  if (isMcpAuthPath(pathname, "authorizationMetadata")) {
    return repairAuthorizationServerMetadata(response);
  }
  if (isMcpAuthPath(pathname, "protectedResourceMetadata")) {
    return repairProtectedResourceMetadata(response);
  }
  return response;
}

export async function POST(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const isMcpTokenRequest = isMcpAuthPath(pathname, "token");
  const isMcpRegistration = isMcpAuthPath(pathname, "register");
  let handledRequest = request;
  let requestCopy: Request | undefined;
  if (isMcpTokenRequest) {
    const invalidMediaType = validateMcpTokenMediaType(request);
    if (invalidMediaType) return invalidMediaType;
    const bounded = await boundMcpTokenRequest(request);
    if ("response" in bounded) return bounded.response;
    handledRequest = bounded.request;
    requestCopy = handledRequest.clone();

    const invalidResource = await validateMcpTokenResource(handledRequest.clone());
    if (invalidResource) return invalidResource;
    const signingUnavailable = await preflightMcpTokenSigning(
      handledRequest.clone(),
      signMcpIdToken,
    );
    if (signingUnavailable) return signingUnavailable;
  }

  const response = await handlers.POST(handledRequest);
  if (requestCopy) {
    return repairMcpTokenResponse(requestCopy, response, signMcpIdToken);
  }
  return isMcpRegistration ? withNoStore(response) : response;
}
