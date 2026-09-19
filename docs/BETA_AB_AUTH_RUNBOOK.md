# Beta A/B auth — future owner steps only

Prerequisites: safe hosted target, validated SQL-first Beta entry/config, dedicated
non-admin test accounts and operation-specific write authorization. Do not begin now.

1. Test A signs in normally at the verified Beta entry in a separate browser context.
2. Test B signs in normally in another context; complete consent/MFA if required.
3. Keep both contexts open; do not provide passwords, tokens, cookies or storage exports.
4. Run the authorized A/B verification through normal sessions, then log out/revoke normally.

System checks canonical IDs differ, A/B owned reads, foreign reads/modifications
denied, anonymous/forged identity denied, persistence and environment/cache isolation.
The read-only smoke adapter and static E2E driver do not establish full isolation.
No account merge, synthetic auth issuer or production admin shortcut is allowed.
See BETA_AB_OAUTH_OWNER_RUNBOOK.md for existing session/revocation contract.
STATUS = READY_RUNBOOK; REAL_AB_LOGIN = DEFERRED_NOT_RUN.
