# Beta rollback master

ROLLBACK = CODE/CONFIG ONLY. DATA = PRESERVE_VALID_SQL_ROWS.

- Old Edge: prior official export matches a69cb3322f0cfc09a9d2c720e85aff92ec84bcfb.
  Reuse the accepted provenance and manifest; no repeated export/hash hunt. Exact
  argument template is in the target-specific cutover package. Before a future
  deploy recheck artifact/tool availability and target/config identity.
- New empty probe: no previous Edge version. First deployment failure stops the
  Web switch and preserves database/config evidence. Do not deploy old-target config
  into the new project and call that rollback.
- Web: prior source53736e644aaa79163d521daa44c7e87c82ad3126 is a source recovery point,
  not a verified current live deployment artifact. Snapshot the actual Beta assets,
  config and deployment revision before future publication. Restore via additive
  Beta commit/authorized normal push, never force-push/history reset.
- Config: restore only recorded environment-specific names/versions through the
  approved secure channel. Secret values do not belong in this document or package.
  Do not replace least-privilege credentials with service_role on failure.
- SQL-first failure: keep prior Beta entry unchanged/provider disabled. Restoring
  code must not activate hidden Sheets writes or overwrite new SQL rows.

Post-rollback smoke must show exact target, health/auth contract, expected provider,
read-only profile/domain routes and denial behavior; status200 alone is insufficient.
No SQL down migrations, DROP, TRUNCATE, mass DELETE, history downgrade or user-row
rewind. Synthetic cleanup is a separate bounded operation, never rollback.

MASTER_DOCUMENT = READY; OLD_EDGE_PROVENANCE = PRIOR_PASS;
LIVE_WEB_ROLLBACK = PARTIAL_NOT_REHEARSED; REMOTE_ROLLBACK_THIS_RUN = NOT_RUN.
