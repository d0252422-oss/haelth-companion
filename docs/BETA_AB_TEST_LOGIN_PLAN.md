# Dedicated Beta A/B login plan

Continuation runbook: BETA_AB_OAUTH_RUNBOOK.md. No accounts/session credentials
were obtained or created in the background-worker continuation.

REAL_AB_LOGIN=PENDING_OWNER_INTERACTION; synthetic ES256 authority is not Google OAuth.
Existing Beta path: Google session → Apps Script verification bridge → verified
subject/email hash pair → pre-existing Beta canonical alias. LINE/LIFF remains the
legacy auth integration and has not been accepted for this manual SQL mapping; do
not silently reinterpret its session as Google or Supabase Auth JWT.

Owner's minimal steps after technical gates pass:

1. Designate two dedicated non-admin Beta accounts A/B, no real health history used.
2. Use the existing Beta login UI and complete any required Google consent/MFA in
   separate sessions. Do not share password, cookies, bearer tokens or email in source.
3. Allow user-scoped smoke only under the exact later authorization manifest. Re-login
   in a fresh browser context to prove persisted SQL data; B must not see A.

Every request re-verifies the existing session; expiry/revocation is determined by
that authority, not the local fixture's 30-minute expiry. Real configured lifetime is
UNKNOWN until authorized login/authority acceptance. Logout/revocation must be checked
against the bridge (not only clearing browser cache). Missing/conflicting mappings
fail closed; this run does not create aliases, merge accounts or backfill identities.
