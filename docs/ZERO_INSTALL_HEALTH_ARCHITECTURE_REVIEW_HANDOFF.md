# Zero-install dual-platform health connector — review handoff

## Architecture and reuse

The LINE MINI App/Web App remains the UI and canonical identity owner. A connector router selects an iOS Shortcut, approved vendor OAuth, the existing optional Android Helper, or a future Health Connect scheduled export. Every route terminates at the existing authenticated ingestion, HDL v2 normalization, deduplication, source-version reconciliation, invalidation and health engine. The existing iOS and Android helpers are frozen/preserved, not deleted.

HDL v2 already carries `source_system`, `source_record_id`, `source_fingerprint`, device/source metadata and data-quality JSON. No database migration is justified for this POC. Connector-only properties (`connector_type`, `source_record_id_kind`, `sync_method`, resolution/priority evidence) live in the validated envelope/data-quality metadata until production query requirements prove dedicated columns necessary.

## Implemented POC

- `ios_shortcut` envelope for Apple Health with authenticated canonical user, bounded sync window, schema version and records.
- Local-only HTTP POC route `POST /v1/connectors/ios-shortcut/ingest` uses an injected authenticated web/session resolver; it is not registered in production.
- Native identifiers are labelled `NATIVE`; otherwise a stable canonical SHA-256 is labelled `DERIVED_FINGERPRINT`. No claim is made that Shortcuts exposes HealthKit UUIDs.
- Deterministic fixtures cover steps, heart rate, sleep, sleep stage, weight and workout. HRV/SpO2 are contract-capable but remain unverified on real devices.
- Connector capability matrix and deterministic evidence-based source selection. No global `DIRECT_VENDOR > OS_AGGREGATOR` rule.
- Offline ZIP inspector lists entries, sizes, SHA-256 and content-format candidates without extraction, upload or database access.

## Known lifecycle semantics

| Connector | Create | Replay | Update | Delete | Stale update | Source change |
|---|---|---|---|---|---|---|
| Existing Android/iOS helper | PASS | PASS | PASS | PASS (tombstone) | PASS | PARTIAL |
| iOS Shortcut POC | PASS | PASS | PARTIAL pending device evidence | UNKNOWN | PASS by existing backend version gate | PARTIAL |
| Health Connect export | UNKNOWN | fingerprint-ready | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Vendor cloud | provider-specific | provider-specific | provider-specific | provider-specific | provider-specific | provider-specific |

Unknown export facts deliberately remain unknown: file-ID stability, archive format, full snapshot versus delta, update semantics and delete semantics. No tombstone is fabricated.

## Google Drive access design (not provisioned)

Use ordinary Google OAuth plus Picker and the non-sensitive `drive.file` scope, opened in an external browser from the MINI App. The user explicitly selects one export file. Backend stores an encrypted refresh credential reference, stable Google subject (not Gmail as primary key), selected file ID, last observed modification metadata and revocation state. It checks metadata at a bounded rate and downloads only after change. Disconnect revokes authorization and removes the stored reference. Frontend never receives a client secret or refresh token. `drive.readonly` and all Google Health scopes are excluded unless later evidence proves a separately approved need. No credentials were created.

## UX assessment

| Flow | Setup | Ongoing | Automation | Recovery | Friction |
|---|---|---|---|---|---|
| iOS Shortcut | MEDIUM | LOW after optional automation | PARTIAL | MEDIUM | MEDIUM |
| Android vendor OAuth | LOW | LOW | HIGH | LOW | LOW |
| Android Helper | MEDIUM | LOW | HIGH/best effort | MEDIUM | MEDIUM |
| Android scheduled export | HIGH until proven | LOW candidate | UNKNOWN | HIGH | HIGH |

User labels remain: “連接健康資料”, “選擇你的裝置”, “推薦：自動同步”, and “不想安裝 App？使用免安裝方式”.

## Real-device evidence gates

1. iPhone: create the Shortcut, observe its actual output per metric, authorize first sync, replay it, edit/source-update if possible, and compare Web display. Record which metrics and identifiers are genuinely available.
2. Android: create two scheduled Health Connect exports after adding one real record. Supply both ZIPs locally to the inspector. Record export timestamp, filename, size, hash, cloud file ID/modified time, entries/formats and any schema version. Compare file ID/name/hash/size/entries/record counts before classifying snapshot/delta/update/delete behavior.

## Independent review questions

1. Is keeping connector metadata in data-quality JSON acceptable until production query needs justify columns?
2. Does Shortcut authentication need a one-time web bootstrap equivalent to the helper install claim, or is an existing scoped app session usable without typed input?
3. Which Shortcut actions actually preserve Apple Health source metadata and stable identity on current iOS?
4. Can Health Connect scheduled export target a consistently selectable Drive file, and is `drive.file` sufficient after Picker selection?
5. What bounded reconciliation policy is safe if exports prove to be full snapshots but deletion evidence remains absent?

External AI review is manual and non-blocking. Production writes, deployment, credentials and paid resources were not used.
