# Algorithm persistent runtime integration

Status: non-production integration evidence only. No runtime has been promoted and no production traffic, datastore, schema, or infrastructure was changed.

## Architecture decision

Repository discovery found Apps Script as the current production API/runtime, local Node contract/integration runners, and a Python 3.12 parity package, but no existing long-lived application server that can safely host Python in-process. The smallest realistic additive path is therefore one local child process, started once by the Node integration host and connected solely over framed JSON Lines on stdin/stdout.

Classification of considered models:

- Existing backend in-process: not currently available; Apps Script cannot embed CPython.
- Existing long-lived service: no existing Python service was found.
- Local persistent worker: implemented for non-production evidence; fits current Node tooling without a network listener.
- Serverless handler: not selected because it would reintroduce cold-start and infrastructure decisions.
- Subprocess per request: retained as the reference oracle, not recommended as the candidate lifecycle.
- Reference only: remains a valid fallback decision if a future deployment host cannot support the worker economically.

The execution layers remain separate:

`AlgorithmRequest -> Node transport/lifecycle adapter -> Python worker -> transport-neutral compute_request -> HealthScoreEngine -> AlgorithmResult`

The original `python-algorithm-runtime.py` per-request runner remains intact as the golden oracle. The new worker is additive, compute-only, single-threaded, and owns no persistence API.

## Protocol and lifecycle

- Worker startup emits a version handshake containing runtime name, `health-score-v1.0`, and supported algorithm IDs.
- The host validates the handshake before marking it `HEALTHY`. States are `HEALTHY`, `DEGRADED`, `UNAVAILABLE`, and `INCOMPATIBLE`.
- Each request has a non-secret `request_id`. It is transport correlation only and is excluded from scoring inputs and the algorithm fingerprint.
- Request frames are capped at 1 MiB. Unknown envelope fields, wrong types, missing fields, unknown algorithm/domain/version, invalid JSON, and oversized frames fail closed.
- The worker is intentionally single-threaded. Multiple host calls may be outstanding, but responses are correlated by request ID and calculations execute sequentially. This avoids shared mutable scoring state and does not claim parallel throughput.
- Clean shutdown closes stdin and waits for process exit. Explicit restart creates a new PID and repeats the version handshake.
- No TCP/HTTP socket is opened, so there is no unauthenticated network surface or public bind address.

## Routing and failure isolation

`AsyncAlgorithmRuntimeRouter` preserves the established modes:

- `CURRENT`: Apps Script reference only.
- `SHADOW`: current raw result remains user-visible; persistent Python is compared but has no write or response authority.
- `CANDIDATE`: disabled by default and permitted only by an explicit non-production constructor option. Candidate health and exact parity are required on every call; otherwise the current result is returned.

Unavailable, degraded, incompatible, timed-out, crashed, malformed, partial, wrong-version, or parity-mismatched candidates cannot self-promote. Candidate diagnostics are reduced to allowlisted error classes. A current-runtime failure is not hidden.

Fault evidence covers not-running, startup failure/timeout, crash, request timeout, invalid JSON, partial output, wrong version, parity mismatch, restart, and current failure. All shadow candidate failures preserve the successful current response with zero writes.

## Statelessness, parity, and side effects

- All 28 frozen fixtures match the current Apps Script path, Python subprocess oracle, and persistent Python path.
- Alternating `USER_A -> USER_B -> USER_A` returns identical A results and distinct fingerprints for different inputs.
- Changing only request identity produces an identical normalized result and fingerprint.
- A bounded batch of concurrent host calls remains correctly correlated without result mixing.
- The candidate exposes no writer or datastore handle. Shadow writes, duplicate records, derived writes, reconciliation events, and production side effects are zero.
- Restarting between identical requests produces an identical result.

## Local performance and resource evidence

The reproducible benchmark is `node scripts/benchmark-persistent-algorithm-runtime.cjs`. The first recorded Windows non-production run produced:

| Measurement | Count | Min | Median | P95 | Mean | Max |
|---|---:|---:|---:|---:|---:|---:|
| Current Apps Script VM reference | 100 | 0.049 ms | 0.079 ms | 0.251 ms | 0.113 ms | 1.792 ms |
| Python per-request subprocess | 10 | 583.801 ms | 625.781 ms | 788.434 ms | 652.043 ms | 788.434 ms |
| Persistent Python warm request | 100 | 0.303 ms | 0.358 ms | 0.921 ms | 0.586 ms | 12.935 ms |
| Python algorithm execution | 100 | 0.113 ms | 0.137 ms | 0.332 ms | 0.276 ms | 11.318 ms |
| Host request serialization | 100 | 0.004 ms | 0.005 ms | 0.010 ms | 0.006 ms | 0.021 ms |
| Worker request deserialization | 100 | 0.016 ms | 0.021 ms | 0.060 ms | 0.030 ms | 0.308 ms |
| Worker result serialization | 100 | 0.011 ms | 0.012 ms | 0.021 ms | 0.014 ms | 0.028 ms |
| Warm shadow end-to-end | 100 | 0.377 ms | 0.479 ms | 1.071 ms | 0.596 ms | 1.539 ms |

Persistent cold start was 608.498 ms and restart plus a fresh handshake was 647.256 ms. The 500-request sequential bounded load completed with 500 successes, zero failures, median 0.328 ms and P95 0.853 ms. A 25-request limited concurrent batch completed in 6.122 ms with 25 successes and zero failures. The one worker process reported a 5,459,968-byte working set both before and after load in this run. These are local measurements, not production capacity or SLA claims.

The evidence separates interpreter/process startup from scoring: warm algorithm execution is materially smaller than the earlier ~566 ms per-request process measurement. The performance acceptance threshold remains unfrozen because the repository defines no product SLO for this runtime.

## Security and observability

Telemetry is allowlisted to request ID, algorithm ID/version, selected runtime, runtime health, duration, fallback, difference class and fixed error class. Canonical health inputs, user email, credentials, tokens, Python stderr, and raw exception details are excluded. The candidate has no production endpoint, secret, database connection, or logging of raw requests.

## Rollback and future promotion

Rollback remains configuration-only: select `CURRENT`. It requires no schema migration, data migration, historical recomputation, or code revert because the candidate is compute-only and shadow output is never persisted.

Python is recommended as `CANDIDATE_CANONICAL_ENGINE`, not as a frozen production target. It fits maintainability and testability well and its persistent lifecycle removes the observed startup penalty. A production decision still requires a separately approved deployment host and operational owner. Promotion eligibility requires golden/integration/shadow parity, fault fallback, rollback, no double write, cross-user isolation, security, regression, performance evidence, observability, and a human-authorized production gate.

Cost classification:

- Local/non-production persistent worker: `NO_NEW_FIXED_COST`.
- Hosting inside a future already-paid compatible backend: `POTENTIAL_VARIABLE_COST` until measured.
- A dedicated new managed service/VM: `REQUIRES_NEW_PAID_INFRASTRUCTURE` and is not authorized.
