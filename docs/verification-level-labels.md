# Verification level display

Chess uses the authenticated Login level; it never guesses a level from the
verified-human boolean:

| Login result | Chess label |
| --- | --- |
| L2 and verified_human=true | L2 verified human |
| L1 and verified_human=true | L1 possibly human |
| No verified_human assertion | Not verified |

An existing verified-human session with no exact level retains the diagnostic
label `Verified human · Level not shared`. Unknown values are not promoted to L1
or L2. Sandbox results continue to carry the sandbox notice.

## Release dependency

At the time of this repair, Chess PR #14 (fresh passkey handoff) was merged,
but Login PR #14 (verification-level sharing) was still open in the separate
Login repository. Login main advertised openid only, so it could send the human
flag but not the separately granted kyc_level. The Login PR's conflict with the
new styled Continue page has been resolved while preserving Gold's design and
the existing single Continue action; the PR still needs teammate review/merge.

1. Review/merge https://github.com/dexlabs-xyz/login-accounts/pull/14 and deploy
   the Login API and frontend containing that merged change.
2. Merge this small Chess wording change and deploy the Chess frontend.
3. In Chess, open Account and use Refresh verification. Complete the existing
   Login passkey/Continue flow to replace an old human-only Chess snapshot with
   the current granted level. New sign-ins then obtain it normally.

Reloading an old Chess session alone reads its stored status; it does not obtain
new claims from Login. No extra consent page, checkbox, email sharing or new
production configuration is introduced by this wording update. The backend
handoff remains the previously approved optional kyc_level scope, disclosed by
Login's existing Continue page. Never change a missing-level badge to a guessed
verification level to conceal an incomplete provider deployment.

Validation uses synthetic unverified, L1/L2 and unknown-level outcomes, mocked
browser profiles, the real local OIDC callback and real desktop/mobile virtual
passkeys against temporary local databases. No real identity documents, accounts,
credentials or uploaded databases are used.
