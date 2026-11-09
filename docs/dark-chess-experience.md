# Dark Chess dashboard and gameplay

The signed-in Chess UI now uses the approved black theme, white text, bright accents and rounded surfaces with highlighted borders. The existing green field and wooden knight stay in the dashboard hero. The public welcome page and Login service are separate and keep their existing design and authentication flows.

On phones the header contains the Chess wordmark and Account only, without a divider or a second heading row. Log out is a working red button below the account panel. Desktop keeps its navigation and header controls. Verification, account, friend and computer icons follow the supplied references.

Opening an online room or local Stockfish game switches to the focused board layout: green-and-cream squares, readable pieces, coordinates, real player names and turn indicators, a game menu, and a Login wallet link. The game menu provides Back to Games, My account and Log out. Account opens in a keyboard-accessible dialog; Escape closes it and returns focus to the menu button. Local Black games now orient the board with Black at the bottom, matching online Black games.

## Clock and wallet behaviour

The original release left games untimed. New games now use the server-authoritative 10+0 clocks documented in [Onboarding, loading and clocks](onboarding-loading-clocks.md). Previously saved games remain untimed. The clock panels use real server snapshots; no browser timer awards a result.

The wallet button opens the signed-in account's configured Login origin. Chess does not request or display wallet balances, keys, receiving addresses or identity documents. No mock balance or sample player is shipped. Verification remains optional. Sandbox verification and unaudited/testnet labels remain visible.

## Validation

Use Node 22.13 or newer in the Node 22 release line, as required by the repository. With dependencies installed:

```sh
npm run build
npm run test:landing
npm run test:dashboard
npm run test:login
```

The browser checks require Vite on `http://localhost:5190` and Chromium/Playwright. The real Login integration check also requires the local Login web/API and Chess API. On Linux with a system browser, set `CHESS_CHROMIUM_EXECUTABLE=/usr/bin/chromium`. `test:dashboard` uses synthetic API data at desktop, mobile, small-phone, tablet and landscape sizes. It covers the new header, responsive boards and coordinates, menu/dialog keyboard focus, profile editing, save/resume/filter/delete, failed-list recovery, local moves and logout failure/retry. `test:login` exercises real local virtual passkeys and cookie sessions, two-player mouse/touch/keyboard moves, drag prevention, checkmate/reload, draw/resign controls, promotion, Stockfish, local play in both colours and game-menu logout.

For this change validation used temporary synthetic databases and local outbox mail, with no `.env` files loaded, real identity documents or funds.

## Deployment

Merge the feature PR into `main`, then deploy that merged commit to the production frontend serving `onchainchess.app`. Rebuild the frontend; a backend-only restart does not publish these UI assets. No Railway variables, API routes, OIDC clients, DNS records or dependencies change. The font is self-hosted under `public/fonts/`; keep its bundled license when deploying.

Design refinement used [Unslop by Damir Sokolovsky](https://github.com/heydamir/unslop), CC BY 4.0, adapted to the existing Chess brand and the user's visual references. DM Sans is distributed under the SIL Open Font License in `public/fonts/OFL-DM-Sans.txt`.
