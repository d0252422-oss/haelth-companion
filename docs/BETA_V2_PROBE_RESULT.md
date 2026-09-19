# Beta v2 empty probe result

Run: `health-beta-probe-20260919-223821`.
Source HEAD: `c272cc117b93b45c6c3cae6fad359504e23fcd9a`.
Evidence: `D:/Dev/Evidence/health-beta-probe-20260919-223821/`.

The Owner explicitly authorized one Free empty probe even with an unknown
provisioning target. This supersedes the prior pre-creation target requirement;
it does not waive the PostgreSQL 17.11 security floor for cutover.

## Observed result

| Field | Fresh official result |
| --- | --- |
| Organization | `pcfenospezigjlgwcbtg`, Free |
| Creation quote | USD 0 / month; official get_cost and confirm_cost |
| Project | `health-companion-beta-v2` |
| Ref | `dsdfacbjaicdcwayhhil` |
| Region | `ap-southeast-1` |
| Status | `ACTIVE_HEALTHY` |
| Platform build | `17.6.1.166`, ga |
| SQL server_version | `17.6` |
| SQL server_version_num | `170006` |
| Public tables / migrations / Edge functions | 0 / 0 / 0 |
| Platform gate | `FAIL_VERSION_BELOW_SECURITY_BASELINE` |
| Project disposition | `EMPTY_PROBE_ONLY`, retained |

Exactly one create-project call succeeded. No application schema, roles, custom
secrets, migrations, functions, frontend, test identities or test data were added.
The SQL request only read server settings and current_database(). Platform-created
system schemas are not application migrations or synthetic test writes.

The new project's upgrade eligibility/latest_app_version/target_upgrade_versions
remain UNKNOWN: the connector has no eligibility method and no reusable CLI token
was found in the standard process/user environment or CLI token-file location.
Old-project eligibility is not substituted for the new project's metadata.
No credential was requested, printed or persisted.

## Preserved targets and next action

Old Beta `uavimjgccigpbwqmfkhh` was reread as ACTIVE_HEALTHY, build17.6.1.166.
Production exclusion `vptqedxdxfoohbqctujf` was identified from existing project
instructions and inventory; no database or mutation operation targeted it.
Read-only reference describes our treatment of old Beta, not a DB setting change.

The probe now occupies the second observed active Free project slot. Do not create
another probe, delete this probe, pause/restore it, or migrate/deploy to it under
this run. Ask Supabase for an official no-cost supported17.11+ target or a complete
required-fix backport attestation for build17.6.1.166. The prepared support question
includes both Beta refs and must be submitted by the Owner; it was not sent here.

`INTERNAL_MANUAL_BETA_READY=NO`; remote enablement remains conditional/not ready.
Prior accepted local and rollback gates remain unchanged. No full product tests
were rerun. Progress remains UNKNOWN overall and32.0% provisional known scope,
+0.0pp on `known-scope-v0.1-provisional-2026-09-12`.
