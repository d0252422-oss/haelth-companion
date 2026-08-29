# Isolated Supabase Beta runtime

Status: deployed for closed non-production testing on 2026-08-29.

- Organization plan verified by the Management API: `free`.
- Project: `health-companion-beta`.
- Beta ref: `uavimjgccigpbwqmfkhh` (`ap-southeast-1`).
- Production ref used only by the fail-closed guard: `vptqedxdxfoohbqctujf`.
- HTTPS base: `https://uavimjgccigpbwqmfkhh.supabase.co/functions/v1/mobile-health-beta`.
- Cost at creation: `$0`; no paid add-on, custom domain, or larger compute was selected.

Every database or function command must first run `scripts/assert-beta-supabase-target.ps1` with the intended target, Beta ref, and production ref. A mismatch aborts before any Supabase mutation. The isolated worktree is linked only to the Beta ref; `supabase/.temp` remains untracked.

The Edge Function validates the existing authenticated Web session for claim issuance. A setup code is random, five-minute, Beta-scoped and single-use. Android exchanges it only after an ECDSA P-256 proof from its Android Keystore installation key. App access and refresh credentials are stored only as SHA-256 digests in the private schema. The gateway JWT check is disabled because these routes use custom credentials; each sensitive route performs its own fail-closed web-session or app-session verification.

The Beta schema is intentionally minimal: canonical identity mapping, private claim/session registries, source-version reconciliation, tombstone/invalidation events, closed-beta HDL v2 records, and connector status. All tables have RLS enabled; `anon` and `authenticated` have no table writes; the public RPC surface is executable only by `service_role`. No production schema or data was cloned.

Verification evidence:

- Edge health check returned `environment=beta`.
- Missing claim authorization returned HTTP 401 `AUTH_REQUIRED`.
- Transactional remote SQL test passed create, session authorization, claim replay rejection, record create/replay/update/stale rejection/delete tombstone, and cross-user isolation; it rolled back.
- Supabase Security Advisor returned no warning/error findings.
- Full repository regression after the runtime change: 121/121 pass.

Known boundaries:

- The deployed GitHub Pages site still uses `main`; this feature branch does not deploy or modify production Pages. The Web/LINE Beta CTA becomes live only through a separately approved non-production frontend publication path.
- The Beta canonical records are not yet connected to the frozen production Apps Script score persistence. Real device ingestion can be tested without claiming score visibility.
- iOS Shortcut distribution still requires a real iPhone-created iCloud share link and Phase 4B evidence.
