# Fresh Login authentication when entering Chess

Continue with Login now requires a fresh Login passkey check, including when
Login already remembers a signed-in account. The button explicitly uses the
existing fresh=1 route, and the Chess start endpoint always sends OIDC
prompt=login so old entry links cannot silently reuse Login's session either.
This uses Login's existing tested fresh-authentication flow; no Login-provider,
WebAuthn, email-authentication, wallet, key or passkey-domain code changes.

After successful authentication, the callback resolves the account using Login's
issuer and stable per-app subject, as before. It reopens the existing Chess
account, edited player name, games and verification result. Different Login
accounts remain separate. Email stays inside Login; Chess neither requests nor
stores it. The profile caption now identifies the displayed name as a Chess
player name, rather than suggesting the generated nickname is a new Login
account.

A remembered Chess session still stays signed in on reload; a new passkey is
required when explicitly entering through Continue with Login. Cancellation or
an old authentication cannot complete that fresh flow. L1/L2 still comes only
from Login's granted, authenticated verification result. Sandbox labels remain.

This ships passkey authentication. Login's existing email/code path can enroll
new accounts and then create their passkey. For existing accounts, an email
code alone does not authenticate an OIDC sign-in; Login directs them to their
existing passkey. No email-only fallback or account-recovery mechanism is added.

## Deployment

This patch follows the merged Chess verification change (PR #13). Apply it to a
new branch from current main and open a new Chess PR. Deploy the Chess API and
frontend together after review. No additional Login change is required for this
fresh-passkey flow. Login PR #14 is still the companion requirement for exact
verification-level sharing if not already deployed. Preserve the current Login
RP/origin settings and persistent Chess database.

## Validation

- Chess production build and lint on changed application code.
- Existing verification/session unit tests and the actual Login-to-Chess OIDC
  integration, with its synthetic authentication adapter updated for a fresh
  check. Real authentication is separately exercised below.
- Existing onboarding layout, touch-target, loading and recovery checks.
- `scripts/test-passkey-handoff.mjs`: real desktop and mobile Chromium with
  synthetic email accounts and virtual passkeys, against isolated local Login
  and Chess services. It checks signup, a remembered Login session that cannot
  enter Chess without a new passkey check, premature-completion rejection,
  cancellation, stable player name/account, distinct users, private email, and
  L1/L2 after fresh sign-in.

The browser test intentionally requires CHESS_TEST_LOGIN_DB to point to a
synthetic Login database named login.sqlite in an OS temporary directory whose
name starts chess-passkey-validation-. It injects only synthetic KYC outcomes
there, not real verification documents or a production database. Start isolated
Login API/web on 8787/5180 and Chess API/web on 3001/5190 with this test database,
then set CHESS_TEST_LOGIN_DB and run npm run test:passkey-handoff. On Linux set
CHESS_CHROMIUM_EXECUTABLE=/usr/bin/chromium. Use Node 22. There are no new
dependencies or production environment variables.
