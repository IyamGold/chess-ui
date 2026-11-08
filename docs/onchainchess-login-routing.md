# Fix Continue with Login on onchainchess.app

Unaudited testnet / Sumsub sandbox demo only.

## What caused the reload

The published Vercel config rewrites **every** route to `/index.html`, including
`/api/login/session` and `/api/login/start`. The button therefore returns the
Chess frontend instead of reaching the Chess OIDC backend. The API error was
previously treated as an ordinary signed-out session, hiding the routing problem.
The old backend configuration also allowed only `chess-demo.withlogin.com` as the
public Chess origin; the actual public domain is `onchainchess.app`.

## HTTP routing on the current Vercel site

`vercel.json` now forwards `/api/*` to the confirmed Chess backend,
`https://chess-ui-production.up.railway.app/api/*`, **before** the SPA fallback.
Vercel must deploy the updated config for this rule to take effect. This lets
HTTP session/start/callback requests reach the right server while Gold finishes
the custom-domain setup. API responses are marked `no-store`.

That HTTP rule alone does not complete the existing same-origin WebSocket
multiplayer setup. Use the whole-app Railway custom domain below for the complete
demo; do not present a working sign-in as proof that multiplayer works on Vercel.

## Gold's deployment changes

Use the existing Railway Chess service, whose assigned public address is
`https://chess-ui-production.up.railway.app`, to serve the **whole Chess app**.
It already serves built frontend assets, the API and WebSockets. Keep the Chess
browser, cookie session and WSS connection on `https://onchainchess.app`.
A Vercel static SPA fallback does not provide this backend. The compatibility
HTTP proxy in this patch repairs the immediate sign-in routing, while moving the
whole public Chess origin to Railway completes the WebSocket routing too.

1. Deploy the origin/routing fix to Railway from the repository root, with Node
   22 and the existing `nixpacks.toml` install phases. Build `npm run build`;
   start `npm --prefix server start`. Keep a persistent volume for the database.
2. Set these non-secret Railway variables on the **Chess** service:

   ```text
   CHESS_PUBLIC_DEMO=1
   CHESS_ORIGIN=https://onchainchess.app
   LOGIN_ISSUER=https://demo.withlogin.com/oidc
   LOGIN_CLIENT_ID=chess-demo
   CHESS_DB_PATH=/data/chess.db
   ```

   `/data` must be the real persistent-volume mount. Railway supplies `PORT`.
   Public mode fails startup without the approved issuer/origin, explicit opt-in
   and a disk database path. Keep one replica for the existing SQLite/event model.

3. In Railway's Chess service, add `onchainchess.app` as a **custom domain** and
   use the exact DNS/verification records Railway provides. Update only the
   conflicting records currently pointing this Chess domain at Vercel. Do not
   change Login's `demo.withlogin.com` hosting or DNS. Wait for domain/TLS status
   to become valid. Merely using a Railway-generated public URL is not the same
   as registering the custom domain. Do not guess the apex DNS target.
4. On the **Login API** deployment, keep the existing `chess-demo` client ID and
   add/replace its exact callback in `OIDC_CLIENTS`:

   ```json
   {
     "client_id": "chess-demo",
     "client_name": "Login Chess — unaudited testnet demo",
     "redirect_uris": ["https://onchainchess.app/api/login/callback"]
   }
   ```

   Preserve other registered clients. Keep `OIDC_ENABLED=1`,
   `OIDC_ISSUER=https://demo.withlogin.com/oidc`, the previously generated stable
   signing/cookie keys and the persistent Login database. Do not generate new
   keys to fix routing. The hosted OIDC feature must be deployed on Login too.

5. Redeploy changed services. Open Chess at the **canonical custom domain**,
   `https://onchainchess.app`, for sign-in. The Railway-generated address is useful
   for health checks; it is not the registered callback origin.

Gold owns these hosting/DNS settings. No service, DNS record or secret is changed
by this patch. This is a change to the Chess domain; the Login passkey RP remains
`withlogin.com`, and passkeys are still created/used on Login's origin.

## Verify after deployment

- `https://onchainchess.app/api/health` returns JSON with `status: "ok"`, not HTML.
- Signed out, `/api/login/session` returns HTTP 401 JSON, not the Chess page.
- `/api/login/start` returns a redirect to `https://demo.withlogin.com/oidc/auth`.
  It must not return `/index.html` or the Chess login page with status 200.
- Login discovery at `/oidc/.well-known/openid-configuration` on
  `demo.withlogin.com` returns that exact HTTPS issuer.
- Complete a sandbox passkey sign-in, consent and callback. Check the address
  returns to `https://onchainchess.app`, with a Secure HttpOnly Chess session.
- Create/join a game from two browser profiles. Check the WSS connection uses
  `onchainchess.app` and reconnect works. Test KYC-optional play and sandbox labels.

The old `https://chess-demo.withlogin.com` origin remains explicitly supported
when selected by configuration. Arbitrary HTTPS origins, lookalike domains and
`www.onchainchess.app` are not implicitly trusted. Choose one canonical origin
for a deployment. PKCE, state/nonce/signature checks and Origin checks remain on.
