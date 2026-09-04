# AI Pool Failover Contract

Checked: 2026-08-28 (Asia/Taipei)

## Invariants

`NO_SINGLE_AI_QUOTA_BLOCKER = TRUE`

`WAIT_FOR_QUOTA_RESET = FORBIDDEN_IF_CAPABLE_ALTERNATIVE_EXISTS`

`QUOTA_EXHAUSTION = FAILOVER_EVENT_NOT_PROJECT_BLOCKER`

`FAILOVER_DOES_NOT_MEAN_RESTART = TRUE`

Failover continues from the latest verified Git/checkpoint evidence. It does not
repeat completed research, discard local work, weaken gates, expand production
authority, or permit concurrent agents to modify the same files.

## Current routing

- Coding: Codex primary. Gemini CLI is a failover only when it is authenticated,
  eligible, and immediately callable. Manus may receive bounded agentic work only
  when its API is already authenticated and the task fits.
- Research: Manus when authenticated; otherwise an available official/browser
  research tool. Prefer primary documentation.
- Review: use a capable reviewer that did not implement the change. Reviewers
  report findings before code modification unless ownership is handed off.

## Verified local availability

- Codex CLI 0.149.0: installed and callable.
- Gemini CLI 0.56.0: installed, but the current official client/account response
  is `UNSUPPORTED_CLIENT` / `IneligibleTierError`; do not reinstall or bypass.
- Manus API skill: installed from the official documentation skill; API key is
  absent, so API execution requires a future human credential action.
- Node.js 24.19.0, Git 2.53.0, GitHub CLI 2.97.0: callable.
- Repository Python virtual environment: Python 3.12.13 with declared runtime and
  development imports available.

Missing optional credentials and external eligibility are isolated tooling
states, not project blockers. Account login, credential creation, payment,
production deployment, and destructive operations remain human gates.
