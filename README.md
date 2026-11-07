# Login Chess — localhost hackathon demo

Playable chess integrated with Login's real OIDC/passkey sign-in. **Testnet / sandbox only; not production-ready.**

Implemented and browser-tested: two Login accounts, human-vs-human invite rooms, click/keyboard or drag moves, server-authoritative legality, checkmate, active-game resume/reload, saved online history, draw offers/acceptance, resignation endpoints, Stockfish games, optional verification display and cookie-only game sessions. Local computer games retain their existing browser storage.

The chess backend stores only a per-app Login identity, approved verification claims, a public chess nickname, game sessions, rooms and moves. It never stores wallet keys, balances, identity documents or identity-to-wallet mappings. OIDC tokens stay on the backend and are discarded after validation. Session cookies are HttpOnly and state-changing requests enforce same-origin JSON; WebSockets use the cookie, not bearer tokens in URLs.

## Prerequisites and installation

Use Node 22.13+ and npm. Place the repositories side by side:

```
projects/
  login-accounts/   # feat/passkeys with OIDC + KYC merged, plus chess-app-local registration
  chess-ui/        # feat/login-chess-demo
```

Install Login's dependencies using its documented setup. Then in chess-ui:

```sh
npm ci
npm --prefix server ci --ignore-scripts
npm --prefix server rebuild better-sqlite3 --ignore-scripts=false
```

The rebuild is explicit because better-sqlite3 needs its native binding and this repo otherwise disables dependency lifecycle scripts. The locked frontend dependency tree uses legacy peer resolution, recorded in `.npmrc`.

## Run

From chess-ui:

```sh
npm run dev:demo
```

Set `CHESS_LOGIN_DIR` if Login is elsewhere. The runner starts Login's API (127.0.0.1:8787), Login web (localhost:5180), chess API (127.0.0.1:3001) and chess web (localhost:5190). Do not run the previous OIDC demo client on 5190 at the same time. Forward 5180 and 5190 to matching localhost ports if working remotely.

Open http://localhost:5190. Choose **Continue with Login**. For a new test account, enter an example.com email and get the code from http://localhost:5180/dev/outbox in another tab. Create the passkey and consent to Login Chess. Give yourself a player name, create a friend game, and share its invite code. Use another browser profile for the second player. KYC is optional; without a passed level the UI says verification is not provided. Any positive result from this stack is explicitly labeled sandbox.

The companion Login change registers `chess-app-local` with the exact callback `http://localhost:5190/api/login/callback` in `apps/server/src/oidc/routes.ts`. The old `chess-local` example client remains separate.

## Private tips and account features

**Send a private tip** opens Login's existing Railgun send UI in a separate tab. Ask the recipient to share their private receiving address through a private channel, and enter it **only in Login**. Chess does not accept, transmit or record that address or the tip amount. The user reviews the transfer and confirms with a passkey in Login. No funds are escrowed or controlled by the chess server.

Deposit, cross-chain routing and withdrawal remain in Login's wallet UI. This demo has not verified a funded on-chain transfer: test balances, available testnet services and wallet-owner setup are required. No fake successful payment is shown. The smart-account edge component's implementation/interface is still pending confirmation; game publishing on Fluent is not presented as that component and automatic publishing has been removed from the active flow.

## Validation

With all servers running:

```sh
npm run build
npm run test:server
npm --prefix server run test:login
npm run test:login
```

The last command uses Playwright Chromium (install with `npx playwright install chromium`, or set `CHESS_CHROMIUM_EXECUTABLE` to a system Chromium). It creates synthetic accounts using virtual passkeys, plays a UI checkmate between two browser contexts, checks reload/resume, draw agreement, a Stockfish reply, optional KYC, session logout and Origin enforcement. It does not use real funds or documents. No browser traces or videos are captured.

Server baseline: 66 legacy/game checks pass; 3 additional Login security tests pass. Production build passes. Repository-wide ESLint still reports unrelated legacy/MCP issues; the generated Stockfish bundles are excluded and Node globals are scoped correctly. No assertions are disabled.

## Scope and limitations

This is localhost-only. Both OIDC client and provider reject public/non-local issuers; do not expose it publicly as a ready production service. The game server must be started with `LOGIN_ISSUER` to use the new cookie-auth mode (the runner does this); without it the original agent test mode remains for its existing API suite. Legacy human bridge and MCP endpoints are not mounted in Login mode. Existing MCP integrations need separate adaptation before being advertised as supported with Login identities.

The chess database stays at `server/chess.db` by default and is ignored by Git. Use `CHESS_DB_PATH` for an alternate location. Keep databases private and out of source control. No secrets are included. Production deployment, real KYC, financial escrow, new contracts and changes to key storage are outside this implementation.

Hosted Login demo setup: [Railway, domain and validation handoff](docs/hosted-login-demo.md). Unaudited; testnet only.
