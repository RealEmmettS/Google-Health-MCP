TT;DR: The night-one infrastructure session: the Vercel project went from nonexistent to live on a custom domain, the Google OAuth client got fully created and wired, Neon got connected, and the OAuth app got published — clearing every operator dependency for Phases 1–6.

## Why
Direct operator order (Emmett: "create a task that tracks everything we just did, so we have it on the record"). This work was originally scheduled as Phase 7 steps 1–3, but Emmett pulled it forward on 2026-07-09 so agents are never blocked on operator input mid-build. Retro-documented; created in Done.

## What was done (the record, 2026-07-09 ~00:20–00:50 CT)

**Vercel (emmett + agent):**
- Emmett created project `google-health-mcp` (prj_hZe49opI8FWMx8fWnGDbNI34zUzo, team realemmetts) by importing RealEmmettS/Google-Health-MCP. Framework auto-detect (Next.js) was correct — no settings changes needed.
- First build FAILED: npm had resolved `typescript@7.0.2` (native compiler) which Next 16's build-time type checker can't load. Agent pinned `typescript@^5` (→5.9.3), verified `next build` locally, pushed 8dd5fa9.
- Auto-deploy webhook did NOT fire on that push → agent deployed manually via `npx vercel deploy --prod`. WATCH: whether future pushes auto-deploy.
- Production served Vercel SSO instead of the app: **Deployment Protection** was walling off production. Agent set it to preview-only via API (`ssoProtection: {deploymentType: "preview"}`). MUST STAY off production — the app brings its own auth (better-auth OAuth + allowlist).
- Agent attached custom domain **health.emmetts.dev** (canonical). emmetts.dev DNS is Google Cloud DNS (not Vercel), so Emmett added the CNAME: `health` → `ccb2fac253c976e8.vercel-dns-017.com.`. Live + TLS confirmed 00:46 CT. Vercel-assigned domain google-health-mcp-realemmetts.vercel.app also serves.
- Agent linked repo via CLI (auth: shaughv) and set production env: TOKEN_ENCRYPTION_KEY + BETTER_AUTH_SECRET (fresh, prod-only values), BETTER_AUTH_URL + NEXT_PUBLIC_APP_URL = https://health.emmetts.dev, ALLOWED_GOOGLE_EMAILS = eshaughv@gmail.com,google@emmetts.dev, GOOGLE_CLIENT_ID/SECRET (from client JSON).

**Neon (emmett):**
- Connected `shaughv-health-db` to the project via Storage tab: environments Production+Preview, NO deployment branches, NO custom prefix, sensitive on. DATABASE_URL + DATABASE_URL_UNPOOLED (+ POSTGRES_*) injected.

**Google Cloud (emmett, agent-guided):**
- Finished OAuth web client "Shaughv OAuth Client 1" (project gen-lang-client-0346225705, client id 752486665814-…apps.googleusercontent.com) with ALL SIX redirect URIs: {health.emmetts.dev, google-health-mcp-realemmetts.vercel.app, localhost:3000} × {/api/auth/callback/google, /api/auth/google-health/callback}.
- Client JSON archived at `.tasks/secure/google-oauth-client.json` (gitignored); values in `.env.development.local` + Vercel prod env. Downloads copy can be deleted.
- Audience: test user eshaughv@gmail.com (Google account owning the Fitbit data; native alias google@emmetts.dev).
- **App PUBLISHED to "In production"** (unverified — the "needs verification" badge is expected and stays; do NOT submit for verification). This is what makes refresh tokens long-lived instead of 7-day.

## Impact
Every operator dependency for Phases 1–6 is cleared; agents can build/migrate/deploy/test unattended. Remaining operator moments live in #p7d: run the prod health-consent flow (after Phase 3), add MCP connectors in each client, final E2E.
Risks recorded: Deployment Protection must stay off production; prod env vars only take runtime effect on next deploy (any Phase 1+ deploy covers it); auto-deploy webhook unverified.

## Acceptance
Prod healthcheck 200 on both domains; DATABASE_URL in prod env; 6 redirect URIs registered; app in production status.

## Verification
- [x] https://health.emmetts.dev/api/health/status returns service JSON (TLS valid, 00:46 CT)
- [x] https://google-health-mcp-realemmetts.vercel.app/api/health/status returns service JSON
- [x] DATABASE_URL + DATABASE_URL_UNPOOLED present in Vercel env (Preview+Production)
- [x] All 9 app env vars present in Production (env ls verified)
- [x] Client JSON's redirect_uris array matches the canonical 6 exactly
- [x] Deployment Protection = preview-only (API response confirmed)
- [~] OAuth app shows "In production" (waived 2026-07-09 — agent: Emmett confirmed publishing; console state not independently checkable by agent — recheck refresh-token longevity after 7 days, tracked in #p7d)

## Status
DONE. Nothing to resume. See #p7d for the remaining deploy-phase items.

## Activity
- 2026-07-09 00:55 — created retroactively in Done at Emmett's request, documenting the full infra session (agent: fable)
