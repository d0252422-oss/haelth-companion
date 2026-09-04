# Algorithm target runtime freeze and deployment contract

Decision date: 2026-08-28 (Asia/Taipei)

## Frozen decision

- Current production canonical runtime: `APPS_SCRIPT_JAVASCRIPT_HEALTH_SCORE_V1_0`.
- Frozen future candidate canonical engine: `PYTHON_3_12_PERSISTENT`.
- Candidate execution model: long-lived, compute-only runtime.
- Current non-production reference transport: bounded JSON Lines over stdio.
- Production transport: `NOT_FROZEN`.
- Routing states: `CURRENT`, `SHADOW`, `CANDIDATE`; default and invalid configuration resolve to `CURRENT`.
- First environment deployment state: `SHADOW`. Direct `CURRENT -> CANDIDATE` is prohibited without a separately reviewed exceptional authorization.

This freezes the engine choice, not a deployment mechanism. Apps Script remains active and cannot be removed. Python has not received production traffic or write authority.

## Evidence basis

The freeze is supported by 84/84 three-path golden results, 28/28 shadow parity, zero unexplained divergence, cross-user isolation, deterministic replay, zero candidate writes, fault fallback, configuration rollback, security and backward-compatibility gates. Local evidence includes warm median 0.358 ms, warm P95 0.921 ms, unchanged 5,459,968-byte worker working set after bounded load, and 500 sequential plus 25 limited concurrent requests without failure. The prior gate completed 215 tests with zero failures. These numbers are local evidence only; production performance remains unknown.

## Formula and version governance

`health-score-v1.0` and fixture contract `HEALTH_ALGORITHM_GOLDEN_V1` are frozen. This decision changes zero formulas and adds zero formulas.

Every algorithm change follows:

`contract change -> decide semantic version -> update/add golden fixtures -> Apps Script/Python cross-runtime parity -> persistent integration parity -> shadow validation -> release gate`

Rules:

1. A semantic formula, weighting, null/zero interpretation, unit, timezone, completeness, confidence, reason-code or output-contract change requires an algorithm-version review. It must not silently remain v1.0 when old and new results are not contract-equivalent.
2. A bug fix that changes an approved result also requires explicit expected-value review and traceable fixture evidence; “bug fix” does not bypass version governance.
3. Transport, lifecycle or telemetry-only changes may retain the algorithm version only when all frozen outputs and fingerprints remain identical.
4. Every runtime declares supported algorithm IDs and versions during handshake. An unexpected version is `INCOMPATIBLE` and routes to current.
5. The 28 shared fixtures are the mandatory minimum. New regressions add fixtures; existing cases are not weakened or removed to make a runtime pass.
6. Until production cutover and retirement criteria pass, Apps Script remains regression-tested as the active reference. Independent formula edits in either language are forbidden.

## Actual hosting and deployment discovery

Verified current architecture:

- Public Web/LINE frontend calls a Google Apps Script Web App. Apps Script v21 is the verified production API and current Sheet-backed scoring runtime.
- Apps Script depends on Google-managed execution, Script Properties, CacheService and Google Sheets. It cannot host an in-process CPython engine or supervise an arbitrary long-lived process.
- The repository has local Node 24 and a Python 3.12 virtual environment. These support the proven worker locally without a network listener.
- Docker CLI 29.7.2 is installed, but the Docker Desktop Linux daemon was not running during this audit. Container execution is therefore not currently available evidence.
- Local Supabase assets exist, but Supabase/Postgres does not itself provide a verified long-lived Python process host in this repository.
- Codemagic is configured only for bounded unsigned iOS Xcode verification. It is not an application runtime.
- No existing repository GitHub Actions workflow was present before this phase. A test-only algorithm workflow is now prepared locally but is unpushed and has not consumed CI resources.
- Environment variables are inherited by the local child process. No algorithm secret is required. Current worker logs are fixed/allowlisted and stderr is discarded by the host.
- Current scaling and production restart supervision for Python are not available because no Python production host has been selected.

## Deployment options, ranked

1. **Existing future long-lived backend/container, supervised worker or in-process Python** — recommended when an already-approved backend runtime becomes available. It avoids a new fixed service, retains one operational boundary, and allows fast routing rollback. Exact transport depends on that host.
2. **Existing non-production machine/process supervisor with the stdio worker** — recommended for the next local/staging shadow gate. It is already proven, has no network surface and adds no fixed cost. It is not frozen as production transport.
3. **Existing container runtime with the worker colocated beside a backend** — viable only after the existing Docker/staging daemon is available and supervision/health evidence is collected. Do not create a new paid container host.
4. **Internal network service** — conditional; justified only if the selected hosting architecture cannot colocate Python. It adds authentication, network, deployment and observability complexity.
5. **Per-request process or serverless cold start** — not recommended for the known lifecycle because process startup dominates local latency.
6. **Dedicated new managed service/VM** — requires new paid infrastructure and is not authorized.

Recommended model: colocate the frozen Python engine inside an existing future long-lived backend when possible; otherwise supervise the bounded worker adjacent to that backend. The production transport remains open until the real host is known.

## Process lifecycle and supervision contract

Required states are `START`, `READY`, `HEALTHY`, `DEGRADED`, `UNAVAILABLE`, `INCOMPATIBLE`, `RESTARTING`, and `STOPPED`.

- Start: launch exactly one configured Python executable with a bounded environment and private stdio pipes.
- Ready: require a valid handshake within the configured startup timeout.
- Healthy: process exists, handshake version is compatible, and request/response validation succeeds.
- Degraded: timeout, malformed output, queue pressure or transient transport failure; never candidate-eligible.
- Unavailable: process missing, startup failure or unexpected exit.
- Incompatible: algorithm ID/version handshake differs from the frozen contract.
- Restarting: drain or reject new work, stop gracefully, create a new process, and repeat handshake.
- Stopped: intentional shutdown completed; no candidate routing.
- Unexpected exit: reject pending requests with a fixed error class and route current. Never blind-replay a candidate write because candidate writes are forbidden.
- Graceful shutdown: stop accepting work, close stdin, allow bounded drain, then terminate after a supervisor-defined timeout.
- Restart loops: must be bounded with backoff. Maximum attempts/backoff are `NOT_FROZEN` until the actual host conventions are known; infinite immediate restart is forbidden.

Current non-production safety defaults are 1 MiB maximum request, 64 pending requests, 3-second request timeout and 5-second startup timeout. They are integration defaults, not production capacity claims. Supported versions are exact, not ranges.

## Concurrency, health, failover and rollback

Current concurrency is single-threaded request execution with mandatory request correlation. Multiple outstanding host requests may queue, but cross-request/user mutable algorithm state is forbidden. Production throughput requirements are `NOT_FROZEN`.

Candidate eligibility requires process availability, compatible version and `HEALTHY`. `DEGRADED`, `UNAVAILABLE`, `INCOMPATIBLE`, `RESTARTING`, `STOPPED`, unknown health, parity failure or validation failure routes to `CURRENT`.

Rollback is frozen as routing/configuration-level `CANDIDATE -> CURRENT`. Restoring current must not require database/schema rollback, historical recomputation, manual Git revert or deletion of candidate records. Runtime identity remains implementation telemetry; semantic persisted provenance is the algorithm version.

## Shadow acceptance and observability

Future environment shadow acceptance requires real, non-fabricated requests; exact output parity under the frozen contract; zero unexplained divergence; zero user-output impact; zero candidate writes; zero fallback failures; and sanitized telemetry for cold/warm latency, P50/P95/P99 when justified, throughput, errors, restarts, memory, CPU and queue depth.

Minimum production-like shadow sample count and performance thresholds are `NOT_FROZEN`; they require actual product traffic/SLO decisions. Tests passing once cannot promote the candidate.

## CI protection

`.github/workflows/algorithm-runtime-gate.yml` is a locally prepared, test-only gate with read-only repository permission and path filtering. It runs JavaScript golden parity, Python golden parity, adapter, persistent-worker, fault/fallback, transport, policy, Ruff and mypy checks. It contains no deployment, signing, production environment, token permission or write permission. Since commits are not authorized for push, this workflow is prepared but not active remotely.

## Apps Script retirement policy

Apps Script removal is forbidden until production candidate cutover is separately authorized, production-like shadow passes, candidate-active evidence passes, a rollback window completes, operational stability and historical compatibility are confirmed, and no unexplained divergence remains. Removal requires another explicit architecture/release decision.

## Next environment gate

An isolated local Python 3.12 runtime is available for a non-production staging shadow gate without new fixed cost. A shared remote staging Python host is not currently evidenced. The safest next gate is therefore a local/staging shadow rehearsal using representative sanitized inputs and the frozen `CURRENT -> SHADOW` routing; it must not be represented as production-like traffic evidence.
