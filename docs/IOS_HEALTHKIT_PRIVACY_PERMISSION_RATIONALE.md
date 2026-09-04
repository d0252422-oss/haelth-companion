# iOS HealthKit Permission and Privacy Rationale

## User-facing purpose

生活小助手會讀取 Apple 健康中的步數、心率與睡眠資料，用於個人健康分析、同步與健康分數。它不會寫入 Apple 健康，也不會要求與目前功能無關的健康權限。

## Data use

| Data | Purpose | Upload |
|---|---|---|
| Steps | Daily activity normalization and analysis | Canonical count, interval/date, source provenance |
| Heart Rate | BPM trend and supported health analysis | BPM, timestamp, source provenance |
| Sleep | Sleep duration/stage and wake-date analysis | Stage/session interval, duration, timezone/provenance |

The helper uploads only through TLS using a canonical-user-bound, revocable app session. Tokens, install claims and Keychain material are never health payload fields or logs. Source app/device fields remain null when HealthKit does not provide them.

## Control

- Stop data access: iPhone Settings / Health / Data Access & Devices / 生活小助手, then revoke selected categories.
- Stop server sync: revoke/unlink the helper from the authenticated Web account; the app session becomes invalid.
- Temporary network/server failure: data remains in the protected local retry queue; the user is not asked to re-enter an account.
- Account/data deletion and retention behavior must match the approved Web privacy policy before Beta distribution.

The final public Privacy Policy URL, retention period, deletion SLA and legal text remain human/legal release inputs. This document is an engineering rationale, not legal approval.

