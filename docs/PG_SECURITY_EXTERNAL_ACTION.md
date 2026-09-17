# PostgreSQL external action — minimal owner/vendor package

CURRENT_BLOCKER=17.6.1.166 lacks official CVE/backport mapping.
EXACT_EVIDENCE_NEEDED=offered managed target PG17.11+ or build-specific attestation
covering the required upstream17.7–17.11 fixes, including16239 and14666.
WHERE_TO_GET_IT=Beta Dashboard upgrade eligibility/target and Supabase Support.

OWNER_ACTION:
1. Open project uavimjgccigpbwqmfkhh Settings > Infrastructure/General upgrade UI.
2. Record, but do not confirm, offered target version, warnings, downtime estimate
   and backup readiness. Do not paste credentials or screenshots containing secrets.
3. If target is17.11+, authorize a separate Beta-only maintenance window after the
   warnings are reviewed. Otherwise send the vendor question below.

VENDOR_ACTION_IF_NEEDED: confirm build166 patch coverage or the earliest supported
managed target containing the fixes. SAFE_ALTERNATIVE=managed Free pause/restore only
after target confirmation; no self-hosted image substitution. NEXT_GATE=fresh build/
extension metadata plus impacted RLS, Edge and pool acceptance after upgrade.

## Support question template — do not send automatically

Project ref uavimjgccigpbwqmfkhh reports PostgreSQL17.6 and platform build
17.6.1.166. Please confirm whether this exact managed build backports the PostgreSQL
security fixes released in17.7 through17.11, particularly CVE-2026-16239 and
CVE-2026-14666, and provide an official build/patch reference. If it does not,
which supported managed upgrade for this Free project reaches PostgreSQL17.11 or an
officially equivalent patched build, what target will the Dashboard choose, what
downtime/preconditions apply, and what recovery path exists if the upgrade fails?
