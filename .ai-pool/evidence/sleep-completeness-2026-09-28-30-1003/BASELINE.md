# Sleep completeness baseline — 2026-10-03 (Asia/Taipei)

This is a read-only evidence snapshot, not a recovery receipt. No phone action,
Beta write, migration, deployment, or Production action was performed.

## Source and deployed versions

- Main canonical checkout HEAD: `81a46b319d4de581b3db744a7a9eef79aaa72bed` (`codex/multi-domain-engine`, dirty; not modified here).
- Android candidate HEAD: `61e9c79bceb90353a490f5831e182f0e091b698c` (`codex/android-late-arrival-reconcile-20261003`). Its beta.29 code is **not** installed.
- Edge review checkout HEAD: `d7a00d527d7486ccbfadfaec5225b3fa604600db` (`codex/beta-edge-routing-fix`, dirty; not modified here).
- Web review checkout HEAD: `ead24c2075081a893c5c0db6e62969897242d309` (`codex/web-dashboard-partial-20261003`).
- Deployed Beta APK per prior device evidence: `0.1.0-beta.25-debug`. No device query was performed in this run.
- Deployed Beta `mobile-health-beta` Edge function: version `47`, read-only Supabase function inventory.
- Public Beta Web build per prior deployment evidence: `20261003-beta-metric-readback-02`; not independently fetched in this snapshot.
- User screenshots: `1000040454.jpg`, `1000040455.jpg`, `1000040456.jpg` in the task's `.codex-remote-attachments` directory. They show the Web gaps and Google Health 10/03 source display, not Health Connect record identities.

## Read-only Beta SQL, 2026-10-03 ~13:00 UTC

Scoped to the canonical owner of the beta.25 connector; no user ID or raw health payload copied here.

| Asia/Taipei owner date | raw `sleep` | raw `sleep_stage` | stage parent identities matched by raw `sleep` |
|---|---:|---:|---:|
| 2026-09-28 | 0 | 0 | n/a |
| 2026-09-30 | 0 | 0 | n/a |
| 2026-10-03 | 0 | 3 (Google Fit 2, Xiaomi 1) | 0 / 3 |

Sleep raw is present for 09/27, 09/29, 10/01 and 10/02. The existing owner rule assigns a session to its **end/wake date** in `Asia/Taipei`; e.g. a session starting 09/28 16:33 UTC is stored under local 09/29, not 09/28. The three 10/03 stage records cover overlapping intervals; their durations must not be added to manufacture a session or daily value.

The beta.25 connector `last_success_at` remained `2026-10-02 14:05:55.735 UTC` when queried; its 10/03 07:54 `PERIODIC_WORKER` batch was a persisted **partial** receipt, not a completed sync. Score queue: 09/28 FAILED, 09/30 COMPLETE, 10/03 FAILED. Score state is not evidence that raw sleep exists or does not exist.

## Boundary of knowledge

The screenshots confirm that Google Health displays sleep on the target dates. They do not expose `SleepSessionRecord` IDs or prove what the Helper's Health Connect reader returned. The first *observed* missing layer for 09/28 and 09/30 is raw SQL; 10/03 has orphan stage fragments at raw SQL. The exact earlier layer for each date remains unverified until a permitted on-device read/diagnostic or source-correlated receipt is available. Edge function logs query was unavailable in the preceding passive check; do not replace that gap with an assumption.

The current local Android beta.29 candidate already changes upload ordering to send each `sleep` parent before its stages and replays pre-change checkpoints. This is an offline mitigation, not proof of recovery on the installed beta.25 device.
