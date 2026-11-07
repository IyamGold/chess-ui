# Hosted Login Chess demo

**Unaudited hackathon demo. Testnet funds and Sumsub sandbox identities only.**
Build on this repository's existing Login integration; do not deploy the old
wallet/passkey service or Fluent contract for this flow.

## Railway service

Deploy the repository root on Railway using `railway.json`. The single Express
process serves built Vite assets, `/api`, and the multiplayer WebSocket endpoint.
There is no separate Vercel function or cross-origin browser API. Use Node 22
(`.node-version`, package engines, and `NIXPACKS_NODE_VERSION=22` in Railway).
`better-sqlite3` is a native dependency: do not skip its install scripts or copy
Windows node_modules into the deployment.

Set these **non-secret** variables:

| Variable                | Value                                                         |
| ----------------------- | ------------------------------------------------------------- |
| `NODE_ENV`              | `production`                                                  |
| `NIXPACKS_NODE_VERSION` | `22`                                                          |
| `CHESS_PUBLIC_DEMO`     | `1`                                                           |
| `LOGIN_ISSUER`          | `https://demo.withlogin.com/oidc`                             |
| `LOGIN_CLIENT_ID`       | `chess-demo`                                                  |
| `CHESS_ORIGIN`          | `https://chess-demo.withlogin.com`                            |
| `CHESS_DB_PATH`         | `/data/chess.db`, with a persistent Railway volume at `/data` |
| `PORT`                  | Railway supplies this                                         |

Railway build command: `npm run build`.
`nixpacks.toml` installs frontend and backend dependencies in the **install** phase,
including development tools for Vite and native SQLite lifecycle scripts for the
backend. Do not put `npm ci` in the build command: Nixpacks mounts
`node_modules/.cache` in that phase, and npm tries to remove it when reinstalling.
An `EBUSY` / `rmdir .../node_modules/.cache` error can surface as exit code 240.

For a manual build outside Nixpacks: `npm ci --include=dev`, then
`npm --prefix server ci --omit=dev --ignore-scripts=false`, then `npm run build`.
Start: `npm --prefix server start`. Bind is `0.0.0.0` only for the explicitly
approved hosted mode. Keep one replica for its SQLite database and in-memory
game event connections. Restarting may interrupt an in-flight sign-in; start it
again. Persisted chess sessions and games live on the volume. Back it up privately.

The approved `openid-client` is a Chess **runtime** dependency here; this does not
change its dev-only status in the separate Login API repository. The browser
receives an HttpOnly Secure SameSite=Lax chess session, never provider tokens.
ID-token signature, issuer, audience, expiry, nonce, state, PKCE and UserInfo
subject are checked. HTTPS mode never enables insecure OIDC transport. Forged
callbacks cannot create sessions. Callback URL/issuer are pinned configuration,
not inferred from proxy headers. CORS, API POST Origin checks and WebSocket
Origin checks use the same configured Chess origin.

## Login provider registration

Ask the Login deployment owner to add this exact entry to `OIDC_CLIENTS`:

```json
{
  "client_id": "chess-demo",
  "client_name": "Login Chess — unaudited testnet demo",
  "redirect_uris": ["https://chess-demo.withlogin.com/api/login/callback"]
}
```

Do this after both domains have team-controlled DNS and TLS. No client secret is
used: authorization code with PKCE is required. Keep the ID stable to retain each
player's app-specific identity. Local `npm run dev:demo` still uses
`chess-app-local` and localhost HTTP URLs.

The server stores app-specific Login subject, optional verification flags, player
profile, chess sessions and game state. It does not store identity documents,
wallet keys, balances, payment details or identity-to-wallet mappings. Access logs
must not record raw URLs/query strings or cookies: callbacks contain auth codes.
Do not enable request-body/token logging or browser token-bearing recordings.

## Gold's custom-domain handoff

Add `chess-demo.withlogin.com` as a custom domain for this Railway service. Gold
must copy the **actual DNS CNAME/verification targets Railway provides** to the
DNS provider and wait for TLS issuance. No DNS record target is invented in this
repository. Login web stays at `demo.withlogin.com` on Vercel, with its API/OIDC
rewrites pointing at the shared Login Railway service.

In Railway’s service settings, remove the old custom build command containing
`npm ci`, or change it to `npm run build`. Keep the repository root as the service
root so Railway can find both `railway.json` and `nixpacks.toml`.

No service, DNS record or certificate is provisioned by these files. Hosting
access and Railway's assigned target are required to finish the public launch.

## Public smoke test after deployment

- Check `/api/health`, assets and the `/login` SPA route over HTTPS.
- Sign in through Login; consent should name Chess. Check callback returns to
  `https://chess-demo.withlogin.com/api/login/callback`, not a Railway hostname.
- Use two browsers/profiles to create/join a game, play legal moves, reconnect,
  offer/accept a draw and resign; verify WSS remains on the Chess origin.
- Confirm optional sandbox verification has an honest label. A player without
  KYC can still sign in and play.
- “Open Login” and “Send a private tip” open `https://demo.withlogin.com`, never
  localhost. Tip recipients share their receiving address outside Chess; enter
  it only in Login. No real funds. Smart-account integration remains pending its
  implemented interface and must not be presented as complete.
- Restart the Chess service and check stored game/profile/session continuity.

Local regression commands: `npm run test:server`, `npm run test:login`,
`npm run build`. The hosted-domain flow also needs this post-deployment check;
localhost tests alone cannot validate DNS/TLS or provider settings.
