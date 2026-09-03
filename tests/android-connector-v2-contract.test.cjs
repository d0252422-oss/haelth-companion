'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const read = (path) => fs.readFileSync(path, 'utf8');
const main = read('android-helper/app/src/main/java/app/healthcompanion/sync/MainActivity.kt');
const ingestion = read('android-helper/app/src/main/java/app/healthcompanion/sync/IngestionClient.kt');
const planner = read('android-helper/app/src/main/java/app/healthcompanion/sync/BatchPlanner.kt');
const identity = read('android-helper/app/src/main/java/app/healthcompanion/sync/IdentityBootstrap.kt');
const nativeAuth = read('android-helper/app/src/main/java/app/healthcompanion/sync/NativeGoogleAuth.kt');
const secureStorage = read('android-helper/app/src/main/java/app/healthcompanion/sync/SecureSupabaseAuthStorage.kt');
const manifest = read('android-helper/app/src/main/AndroidManifest.xml');
const health = read('android-helper/app/src/main/java/app/healthcompanion/sync/HealthConnectGateway.kt');
const background = read('android-helper/app/src/main/java/app/healthcompanion/sync/BackgroundHealthSync.kt');
const performance = read('android-helper/app/src/main/java/app/healthcompanion/sync/SyncPerformancePolicy.kt');
const gradle = read('android-helper/app/build.gradle.kts');

test('normal Android UX uses native Google auth and never requests a connection code', () => {
  assert.match(main, /使用 Google 帳號登入/u);
  assert.match(main, /NativeGoogleAuth/u);
  assert.doesNotMatch(main, /IdentityBootstrap|EditText|consumeManualClaim|一次性連接碼|setupIntent/u);
  assert.match(nativeAuth, /GetGoogleIdOption/u);
  assert.match(nativeAuth, /signInWith\(IDToken\)/u);
  assert.match(nativeAuth, /\/v1\/mobile\/native-auth\/link/u);
  assert.match(nativeAuth, /refreshCurrentSession/u);
  assert.match(secureStorage, /AndroidKeyStore/u);
  assert.match(secureStorage, /AES\/GCM\/NoPadding/u);
  assert.match(identity, /\/v1\/mobile\/install-claims\/exchange/u);
});

test('upload uses deterministic record and UTF-8 byte bounds', () => {
  assert.match(planner, /MAX_RECORDS_PER_BATCH = 100/u);
  assert.match(planner, /MAX_APPROX_SERIALIZED_BYTES_PER_BATCH = 256 \* 1024/u);
  assert.match(planner, /sortedWith/u);
  assert.match(planner, /OversizedHealthRecord/u);
  assert.match(ingestion, /SyncCheckpoint/u);
  assert.match(ingestion, /status == 413 -> RetryAction\.OVERSIZE_FAIL/u);
  assert.match(ingestion, /MAX_ATTEMPTS = 3/u);
});

test('legacy claim stays isolated while native session credentials never appear in UI or logs', () => {
  assert.match(identity, /\/v1\/mobile\/sessions\/refresh/u);
  assert.match(identity, /\/v1\/mobile\/sessions\/current/u);
  assert.doesNotMatch(`${main}\n${nativeAuth}\n${secureStorage}\n${identity}\n${ingestion}`, /Log\.|println\(|printStackTrace|service[_-]?role/iu);
});

test('sync performance is bounded, resumable, observable, and background-capable', () => {
  assert.match(health, /pageToken = token/u);
  assert.match(health, /MAX_PAGES_PER_DOMAIN = 50/u);
  assert.match(health, /PaginationGuard\.isRepeated/u);
  assert.match(health, /MAX_CONCURRENT_DOMAIN_READS = 2/u);
  assert.match(main, /FOREGROUND_SYNC_DEADLINE_MS = 120_000L/u);
  assert.match(main, /正在讀取 \$domain/u);
  assert.match(main, /正在上傳健康資料/u);
  assert.match(background, /CoroutineWorker/u);
  assert.match(background, /beginUniqueWork/u);
  assert.match(background, /ExistingWorkPolicy\.KEEP/u);
  assert.match(background, /enqueueUniquePeriodicWork/u);
  assert.match(background, /ExistingPeriodicWorkPolicy\.KEEP/u);
  assert.match(background, /PeriodicWorkRequestBuilder<BackgroundHealthSyncWorker>\(12, TimeUnit\.HOURS\)/u);
  assert.match(background, /MAX_RETRY_ATTEMPTS = 3/u);
  assert.match(performance, /INCREMENTAL_OVERLAP_HOURS = 1L/u);
  assert.match(performance, /class SyncSingleFlight/u);
  assert.match(main, /AppSyncSingleFlight\.gate\.tryStart\(\)/u);
  assert.match(main, /AppSyncSingleFlight\.gate\.finish\(\)/u);
  assert.match(background, /CanonicalIdentity\.sha256\(userId\)/u);
  assert.match(manifest, /READ_HEALTH_DATA_IN_BACKGROUND/u);
  assert.doesNotMatch(`${main}\n${health}\n${background}`, /Log\.|println\(|printStackTrace/iu);
});

test('beta upgrade restores auth before migrating legacy sync state and packaging fails closed', () => {
  assert.match(main, /auth\.restore\(\)/u);
  assert.match(main, /afterAuthentication\(restoredSession = true\)/u);
  assert.match(main, /shouldMigrateLegacySyncState\(restoredSession, session\.canonicalUserId\)/u);
  assert.match(background, /migrateLegacyStateAfterSessionRestore/u);
  assert.match(background, /Auth credentials[\s\S]*never read, changed, or cleared here/u);
  assert.match(gradle, /verifyBetaRuntimeConfiguration/u);
  assert.match(gradle, /tasks\.matching \{ it\.name == "assembleDebug" \}\.configureEach \{ dependsOn\(verifyBetaRuntimeConfiguration\) \}/u);
  assert.match(gradle, /uavimjgccigpbwqmfkhh/u);
  assert.doesNotMatch(`${main}\n${background}`, /supabase_auth_secure|health-sync-supabase-auth-aes/u);
});

test('authenticated startup renders ready and hands durable work to WorkManager', () => {
  const restored = main.indexOf('auth.restore()');
  const migrated = main.indexOf('migrateLegacyStateAfterSessionRestore');
  const scheduled = main.indexOf('BackgroundSyncScheduler.reconcileAndEnqueue');
  assert.ok(restored >= 0 && migrated > restored && scheduled > migrated);
  assert.match(main, /BackgroundHealthReadState\.GRANTED -> handoffToBackground\(session\)/u);
  assert.match(main, /renderBackground\(runtime\)/u);
  assert.match(main, /Worker: \$\{runtime\.name\}/u);
  assert.match(main, /背景資料更新中，你可以繼續使用 App/u);
  assert.doesNotMatch(main, /hasAnyPermission\(\) && health\.hasBackgroundReadPermission\(\)[\s\S]{0,160}firstSync\(\)/u);
  assert.match(background, /CoroutineWorker/u);
  assert.doesNotMatch(main, /saveBackgroundResult\(session\.canonicalUserId, "SYNCING"\)/u);
});

test('startup and periodic work are user-scoped, unique, checkpointed, and single-flight', () => {
  assert.match(background, /val immediatePolicy = if \(replaceImmediate\) ExistingWorkPolicy\.REPLACE else ExistingWorkPolicy\.KEEP/u);
  assert.match(background, /beginUniqueWork\(BackgroundWorkNames\.immediate\(userId\), immediatePolicy/u);
  assert.match(background, /BackgroundWorkNames\.backfill\(userId\)/u);
  assert.doesNotMatch(background, /continuation\.then\(backfill\)/u);
  assert.match(background, /enqueueUniquePeriodicWork\(BackgroundWorkNames\.periodic\(userId\), ExistingPeriodicWorkPolicy\.KEEP/u);
  assert.match(background, /setExpedited\(OutOfQuotaPolicy\.RUN_AS_NON_EXPEDITED_WORK_REQUEST\)/u);
  assert.match(background, /BackgroundSyncMode\.INCREMENTAL/u);
  assert.match(background, /BackgroundSyncMode\.BACKFILL/u);
  assert.match(background, /activeWindowEnd/u);
  assert.match(background, /SyncCheckpointStore/u);
  assert.match(background, /AppSyncSingleFlight\.gate\.tryStart\(\)/u);
  assert.match(main, /AppSyncSingleFlight\.gate\.tryStart\(\)/u);
  assert.match(background, /BackgroundWorkNames\.userKey\(session\.canonicalUserId\) != expectedUserKey/u);
  assert.match(main, /BackgroundSyncScheduler\.cancel\(this, userId\)/u);
  assert.match(background, /getWorkInfosForUniqueWorkFlow\(BackgroundWorkNames\.immediate\(userId\)\)/u);
  assert.match(background, /BACKGROUND_WORK_ID/u);
  assert.match(background, /BACKGROUND_LAST_PROGRESS_AT/u);
  assert.match(background, /WorkRecoveryAction\.REPLACE_STALE/u);
  assert.match(performance, /STALE_AFTER_MINUTES = 8L/u);
  assert.match(performance, /actual\.state == DurableWorkState\.ENQUEUED/u);
  assert.match(performance, /BackgroundRuntimeStatus\.WAITING_FOR_CONSTRAINT/u);
});

test('background outcomes terminate safely and score recompute stays server-decoupled', () => {
  for (const state of ['SUCCESS', 'PARTIAL', 'RETRY_PENDING', 'TIMEOUT', 'FAILED_AUTH', 'PERMISSION_REQUIRED']) {
    assert.match(background, new RegExp(`"${state}"`, 'u'));
  }
  assert.match(background, /runAttemptCount < MAX_RETRY_ATTEMPTS - 1/u);
  assert.match(background, /HEALTH_READ_TIMEOUT_MS = 3 \* 60_000L/u);
  assert.match(background, /UPLOAD_TIMEOUT_MS = 4 \* 60_000L/u);
  assert.match(background, /SESSION_TIMEOUT_MS = 30_000L/u);
  assert.match(background, /PERMISSION_TIMEOUT_MS = 30_000L/u);
  assert.match(background, /setProgress\(workDataOf/u);
  assert.match(background, /catch \(cancelled: CancellationException\)/u);
  assert.match(background, /state\.clearActiveWindow/u);
  assert.match(main, /"RETRY_PENDING" -> "將自動重試"/u);
  assert.doesNotMatch(`${main}\n${background}`, /while\s*\(true\)|WakeLock|startForegroundService|Log\.|println\(|printStackTrace/u);
});
