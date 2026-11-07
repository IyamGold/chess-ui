# Login Chess integration boundary

Status: working local OIDC chess integration; not a production deployment or a claim that all six components are complete.

## Approved design

The user selected private tips (not game stakes or escrow) and approved openid-client plus a chess-backend data boundary limited to per-app identity, approved verification claims, chess profiles, game sessions and games.

The backend validates OIDC Authorization Code + PKCE with openid-client, including issuer/audience/nonce/state/signature/expiry and UserInfo subject. It discards provider tokens after use. SQLite holds hashed chess session IDs; browsers receive HttpOnly cookies. No Login passkey implementation is copied into chess. The app-scoped subject is never used as an Ethereum address.

Chess's local HTTP session and Login's local cookies use different names. Because both localhost apps share a hostname during development, browser cookies can arrive on both ports; chess reads only its own cookie names and never logs request headers. A public deployment needs separate HTTPS origin/cookie configuration and a review; the current OIDC provider and relying party intentionally refuse public issuers.

## What works now

- Real Login/passkey signup and sign-in, including a passkey without wallet support.
- Optional KYC claims through the merged KYC adapter. Absence is "not provided"; sandbox approval is labeled. Chess doesn't fetch documents or KYC-provider identifiers.
- Human-vs-human invitations, legal move validation on the server, checkmate, active-game reload/resume, finished history, draw offers and resignation.
- Local and server Stockfish modes; keyboard/click targets for the online board.
- Same-origin JSON checks for state-changing chess API requests, browser-bound OIDC state, cookie-only game sessions and WebSocket Origin checks.
- A manual private-tip handoff: sender opens Login, enters a recipient address shared outside chess and reviews/confirms there. The chess server never sees tip recipients, amounts or balances. No escrow contract or new custody path is introduced.
- Login's existing deposit/withdrawal UI remains the place to exercise universal cross-chain routing. The chess app links to it; it does not duplicate quote validation or transaction signing.

## Evidence

- Frontend production build passes.
- The existing server suite passes 66 checks; its outdated unauthenticated bridge expectations were replaced with checks that missing credential proof is rejected.
- Three new Login security tests cover an invented callback, cookie-only sessions, expiry and refusing non-local providers.
- The real-browser integration test creates two synthetic Login accounts with virtual passkeys, plays a complete checkmate by clicking the board, reloads an active and finished game, tests draw agreement, gets a Stockfish reply, rejects a cross-origin mutation and verifies logout.
- Original root lockfile entries were preserved; only Playwright's three test packages were added. openid-client is installed only in the chess server's devDependencies for this localhost phase.

## Remaining gaps

- No funded on-chain tip, deposit or withdrawal was executed during this task. Those require test balances and the wallet team's configured testnet services. The UI never fabricates a payment receipt.
- KYC claim handling uses the real merged callback, but a live Sumsub sandbox verification was not performed by the chess test. Use only synthetic sandbox results and no real documents.
- Smart-account edge code/interface is still awaiting confirmation from its owner. The prior Fluent ChessLedger publishes game records and is not a Login smart account. Automatic Fluent publishing and old wallet providers are removed from the active frontend.
- The original MCP integration remains outside the Login-enabled chess route set; agent delegation needs separate reviewed adaptation.
- Global lint still finds legacy/MCP issues. Generated Stockfish is correctly ignored, and Node globals are scoped to Node files. Runtime builds and game/auth checks are passing; no assertions were disabled.

The companion Login change is only a localhost OIDC client registration in `apps/server/src/oidc/routes.ts`, with callback `http://localhost:5190/api/login/callback`. Both repositories use feature branches. Nothing was deployed or pushed to main.
