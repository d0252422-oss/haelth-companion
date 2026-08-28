# Real-device dual-platform connector evidence runbook

This gate uses only a physical iPhone and a compatible Android test device. Never include tokens, account email, raw identifiers, or identifiable health payloads in evidence.

Generate the local evidence form:

```powershell
node scripts/dual-platform-real-device-evidence.cjs --template > .local/dual-platform-real-device-evidence.json
```

## Track A — iPhone Shortcut

From the authenticated Web/LINE test user, open the connector setup and add the test Shortcut. In Shortcuts, request one bounded Apple Health query at a time for steps, heart rate, resting heart rate, sleep duration/stages, weight, workout, HRV and SpO2. Grant only requested read permission. For each `IOS-RD-01` through `IOS-RD-10`, record whether readable, redacted structure, unit, start/end time, source/device metadata, whether a native identifier is actually exposed, Shortcut runtime result, authenticated HTTP result and canonical mapping result.

For `IOS-RD-11`, POST one real sample and record the sanitized receipt reference. For `IOS-RD-12`, send the identical payload and confirm the canonical count does not increase. For `IOS-RD-13`, modify only a legitimate test record if Apple Health/source UI safely permits it; otherwise record `BLOCKED_REAL_DEVICE`. Do not manufacture an update.

Delete test: after capturing a safe test sample, delete it at the source, rerun the identical bounded query, and record whether it disappears and whether any deletion identifier/tombstone is exposed. Absence alone is not a tombstone; keep delete semantics `PARTIAL` or `UNKNOWN` until bounded snapshot reconciliation is demonstrated.

Record actual integer setup/repeat step counts. Leave setup time null unless measured with a clock.

## Track B — Android Health Connect scheduled export

Use a non-production test account. Record Android and Health Connect versions, chosen schedule/frequency and cloud provider. After the first legitimate export, record filename, provider file ID (if exposed), size, modified time, revision/checksum if exposed. Copy the ZIP locally and run:

```powershell
python scripts/inspect-health-connect-export.py "C:\evidence\export-1.zip" > .local/export-1-inspection.json
```

Add one legitimate record, wait for the next scheduled export without manually forcing a second format, capture the same metadata, then run the inspector again and compare:

```powershell
python scripts/compare-health-connect-exports.py .local/export-1-inspection.json .local/export-2-inspection.json
```

Replay the same export through the local adapter twice and verify no duplicate canonical record. Update/delete only safe test data and only when the source app supports it. Never infer snapshot/delta or deletion semantics from filename alone.

## Validation

After completing and sanitizing the evidence file:

```powershell
node scripts/dual-platform-real-device-evidence.cjs .local/dual-platform-real-device-evidence.json
```

The validator rejects template, synthetic, production-write, secret-bearing and evidence-free PASS claims.
