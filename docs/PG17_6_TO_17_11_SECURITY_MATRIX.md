# PostgreSQL 17.6 through 17.11 security matrix

Run health-security-20260917-075734; reviewed 2026-09-17. Official PostgreSQL
advisories determine upstream affected versions, NOT a vendor build's applied patches.

PG_SECURITY_PLATFORM_GATE=BLOCKED_INSUFFICIENT_OFFICIAL_EVIDENCE.
SUPABASE_BACKPORT_EVIDENCE=NOT_FOUND_IN_OFFICIAL_SOURCES (bounded review, not proof of absence).
REMOTE_PATCH_STATUS=UNKNOWN. Functional tests cannot establish security equivalence.

## Release mapping

| Release | Date | Interpretation |
|---|---|---|
| [17.7](https://www.postgresql.org/docs/17/release-17-7.html) | 2025-11-13 | 12817/12818 security fixes |
| [17.8](https://www.postgresql.org/docs/17/release-17-8.html) | 2026-02-12 | 2003–2006 security fixes |
| [17.9](https://www.postgresql.org/docs/17/release-17-9.html) | 2026-02-26 | substring/toasted-data regression after 2006 fix; NOT an additional CVE |
| [17.10](https://www.postgresql.org/docs/17/release-17-10.html) | 2026-05-14 | May fixes below |
| [17.11](https://www.postgresql.org/docs/17/release-17-11.html) | 2026-08-13 | August fixes below; references to older advisories are not new fixes |

## Advisory-level mapping

CVSS is the official 3.0 score (not a project exploitability rating). Fixed-in is from
the advisory version table. YES means stock upstream17.6 is affected, not a finding
against the deployed Supabase binary. No CVE has proven vendor166 backport mapping.
BACKPORTABLE=NOT_ASSESSED for each item; vendor applicability requires reviewed patch
and build provenance, not just technical possibility. BACKPORT_EVIDENCE=NONE_FOUND
for every row. Client-only fixes require client inventory, not a server label change.

| Official advisory | Fixed PG17 | CVSS | Component | Stock17.6 affected | Project relevance |
|---|---|---|---|---|---|
| [CVE-2025-8714](https://www.postgresql.org/support/security/CVE-2025-8714/) | 17.6 | 8.8 | core server | NO | Already fixed in17.6; reference only |
| [CVE-2025-12817](https://www.postgresql.org/support/security/CVE-2025-12817/) | 17.7 | 3.1 | core server | YES | CORE: relevant platform assurance; app exploit path not demonstrated |
| [CVE-2025-12818](https://www.postgresql.org/support/security/CVE-2025-12818/) | 17.7 | 5.9 | core server | YES | CLIENT/ADMIN: separate patched client inventory required |
| [CVE-2026-2003](https://www.postgresql.org/support/security/CVE-2026-2003/) | 17.8 | 4.3 | core server | YES | CORE: relevant platform assurance; app exploit path not demonstrated |
| [CVE-2026-2004](https://www.postgresql.org/support/security/CVE-2026-2004/) | 17.8 | 8.8 | contrib module | YES | CONDITIONAL: intarray absent in extension snapshot |
| [CVE-2026-2005](https://www.postgresql.org/support/security/CVE-2026-2005/) | 17.8 | 8.8 | contrib module | YES | CONDITIONAL: pgcrypto installed; vulnerable decryption path not demonstrated |
| [CVE-2026-2006](https://www.postgresql.org/support/security/CVE-2026-2006/) | 17.8 | 8.8 | core server | YES | CORE: relevant platform assurance; app exploit path not demonstrated |
| [CVE-2026-6472](https://www.postgresql.org/support/security/CVE-2026-6472/) | 17.10 | 5.4 | core server | YES | CORE: relevant platform assurance; app exploit path not demonstrated |
| [CVE-2026-6473](https://www.postgresql.org/support/security/CVE-2026-6473/) | 17.10 | 8.8 | core server | YES | CORE: relevant platform assurance; app exploit path not demonstrated |
| [CVE-2026-6474](https://www.postgresql.org/support/security/CVE-2026-6474/) | 17.10 | 4.3 | core server | YES | CORE: relevant platform assurance; app exploit path not demonstrated |
| [CVE-2026-6475](https://www.postgresql.org/support/security/CVE-2026-6475/) | 17.10 | 8.8 | client | YES | CLIENT/ADMIN: separate patched client inventory required |
| [CVE-2026-6476](https://www.postgresql.org/support/security/CVE-2026-6476/) | 17.10 | 7.2 | client | YES | ADMIN_TOOL: pg_createsubscriber; not ordinary CRUD |
| [CVE-2026-6477](https://www.postgresql.org/support/security/CVE-2026-6477/) | 17.10 | 8.8 | client | YES | CLIENT/ADMIN: separate patched client inventory required |
| [CVE-2026-6478](https://www.postgresql.org/support/security/CVE-2026-6478/) | 17.10 | 6.5 | core server | YES | CONDITIONAL: MD5 credentials; SCRAM unaffected |
| [CVE-2026-6479](https://www.postgresql.org/support/security/CVE-2026-6479/) | 17.10 | 7.5 | core server | YES | CORE: relevant platform assurance; app exploit path not demonstrated |
| [CVE-2026-6637](https://www.postgresql.org/support/security/CVE-2026-6637/) | 17.10 | 8.8 | contrib module | YES | CONDITIONAL: refint absent |
| [CVE-2026-6638](https://www.postgresql.org/support/security/CVE-2026-6638/) | 17.10 | 3.7 | core server | YES | CONDITIONAL: logical subscription refresh |
| [CVE-2026-14662](https://www.postgresql.org/support/security/CVE-2026-14662/) | 17.11 | 8.8 | core server | YES | CORE: relevant platform assurance; app exploit path not demonstrated |
| [CVE-2026-14663](https://www.postgresql.org/support/security/CVE-2026-14663/) | 17.11 | 6.5 | contrib module | YES | CONDITIONAL: pgcrypto installed; PGP cipher/OpenSSL configuration dependent |
| [CVE-2026-14664](https://www.postgresql.org/support/security/CVE-2026-14664/) | 17.11 | 8.8 | core server | YES | CORE: relevant platform assurance; app exploit path not demonstrated |
| [CVE-2026-14666](https://www.postgresql.org/support/security/CVE-2026-14666/) | 17.11 | 4.2 | core server | YES | REQUIRED: role-change RLS plan invalidation; pooled-policy relevance, exploitability not asserted |
| [CVE-2026-14668](https://www.postgresql.org/support/security/CVE-2026-14668/) | 17.11 | 8.1 | core server | YES | CORE: relevant platform assurance; app exploit path not demonstrated |
| [CVE-2026-14669](https://www.postgresql.org/support/security/CVE-2026-14669/) | 17.11 | 8.8 | core server | YES | CORE: relevant platform assurance; app exploit path not demonstrated |
| [CVE-2026-14670](https://www.postgresql.org/support/security/CVE-2026-14670/) | 17.11 | 8.8 | core server | YES | CONDITIONAL: plperl absent |
| [CVE-2026-14671](https://www.postgresql.org/support/security/CVE-2026-14671/) | 17.11 | 8.8 | contrib module | YES | CONDITIONAL: refint absent |
| [CVE-2026-14672](https://www.postgresql.org/support/security/CVE-2026-14672/) | 17.11 | 5.3 | core server | YES | CONDITIONAL: nondefault SCRAM iterations |
| [CVE-2026-14677](https://www.postgresql.org/support/security/CVE-2026-14677/) | 17.11 | 8.8 | core server | YES | NOT_THIS_BUILD: 32-bit only; remote is x86_64 |
| [CVE-2026-14678](https://www.postgresql.org/support/security/CVE-2026-14678/) | 17.11 | 4.3 | contrib module | YES | CONDITIONAL: pg_trgm absent |
| [CVE-2026-14679](https://www.postgresql.org/support/security/CVE-2026-14679/) | 17.11 | 8.2 | core server | YES | CORE: relevant platform assurance; app exploit path not demonstrated |
| [CVE-2026-14680](https://www.postgresql.org/support/security/CVE-2026-14680/) | 17.11 | 8.8 | core server | YES | CORE: relevant platform assurance; app exploit path not demonstrated |
| [CVE-2026-14681](https://www.postgresql.org/support/security/CVE-2026-14681/) | 17.11 | 4.2 | core server | YES | CONDITIONAL: combined GSS/TLS policy; not demonstrated |
| [CVE-2026-15741](https://www.postgresql.org/support/security/CVE-2026-15741/) | 17.11 | 8.8 | core server | YES | CORE: relevant platform assurance; app exploit path not demonstrated |
| [CVE-2026-15742](https://www.postgresql.org/support/security/CVE-2026-15742/) | 17.11 | 8.8 | contrib module | YES | CONDITIONAL: fuzzystrmatch absent |
| [CVE-2026-16239](https://www.postgresql.org/support/security/CVE-2026-16239/) | 17.11 | 8.8 | core server | YES | REQUIRED: cursor/portal; original floor rationale |
| [CVE-2026-16241](https://www.postgresql.org/support/security/CVE-2026-16241/) | 17.11 | 3.8 | client | YES | CLIENT/ADMIN: separate patched client inventory required |
| [CVE-2026-18024](https://www.postgresql.org/support/security/CVE-2026-18024/) | 17.11 | 4.3 | core server | YES | CORE: relevant platform assurance; app exploit path not demonstrated |
| [CVE-2026-18408](https://www.postgresql.org/support/security/CVE-2026-18408/) | 17.11 | 8.8 | client | YES | CLIENT/ADMIN: separate patched client inventory required |
| [CVE-2026-19385](https://www.postgresql.org/support/security/CVE-2026-19385/) | 17.11 | 8.8 | client | YES | CLIENT/ADMIN: separate patched client inventory required |
| [CVE-2026-6464](https://www.postgresql.org/support/security/CVE-2026-6464/) | 17.11 | 8.1 | client | YES | CLIENT/ADMIN: separate patched client inventory required |
| [CVE-2026-6469](https://www.postgresql.org/support/security/CVE-2026-6469/) | 17.11 | 3.8 | core server | YES | CORE: relevant platform assurance; app exploit path not demonstrated |
| [CVE-2026-6470](https://www.postgresql.org/support/security/CVE-2026-6470/) | 17.11 | 4.3 | core server | YES | CORE: relevant platform assurance; app exploit path not demonstrated |
| [CVE-2026-6471](https://www.postgresql.org/support/security/CVE-2026-6471/) | 17.11 | 7.2 | core server | YES | CONDITIONAL: replication grant; forbidden on app runtime |
| [CVE-2026-14673](https://www.postgresql.org/support/security/CVE-2026-14673/) | PG17 unaffected | 3.8 | contrib module | NO | NOT_PG17 |
| [CVE-2026-14676](https://www.postgresql.org/support/security/CVE-2026-14676/) | PG17 unaffected | 8.8 | contrib module | NO | NOT_PG17 |
| [CVE-2026-16238](https://www.postgresql.org/support/security/CVE-2026-16238/) | PG17 unaffected | 8.8 | core server | NO | NOT_PG17 |

## Vendor evidence and decision

Fresh metadata: server17.6/170006, platform17.6.1.166, x86_64 GCC15.2.0.
Extension version numbers do not identify their security patch content.
Reviewed [vendor166 source](https://github.com/supabase/postgres/tree/17.6.1.166),
its nix/postgresql/generic.nix and postgres-config version mapping (prior immutable
source snapshots preserved), official changelog and documentation search. Packaging
patches and a newer vendor suffix are not an attestation of the CVEs above. No
complete deployed-binary-to-security-commit mapping was found. Neither fully patched
nor definitely unpatched is established for this managed instance.

To close: obtain official build-specific coverage for required core/RLS fixes and
relevant installed extensions/client tools, OR identify a supported upgraded build
with that provenance. Do not downgrade the security requirement or use CRUD parity
as proof. No exploit probe was run against Beta.

Raw official pages, per-source SHA256, release extraction and remote identity are in
D:/Dev/Evidence/health-security-20260917-075734/. Prior vendor-source hashes are in
D:/Dev/Evidence/health-critical-20260917-065444/official-sources.json.
