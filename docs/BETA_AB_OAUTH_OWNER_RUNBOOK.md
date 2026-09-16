# Owner A/B OAuth — READY_FOR_OWNER, execution deferred

REAL_AB_LOGIN=READY_FOR_OWNER_RUNBOOK; ACTUAL_LOGIN=NOT_RUN.
Use only the verified Beta entry https://d0252422-oss.github.io/health-companion-beta/
after technical gates and the separate test-write authorization are ready. Existing
Google/Apps Script verified-session authority remains; not a synthetic test issuer.

1. In one normal browser context, sign in as dedicated non-admin Test UserA and
   complete OAuth consent/MFA if prompted.
2. In a separate browser context/profile, sign in as dedicated non-admin Test UserB
   and complete required consent/MFA.
3. Leave those Beta contexts available for the authorized user-scoped test run.
   Never paste passwords, tokens or cookies into chat; do not export browser storage.
4. After verification, log out/revoke each test session normally.

System: use normal application requests (no credential extraction) to check unique
server-resolved canonical IDs, A cannot read/writeB, B cannot read/writeA, anonymous/
expired/revoked denied, reload/newcontext persistence and user/environment cache
isolation. Store sanitized result/record IDs, not bearer headers. Logout/revoke
must invalidate the application session per its contract; do not equate deleting
an account with revoking a token. Stop for mapping conflict; never auto-merge users.

OAuth consent/CAPTCHA/MFA are human boundaries. If identities do not exist, choose
dedicated accounts through the normal owner flow, never production admin. This
runbook proves neither successful OAuth nor remote SQL/RLS. No phone is required.
