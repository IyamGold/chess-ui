# MCP HTTP + OAuth — Implementation Plan

Authoritative design summary, then phased checklist. Aligned with the design conversation: agent identity model (B), enforced UI signup (inline on consent page), one agent per client × human, consent UI on the chess UI domain.

---

## Design Recap

**Goal:** Replace stdio MCP with a remote, OAuth-protected HTTP MCP server that works for Claude (Desktop / Code / .ai) and ChatGPT.

**Architecture:**
- New service `onchainchess-mcp` on Railway (its own URL, e.g. `https://onchainchess-mcp.up.railway.app`).
- Acts as the OAuth Authorization Server **and** the MCP Resource Server.
- Has its own SQLite DB (clients, codes, tokens, authorizations).
- Calls chess game server over HTTP (with a service-auth header) for identity + agent provisioning.
- Calls chess game server's existing token/move/WS APIs for actual gameplay (using each agent's own chess token).

**Identity model (B — agents):**
- Human is a `users` row with `parent_user_id IS NULL`.
- Each agent is a `users` row with `parent_user_id = <human.id>`.
- One agent per `(client_id × human)` pair. Auto-bind on re-auth.
- AI's games attributed to the agent, not the human.

**Consent flow:**
- MCP server `/authorize` redirects to `https://onchainchess.com/mcp/consent?...` (chess UI domain — required because passkeys are bound to that origin's rpId).
- Consent UI does WebAuthn (sign-in or sign-up auto-detected), inline chess-account signup if needed, agent username prompt on first time.
- Chess server signs a `consent_token` (HMAC with `MCP_SERVICE_SECRET`) containing `{human_user_id, agent_user_id, agent_chess_token, exp}`.
- Consent UI POSTs `{oauth_params, consent_token}` to MCP `/authorize/complete`. MCP verifies HMAC, mints OAuth auth code, 302s back to client `redirect_uri`.

**Token model:**
- MCP access tokens are opaque, DB-backed, hashed at rest. Mapped to agent chess token internally.
- Refresh tokens rotate on use (OAuth 2.1).
- Bearer extracted on every `/mcp` call; tool handler looks up agent chess token; refreshes via chess server `agent-token` endpoint on 401.

---

## Phase 0 — Chess Game Server changes

Foundations everything else depends on.

### Schema
- [x] Add migration: `ALTER TABLE users ADD COLUMN parent_user_id INTEGER NULL REFERENCES users(id);` *(server/db.js)*
- [x] Add index on `parent_user_id` for agent-listing queries.
- [x] Verify existing rows: all human (parent_user_id stays NULL by default). No backfill needed.

### Service-auth middleware
- [x] Add `MCP_SERVICE_SECRET` env var to chess server (random 32-byte hex). *(local: test_secret_local_only; prod: TBD)*
- [x] Middleware `requireServiceAuth` — validates `X-Service-Auth: <secret>` header on the new endpoints below. *(server/middleware/service-auth.js, timing-safe compare)*

### New endpoints (gated by `requireServiceAuth`)
- [x] `POST /api/internal/passkey-resolve` — body `{passkeyAddress}`. Returns 200 `{user_id, username}` or 404 `{error: "not_registered"}`.
- [x] `POST /api/internal/agent-create` — body `{parent_user_id, username}`. Validates parent is top-level, username unique/format. Returns `{agent_user_id, username, chess_token}`.
- [x] `POST /api/internal/agent-token` — body `{agent_user_id}`. Validates row is an agent. Mints fresh token. Returns `{chess_token, expires_at}`.
- [x] `POST /api/internal/issue-consent-token` — body `{human_user_id, agent_user_id, agent_chess_token, client_id}`. HMAC-SHA256 + 5-min expiry, base64url. Returns `{consent_token}`.

### Tweak existing endpoint
- [x] `POST /api/auth/token` (bridge): no change. Used by inline signup path on consent page.

### Tests / verification
- [x] Manual curl test for each new endpoint with valid + invalid service auth — all 7 cases pass (auth gate, found/not-found, agent create/rotate, dup-username 409, agent guard, nested-agent prevention, HMAC token).
- [x] Schema migration runs idempotently on existing chess.db — verified: `parent_user_id` column added, index created, no data loss.

---

## Phase 1 — MCP HTTP Server (new project) — ✅ DONE

### Project setup
- [x] Create new directory `mcp-http/` at repo root (keeps existing `mcp/` stdio version intact for self-hosters).
- [x] `package.json` with deps: `express`, `@modelcontextprotocol/sdk`, `better-sqlite3`, `zod`, `cors`, `ws`, `uuid`.
- [x] Inlined chess WS connection code (`game-ws.js`) with multi-tenant key `(token, roomId)` to prevent agent-collision in shared rooms.
- [x] `.env.example` + minimal `.env` loader in `config.js` (no extra dep).

### DB schema (SQLite, on Railway volume)
- [x] `clients` — `client_id, client_secret_hash, client_name, redirect_uris JSON, token_endpoint_auth_method, created_at`.
- [x] `auth_requests` — short-lived state for `/authorize` → consent UI handoff (10-min TTL). *(added beyond original plan; needed to keep OAuth params off the consent-page URL)*
- [x] `auth_codes` — `code_hash, mcp_authorization_id, code_challenge, code_challenge_method, redirect_uri, scope, expires_at`. Single-use, deleted on exchange.
- [x] `mcp_authorizations` — `id, client_id, human_user_id, agent_user_id, agent_chess_token, scope, created_at, updated_at` with `UNIQUE(client_id, human_user_id)` for auto-bind on re-auth.
- [x] `access_tokens` — `token_hash, mcp_authorization_id, scope, expires_at`. Hashed at rest.
- [x] `refresh_tokens` — `token_hash, mcp_authorization_id, family_id, used, expires_at`. Family tracking for reuse detection.
- [x] Cleanup interval (5 min) sweeps expired rows from all four short-lived tables.

### OAuth Authorization Server endpoints
- [x] **Discovery** — `/.well-known/oauth-protected-resource` (RFC 9728) and `/.well-known/oauth-authorization-server` (RFC 8414).
- [x] **DCR** — `POST /register` (RFC 7591). Open registration; supports public clients (PKCE-only) + confidential clients with `client_secret`.
- [x] **Authorize** — `GET /authorize` validates all params (response_type=code, registered redirect_uri, PKCE S256, scope=mcp:play). Persists `auth_request`, 302s to consent UI with opaque `request_id`. Errors render an inline HTML page rather than redirecting.
- [x] **Consent lookup** — `GET /authorize/lookup?request_id=...` returns client_name + scope for the consent UI to display. Validates expiry.
- [x] **Consent completion** — `POST /authorize/complete` verifies HMAC `consent_token`, upserts `mcp_authorizations` row (auto-bind on re-auth via UNIQUE constraint), mints auth code, returns `redirect_url` with state.
- [x] **Token** — `POST /token` for both `authorization_code` (with PKCE verifier) and `refresh_token` (with reuse detection — used→revoke family). Public + confidential client auth supported.
- [x] **Revocation** — `POST /revoke` (RFC 7009). Always 200, deletes matching access or refresh token.

### MCP endpoint
- [x] `POST /mcp` (also GET, DELETE) — `StreamableHTTPServerTransport` in stateless mode (`sessionIdGenerator: undefined`). Per-request McpServer instance bound to the bearer's authorization context.
- [x] Bearer middleware: reads `Authorization`, looks up `access_tokens`, joins to `mcp_authorizations`, populates `req.mcpAuth`.
- [x] Invalid/expired → 401 with `WWW-Authenticate: Bearer error="invalid_token", resource_metadata="<PRM url>"` (MCP spec compliant).

### Tool handlers
- [x] 7 tools ported (`create_account` dropped — agents are provisioned during OAuth): `create_game`, `wait_for_opponent`, `join_game`, `get_board_state`, `make_move`, `wait_for_turn`, `resign`.
- [x] Each handler uses `req.mcpAuth.agent_chess_token` directly. No file-based creds.
- [x] On chess-API 401: `withTokenRefresh` calls `/api/internal/agent-token`, updates `mcp_authorizations.agent_chess_token` via `req.mcpAuth.updateAgentToken()`, retries once.
- [x] `play_chess` prompt updated (no `create_account` mention).
- [x] Wait-tool default timeout dropped from 300s → 60s (capped at 90s) to stay under typical proxy idle limits. Agent-loop short-polls instead of long-polls.

### CORS
- [x] Whitelist consent UI origin + localhost on `/token` and `/revoke`. Discovery and `/mcp` need no CORS (server-to-server).

---

## Phase 2 — Consent UI on chess UI — ✅ DONE

### Routing setup
- [x] Install `react-router-dom`.
- [x] Wrap App in `<BrowserRouter>` (`main.jsx` → renders `<AppRoutes />`).
- [x] Routes: `/` (existing App), `/login` (`LoginPage`), `/mcp/consent` (`McpConsentPage`).
- [x] `vercel.json` already had the SPA fallback rule — no change needed.
- [x] App.jsx redirect: unauthenticated `/` users now `<Navigate to="/login?return_to=...">` instead of inline `<AuthGate>`.

### `/login` route
- [x] `src/pages/LoginPage.jsx` wraps existing `AuthGate` with passkey signup/login callbacks.
- [x] Honors `?return_to=<path>` after success.
- [x] `parseReturnTo` validates: must start with `/` and not `//`. Defaults to `/`.
- [x] Detects already-authenticated state on mount and redirects immediately.

### `/mcp/consent` route
- [x] `src/pages/McpConsentPage.jsx` — reads `request_id` from query.
- [x] Calls MCP `/authorize/lookup` for OAuth params; renders "session expired" on 410/404.
- [x] If `passkey.isAuthenticated` → effect kicks off resolve automatically.
- [x] Otherwise renders "Sign in with passkey" CTA → `usePasskeyAuth.login()`.

### Resolve human (no inline signup)
- [x] Calls MCP proxy `/authorize/passkey-resolve` (proxy verifies via login.com + chess server).
- [x] On 200 → advances to agent step.
- [x] On 404 → "Sign up at onchainchess →" button navigates to `/login?return_to=/mcp/consent?request_id=<id>`.
- [x] After signup, the LoginPage navigates back; `passkey.isAuthenticated === true` triggers the resolve effect automatically.

### Agent step
- [x] Calls MCP proxy `/authorize/has-agent` to detect existing binding.
- [x] If yes → skip prompt, finalize with `agent_user_id`.
- [x] If no → input form (3–32 chars, alphanumeric + hyphens) → submit → finalize with `agent_username`.

### Issue consent token + complete flow
- [x] `finalize()` → MCP `/authorize/provision-agent` → MCP `/authorize/issue-consent` → MCP `/authorize/complete` → `window.location.assign(redirect_url)`.

### UX polish
- [x] Phases: loading / ready / resolving / need-signup / name-agent / submitting / redirecting / error / expired — each has an explicit UI state.
- [x] Error messages surfaced from each step.
- [x] Mobile-friendly layout (centered card, max-width 28rem).
- [x] React strict-mode safe (`resolveStartedRef` guards against double-running).

### Browser-safe auth proxies — ✅ DONE (Phase 1.5)
Implemented in `mcp-http/oauth/consent-proxy.js`:
- [x] `POST /authorize/passkey-resolve` — verifies via login.com `/api/login`, then calls chess server `/api/internal/passkey-resolve`.
- [x] `POST /authorize/has-agent` — looks up `mcp_authorizations` for `(client_id, human_user_id)`.
- [x] `POST /authorize/provision-agent` — branches on `agent_username` (create) vs `agent_user_id` (rotate).
- [x] `POST /authorize/issue-consent` — calls chess server `/api/internal/issue-consent-token`.
- [x] Every proxy validates `request_id` exists + not expired (10-min TTL).
- [x] All four CORS-enabled for the consent UI origin.

---

## Phase 3 — Local integration testing

- [ ] Start all four services locally: chess server `:3001`, login.com `:3000`, MCP HTTP `:3002`, chess UI `:5173`.
- [ ] Use `claude mcp add onchainchess --transport http http://localhost:3002/mcp` (no auth-bearer config — Claude triggers OAuth flow on first call).

**Browser paths** (need real WebAuthn ceremony):
- [ ] **Path 1 — existing UI user, first-time MCP:** already-authenticated user visits consent page → resolve succeeds → agent-name prompt → tools work.
- [ ] **Path 2 — existing UI user, returning MCP (re-auth):** authenticated user, `(client_id × human)` already bound → no agent prompt → finalize directly → tools work.
- [ ] **Path 3 — has-passkey-no-chess-account:** unusual case (passkey registered with login.com but human row absent) → resolve returns 404 → "Sign up at onchainchess →" redirects to `/login?return_to=...` → after signup auto-resumes consent.
- [ ] **Path 4 — brand-new user:** unauthenticated → "Sign in" CTA fails (no credential) → user clicks "Sign up" on AuthGate → username + WebAuthn registration → return to consent → agent-name prompt → tools work.

**Programmatic paths** (no browser needed):
- [x] **Path 5 — auth code single-use:** verified during Phase 1 testing (replay of consumed code → "unknown or used code").
- [x] **Path 6 — refresh-token rotation + reuse detection:** verified during Phase 1 (refresh works once → reuse → family revoked).
- [ ] **Path 7 — token refresh on `/mcp`:** wait until access token expires (set short TTL for testing), make a tool call, observe 401 + client-side refresh.
- [ ] **Path 8 — revocation:** call `/revoke`, confirm subsequent `/mcp` calls 401.
- [ ] **Path 9 — chess-token rotation on tool 401:** revoke an agent's chess token directly in chess.db, observe `withTokenRefresh` recover transparently.

---

## Phase 4 — Deployment

### Chess game server
- [ ] Add `MCP_SERVICE_SECRET` to Railway env (generate with `openssl rand -hex 32`).
- [ ] Push schema migration + new endpoints. Verify Railway redeploys cleanly.

### Chess UI
- [ ] Push consent route. Verify it's reachable at `https://onchainchess.com/mcp/consent`.
- [ ] Add `VITE_MCP_SERVER_URL` env var pointing to MCP server URL.

### MCP HTTP server (new Railway service)
- [ ] Create new Railway service `onchainchess-mcp`.
- [ ] Mount a Railway volume for the SQLite DB at `/data` (or use Railway Postgres add-on — confirm with user).
- [ ] Env vars: `CHESS_SERVER_URL` (game server URL), `MCP_SERVICE_SECRET` (same value as chess server), `CONSENT_UI_URL` (chess UI URL), `BASE_URL` (this service's public URL), `DATABASE_PATH=/data/mcp.db`, `PORT` (Railway-provided).
- [ ] Generate domain in Railway settings.
- [ ] Confirm `/.well-known/oauth-authorization-server` returns valid JSON publicly.

---

## Phase 5 — Production smoke test

- [ ] In Claude Desktop, add custom connector with the production MCP URL.
- [ ] Run through Path 1 (existing user) and Path 4 (brand new) end-to-end.
- [ ] Verify agent's games show up under `parent_user_id = <my human user_id>` in chess DB.
- [ ] Verify the human's UI account shows their agents (if we add a "My Agents" UI panel — optional follow-up).
- [ ] Try Claude Code: `claude mcp add onchainchess --transport http https://onchainchess-mcp.up.railway.app/mcp` — confirm OAuth flow opens browser.

## Phase 6 — ChatGPT smoke test

- [ ] Add the same URL as a custom connector in ChatGPT.
- [ ] Document any failures (likely candidates: tool description format, scope name, redirect_uri scheme requirements).
- [ ] Iterate on schema/descriptions until ChatGPT accepts. Capture lessons in `tasks/lessons.md`.

## Phase 7 — Documentation

- [ ] Add `mcp-http/README.md` with install instructions for Claude Desktop, Claude Code, Claude.ai, ChatGPT.
- [ ] Update root `README.md` with a "Play with AI" section linking to the MCP install guide.
- [ ] Note in `mcp/README.md` (stdio version) that HTTP is the recommended path; stdio is for self-hosters.

---

## Decisions (locked)

1. **Storage:** SQLite on Railway volume.
2. **Stdio package:** keep `mcp/` for self-hosters; mention HTTP is preferred.
3. **Agent-listing UI on chess profile:** in scope.
4. **MCP SDK auth helpers:** thin layer on top — keep control over flow specifics (HMAC consent token, agent provisioning).

---

## Summary

7 phases. Phase 0 is small (chess server schema + 4 endpoints). Phase 1 is the bulk of new code (MCP server with OAuth). Phase 2 is the consent UI. Phases 3–7 are integration, deploy, test, document.

Minimum viable end state: a friend on Claude Desktop pastes a URL, taps a passkey, names their agent, and starts playing — without ever leaving the consent page or running a CLI.
