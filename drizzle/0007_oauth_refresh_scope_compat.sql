-- Current desktop MCP clients do not all implement SEP-2207's
-- `offline_access` augmentation. Some registered only the two resource scopes
-- advertised by the initial challenge even though the authorization server
-- supports offline continuity. Expand only this private server's existing
-- public, active, health-scope-only registrations. This does not grant consent,
-- issue a token, reveal a secret, or modify any existing token row; the owner
-- must still complete one normal authorization to receive a refresh token.
UPDATE "mcp_oauth_client_v2"
SET
  "scopes" = ARRAY[
    'openid',
    'profile',
    'email',
    'offline_access',
    'health:read',
    'health:write'
  ]::text[],
  "updated_at" = now()
WHERE
  "public" IS TRUE
  AND "disabled" IS NOT TRUE
  AND "token_endpoint_auth_method" = 'none'
  AND COALESCE("scopes", ARRAY[]::text[]) <@ ARRAY[
    'openid',
    'profile',
    'email',
    'offline_access',
    'health:read',
    'health:write'
  ]::text[]
  AND NOT (
    COALESCE("scopes", ARRAY[]::text[]) @> ARRAY[
      'openid',
      'profile',
      'email',
      'offline_access',
      'health:read',
      'health:write'
    ]::text[]
  );
