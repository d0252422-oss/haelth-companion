# LINE MINI App and Wearable Preparation

Status: architecture preparation only  
Production changes: none  
Human approval required before channel/provider creation, linking policy changes, or deploy: yes

## Friends & Family beta access freeze

- Android primary CTA: **下載 Android Beta** → development-signed helper → Health Connect read permission → authenticated staging ingestion.
- iOS primary CTA: **加入健康同步捷徑** → Apple Health read permission → authenticated staging ingestion.
- Health Connect ZIP export is fallback/diagnostic only.
- The native iOS HealthKit helper is a future optional automatic-sync path.
- Both platform routes normalize through the existing HDL v2 canonical ingestion; neither creates a platform-specific health database.
- Empty distribution URLs render a truthful “準備中” state and never a fabricated link.

## Decisions that can be made safely now

- Treat the LINE MINI App as a LIFF web client. It must work in both the LIFF browser and an external browser; external-browser login is an explicit flow, not an assumed session.
- Never trust a LINE profile or user ID supplied by the browser. The backend verifies the LINE ID token or access token and derives the provider subject from the verified response.
- Map every verified external subject to the canonical internal `user_id` through `user_identities`. Email is a discovery hint only and never an automatic merge key. A matching subject across channels does not by itself authorize silent cross-service data sharing; provider topology, product terms and consent must permit it.
- LINE user IDs are provider-scoped. Provider/channel ownership is therefore an irreversible product and account-management decision that requires human approval before setup.
- Support revocation and unlinking without deleting canonical health facts. Unlink is a two-part workflow: persist a local revoked/tombstoned link and call LINE's deauthorization endpoint. Deauthorization failure remains retryable and auditable; it never causes silent deletion of canonical health facts.
- A MINI App cannot directly read Android Health Connect. A native Android component remains the Health Connect permission, read and sync boundary; the MINI App reads canonical backend data.
- Health Connect `Metadata.id`, `lastModifiedTime`, `dataOrigin`, optional `clientRecordId`/version and optional device metadata are retained as separate evidence. Existing records may lack device/client identity and are not backfilled with invented attribution. When this app writes new automatically or actively recorded data, it must meet the metadata/device requirements of the SDK version in use.
- Preserve observation `Instant`, original offset when available, and timezone confidence. Never manufacture device or timezone precision.

## Proposed contracts for an isolated rehearsal

| Contract | Purpose | Safety condition |
|---|---|---|
| `POST /auth/line/exchange` (ID token path) | Verify an ID token server-side and establish app session | Expected channel/client, issuer, subject, audience and expiry verified; nonce checked against the initiating session |
| `POST /auth/line/exchange` (access token path) | Verify access token then fetch the profile server-side | Token verification returns expected `client_id` and positive lifetime; client-supplied subject/profile is ignored |
| `POST /identity-links/line` | Propose or confirm a LINE-to-user link | Collision quarantined; no email-only auto-merge |
| `DELETE /identity-links/line` | Tombstone the local link and deauthorize the LINE app | Facts retained; reauthentication, retryable deauthorization and audit required |
| `POST /health-connect/sync-batches` | Submit a bounded, idempotent native sync batch | Verified app session; unique source idempotency key; no raw secret persistence |
| `GET /health-connect/sync-state` | Return non-secret cursor/status metadata | User-scoped authorization; no credential material |

These are interface specifications, not deployed endpoints.

## Required M1/M2 evidence

- Provider and channel ownership decision recorded by a human.
- Cross-channel/service data-sharing terms and consent decision recorded; a matching provider subject is not sufficient by itself.
- LIFF browser and external-browser authentication tests.
- Token validation negative tests: wrong ID-token audience/issuer, expired token, nonce replay, wrong access-token `client_id`, forged token and ignored client-supplied subject.
- Identity collision fixtures covering existing Google, LINE and legacy identities.
- Consent revocation and unlink behavior.
- Health Connect permission denial/revocation behavior.
- Changes-token lifecycle per record type, including expiration recovery through bounded resync.
- Deduplication tests using source record identity plus versioned canonical fingerprint.
- Device attribution confidence tests where device fields are missing, user-declared, changed or contradictory.
- Cross-midnight and offset-change timestamp fixtures.

## Human gates

- Select the long-lived LINE provider and channel owner.
- Decide unverified versus verified MINI App release and confirm Taiwan provider eligibility.
- Approve service-company disclosure, privacy/terms URLs and cross-service data-sharing consent.
- Approve the external-identity merge/remediation policy.
- Approve production OAuth/channel configuration and redirect URLs.
- Approve Android Health Connect production permissions and disclosure text.
- Approve Play Console Health Apps declarations, minimal data types, and any background or older-than-30-day read request.
- Approve deauthorization, retention and deletion-rights behavior when a user unlinks or unregisters.
- Approve the policy for conflicts among observed origin, optional device metadata and user-declared wearable identity.
- Approve any production deploy or migration.

## Official references

- [LINE MINI App development overview](https://developers.line.biz/en/docs/line-mini-app/develop/develop-overview/)
- [LINE MINI App development guidelines](https://developers.line.biz/en/docs/line-mini-app/development-guidelines/)
- [LINE MINI App submission guide](https://developers.line.biz/en/docs/line-mini-app/submit/submission-guide/)
- [External browser behavior](https://developers.line.biz/en/docs/line-mini-app/develop/external-browser/)
- [LIFF browser and external browser differences](https://developers.line.biz/en/docs/liff/differences-between-liff-browser-and-external-browser/)
- [Secure LINE Login process](https://developers.line.biz/en/docs/line-login/secure-login-process/)
- [Provider and channel management](https://developers.line.biz/en/docs/line-developers-console/best-practices-for-provider-and-channel-management/)
- [Health Connect data format](https://developer.android.com/health-and-fitness/health-connect/data-format)
- [Health Connect metadata requirements](https://developer.android.com/health-and-fitness/health-connect/metadata)
- [Health Connect permissions](https://developer.android.com/health-and-fitness/health-connect/ui/permissions)
- [Health Connect record metadata](https://developer.android.com/reference/androidx/health/connect/client/records/metadata/Metadata)
- [Health Connect synchronization](https://developer.android.com/health-and-fitness/health-connect/sync-data)

## Gate

`LINE_MINI_APP_ARCHITECTURE_PREPARED = YES`  
`WEARABLE_ATTRIBUTION_ARCHITECTURE_PREPARED = YES`  
`WEARABLE_ATTRIBUTION_MACHINE_CONTRACT_READY = NO`  
`PRODUCTION_CONFIGURATION_READY = NO`  
`PRODUCTION_DEPLOYMENT_AUTHORIZED = NO`

Verified against the official references above: 2026-08-26.
