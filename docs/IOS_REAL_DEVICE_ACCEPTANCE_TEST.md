# iOS Real-Device Acceptance Test

Use a real iPhone and real Apple Health records. Screenshots can support UX evidence but cannot substitute for API ingestion evidence. Synthetic/test records never count as live PASS.

## Preconditions

- Tester is signed in to the canonical Web/LINE account.
- Debug/Beta helper is signed by the approved Team and its Universal Link is verified.
- Backend bootstrap/ingestion endpoints and private credential tables are deployed to the isolated Beta target.
- Production mutation/cutover has separate authorization.

## Procedure and evidence

1. From the authenticated Web/LINE flow, start iOS Health Sync setup.
2. Install/open the helper; count all typed inputs. Expected: `0`.
3. Use the one secure continuation action if required by iOS. Expected: Universal Link opens the helper and claim exchange succeeds once; replay fails.
4. Confirm the server session resolves to the same canonical user. Expected: no email/user ID/pairing code entered or guessed.
5. Approve only Steps, Heart Rate and Sleep read access.
6. Run first sync using real records; capture sanitized counts, timestamps, units, source app and hashed IDs.
7. Add/allow a later real record and run incremental sync. Expected: only changes are sent.
8. Replay the same batch. Expected: zero new canonical rows and duplicate receipt returned.
9. Disable network, trigger sync, restore network. Expected: protected queue persists and drains automatically with backoff.
10. Restart app and reboot device. Expected: checkpoints/session persist and retry resumes without text input.
11. Revoke Health access. Expected: clear permission guidance; no account form.
12. Revoke app session. Expected: upload denied; secure Web re-binding, never cross-user fallback.
13. Attempt an upload whose canonical user differs from the session. Expected: client and server reject it.
14. Verify Supabase read-only counts/ownership and Web visibility for the bound account; verify a second user cannot see those records.

## Pass block

```text
IDENTITY_BOUND = YES/NO
USER_TYPED_INPUT_COUNT = 0/N
HEALTHKIT_PERMISSION = PASS/FAIL
STEPS_READ = PASS/FAIL
HEART_RATE_READ = PASS/FAIL
SLEEP_READ = PASS/FAIL
INITIAL_SYNC = PASS/FAIL
INCREMENTAL_SYNC = PASS/FAIL
DUPLICATE_REPLAY = PASS/FAIL
CROSS_USER_ISOLATION = PASS/FAIL
WEB_DATA_VISIBLE = PASS/FAIL
```

All values must meet the requested PASS definition; empty or synthetic data does not qualify.

