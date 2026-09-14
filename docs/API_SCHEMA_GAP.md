# API schema gap

SCHEMATHESIS = PREPARED_BLOCKED_NO_CANONICAL_SCHEMA (nonblocking).

Contracts currently live in `supabase/functions/mobile-health-beta/local-engine-runtime.ts` handler routing, the manual-* modules, `scripts/local-engine-web.js` hostedManualActions allowlist and API/UI contract tests. These are not a canonical OpenAPI document. The action-oriented request envelope, verified-session mapping, error/revision/idempotency responses and domain-specific omitted/null/zero semantics need explicit versioned schemas.

Next API-contract phase: inventory every action, derive schemas from verified handlers/tests, review request/response/error/security semantics, then differential validation against a dedicated synthetic local environment. Never fabricate a schema to report Schemathesis PASS; no fuzzing production or real accounts. Schema preparation does not block current tooling or Beta by itself.
