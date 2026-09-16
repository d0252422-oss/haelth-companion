# Dedicated A/B Beta login acceptance

REAL_AB_LOGIN=PENDING_OWNER. No cookies/tokens/passwords requested or extracted.
Existing Google/Apps Script verified-session bridge is the identity authority;
the SQL adapter maps verified subject+email hashes to canonical ID. It never assumes
auth.uid()==canonical ID. LINE linking is separate connector work, not a bypass.

After a reviewed deployment and credential approval:
1. Owner uses dedicated non-admin Test A in normal Beta login and completes consent
   if prompted. Do not paste session tokens.
2. In a separate browser context, dedicated Test B does the same.
3. User-scoped automated UI then creates clearly identified synthetic records, reloads
   and opens fresh contexts; checks A/B isolation, logout/revocation/expiry and cache.
4. Revoke/logout normally; remove only same-run positively identified synthetic rows
   within separately approved test-write/delete bounds.

MFA/CAPTCHA/consent are human boundaries. Current signed synthetic issuer tests are
local-only evidence, not real Google/LINE OAuth or hosted A/B PASS. No production
admin account, identity merge, OAuth scope change or credentials in source.
