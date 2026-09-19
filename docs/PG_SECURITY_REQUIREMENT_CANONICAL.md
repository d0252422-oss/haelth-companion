# PostgreSQL security requirement — canonical gate

Run `health-vendor-security-20260919-221146`; reviewed 2026-09-19.

The project does **not** require the string `17.11` for its own sake. The gate
requires official evidence that the hosted server contains the PostgreSQL core
security fixes below. PostgreSQL 17.11 is the first upstream PG17 release that
contains the complete required set, so it is the default verifiable floor. A
vendor build with another version label is acceptable only with an official,
build-specific patch attestation.

## A. Security fixes required by the hosted-server gate

The complete advisory detail, affected-version reasoning and conditional/client
classification is maintained in `PG17_6_TO_17_11_SECURITY_MATRIX.md`.

| CVE or fix | Fixed in PG17 | Severity / relevance | Required for gate | Official source |
|---|---:|---|---|---|
| CVE-2025-12817 | 17.7 | 3.1, core server | YES | https://www.postgresql.org/support/security/CVE-2025-12817/ |
| CVE-2026-2003 | 17.8 | 4.3, core server | YES | https://www.postgresql.org/support/security/CVE-2026-2003/ |
| CVE-2026-2006 | 17.8 | 8.8, core server | YES | https://www.postgresql.org/support/security/CVE-2026-2006/ |
| CVE-2026-6472 | 17.10 | 5.4, core server | YES | https://www.postgresql.org/support/security/CVE-2026-6472/ |
| CVE-2026-6473 | 17.10 | 8.8, core server | YES | https://www.postgresql.org/support/security/CVE-2026-6473/ |
| CVE-2026-6474 | 17.10 | 4.3, core server | YES | https://www.postgresql.org/support/security/CVE-2026-6474/ |
| CVE-2026-6479 | 17.10 | 7.5, core server | YES | https://www.postgresql.org/support/security/CVE-2026-6479/ |
| CVE-2026-14662 | 17.11 | 8.8, core server | YES | https://www.postgresql.org/support/security/CVE-2026-14662/ |
| CVE-2026-14664 | 17.11 | 8.8, core server | YES | https://www.postgresql.org/support/security/CVE-2026-14664/ |
| CVE-2026-14666 | 17.11 | 4.2, RLS cached-policy invalidation | YES, explicit project rationale | https://www.postgresql.org/support/security/CVE-2026-14666/ |
| CVE-2026-14668 | 17.11 | 8.1, core server | YES | https://www.postgresql.org/support/security/CVE-2026-14668/ |
| CVE-2026-14669 | 17.11 | 8.8, core server | YES | https://www.postgresql.org/support/security/CVE-2026-14669/ |
| CVE-2026-14679 | 17.11 | 8.2, core server | YES | https://www.postgresql.org/support/security/CVE-2026-14679/ |
| CVE-2026-14680 | 17.11 | 8.8, core server | YES | https://www.postgresql.org/support/security/CVE-2026-14680/ |
| CVE-2026-15741 | 17.11 | 8.8, core server | YES | https://www.postgresql.org/support/security/CVE-2026-15741/ |
| CVE-2026-16239 | 17.11 | 8.8, portal/cursor type confusion | YES, explicit project rationale | https://www.postgresql.org/support/security/CVE-2026-16239/ |
| CVE-2026-18024 | 17.11 | 4.3, core server | YES | https://www.postgresql.org/support/security/CVE-2026-18024/ |
| CVE-2026-6469 | 17.11 | 3.8, core server | YES | https://www.postgresql.org/support/security/CVE-2026-6469/ |
| CVE-2026-6470 | 17.11 | 4.3, core server | YES | https://www.postgresql.org/support/security/CVE-2026-6470/ |

Installed-extension and configuration-dependent fixes remain required when their
surface is present (for example pgcrypto); client/admin-only fixes are verified in
the separate toolchain inventory and do not prove or disprove the hosted server.

## B. Functional fixes that do not satisfy the security gate

- PostgreSQL 17.9's toasted-data regression repair and ordinary bug fixes.
- SQL/RLS/transaction functional parity between 17.6 and 17.11.
- Supabase extension updates that do not attest the PostgreSQL core fixes above.
- Passing CRUD, pool-isolation, Edge or browser tests.

These can establish compatibility but cannot establish that vulnerable core code
was replaced.

## C. Version-number preference only

The exact `17.11` label is a preference, not an independent requirement. The gate
may pass on a differently labelled managed build only when Supabase publishes an
official mapping from that exact deployed build to every required fix above.

## Build 17.6.1.166 decision

Official Supabase source tag `17.6.1.166` maps to commit
`af61232a627931d1da9d392993780cecb6a472de`. Its `nix/config.nix` pins the
PostgreSQL 17 input to upstream `17.6`; `ansible/vars.yml` assigns the packaged
label `17.6.1.166`. Supabase's official repository documentation describes this as
unmodified upstream PostgreSQL plus extensions. The generic packaging patches do
not provide an advisory-to-build backport mapping.

Sources:

- https://github.com/supabase/postgres/tree/17.6.1.166
- https://github.com/supabase/postgres/blob/17.6.1.166/nix/config.nix
- https://github.com/supabase/postgres/blob/17.6.1.166/ansible/vars.yml
- https://github.com/supabase/postgres/blob/develop/CLAUDE.md
- https://supabase.com/docs/guides/platform/upgrading

`OFFICIAL_BACKPORT_EVIDENCE=NOT_FOUND` and
`PG_SECURITY_PLATFORM_GATE=BLOCKED_VENDOR_SECURITY_EVIDENCE`. This is a security
evidence decision, not a claim that the managed host is exploitable.
