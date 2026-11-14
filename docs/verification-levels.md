# Login verification levels in Chess

The player's account card, account dialog and desktop player summary display
`L1 possibly human` or `L2 verified human` from Login's authenticated result. Unverified
players see `Not verified`. A verified-human session without a disclosed level
shows `Verified human · Level not shared`; a boolean is never converted into an
invented level. Sandbox results retain the explicit sandbox notice.

Chess requests `openid kyc_level`. Login's existing Continue page explains that
Chess receives the verification status and level when available. The existing
Allow and continue button approves that disclosure. There is no added checkbox,
second approval screen or mandatory verification. Cancel still exits sign-in.
Apps requesting only openid keep their previous verified-human-only behavior.

The callback stores an exact level only when Login returns verified_human=true,
the token grants kyc_level, and the value is L1/L2/L3. A later sign-in overwrites
stale verification data, including clearing the level when no longer present.
The existing SQLite login_accounts table gains a nullable kyc_level column;
existing account IDs, names, sessions, clocks and games are preserved. No
identity documents, emails or wallet details are added to Chess.

## Deployment order

This release needs both repositories:

1. Merge/deploy Login's `feat/oidc-verification-level` change to its API and
   frontend. This adds the optional scope, disclosure on the existing Continue page and accurate
   connected-app permission text.
2. Merge/deploy Chess's `fix/chess-verification-level` change to the Chess API
   and frontend, preserving the persistent Chess database.
3. In an existing Chess account, use **Refresh verification**, or sign out and
   Continue with Login again. Old openid-only grants require the existing Continue
   page once to approve the added level scope. Merely reloading an old Chess
   session does not fetch a new assertion from Login.
4. Test an unverified player and sandbox L1/L2 players. Confirm the badge, the
   sandbox notice, stable Chess account/name, and optional access without KYC.

No environment variables or dependency versions change. Existing game and clock
code is untouched. Do not bypass missing claims by hard-coding a badge or editing
user data. Live hosting has not been changed or verified by this patch.

## Validation

Use Node 22 and installed dependencies:

```
npm run build
npm run test:verification
npm run test:verification-ui
npm run test:dashboard
npm run test:verification:integration
```

The UI scripts need the local Chess frontend on localhost:5190 and Chromium;
Linux can set CHESS_CHROMIUM_EXECUTABLE=/usr/bin/chromium. The integration script
also needs the Login checkout beside chess-ui (or CHESS_LOGIN_DIR pointing to it)
and its existing dependencies. It starts isolated local HTTP servers, uses the
real provider/code exchange/userinfo/Chess callback, and stores only synthetic
accounts and KYC results in memory. It checks unverified sign-in, L1/L2, stable
account IDs, one Continue screen, sandbox markers and clearing a removed result.
It does not use a real identity document, passkey, wallet, token or uploaded DB.
