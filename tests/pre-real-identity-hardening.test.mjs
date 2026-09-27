import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('workout completion exposes bounded save states and releases UI only after commit',()=>{
  const html=read('index.html'),training=read('supabase/functions/mobile-health-beta/manual-training-local.ts'),transport=read('scripts/local-engine-web.js');
  for(const state of ['IDLE','SAVING','COMMITTED','POST_PROCESSING','COMPLETE','FAILED_RETRYABLE','FAILED_FINAL'])assert.match(html,new RegExp('"'+state+'"'));
  for(const metric of ['workout_click_to_request_start','workout_request_to_api_response','workout_api_response_to_ui_ready','workout_background_recompute','workout_training_range_refresh'])assert.match(html,new RegExp(metric));
  assert.match(training,/manual_training_receipts/);assert.match(training,/timing:\{requestId:input\.clientRequestId,dbCommitMs:/);
  assert.match(transport,/getTrainingWriteStatus/);assert.match(transport,/workoutSession\.sqlEnvelope/);assert.match(transport,/structuredClone/);
  const handlerStart=html.indexOf('document.getElementById("finish-workout").onclick=');
  const handlerEnd=html.indexOf('document.querySelectorAll("[data-mode]")',handlerStart);
  assert.ok(handlerStart>=0&&handlerEnd>handlerStart,'bounded workout completion handler not found');
  const handler=html.slice(handlerStart,handlerEnd);
  const write=handler.indexOf('await apiService.addWorkoutRecord'),release=handler.indexOf('workoutSession=null'),refresh=handler.indexOf('refreshInBackground("workout-create"');
  assert.ok(write>=0&&release>write&&refresh>release,'workout durable-write, UI-release and background-refresh order drifted');
});

test('entitlement admin tooling is Beta-only, exact-canonical, secretless and read-after-write',()=>{
  const script=read('scripts/manage-beta-entitlement.ps1'),sql=read('supabase/migrations/20260920221005_entitlement_admin_inspect.sql');
  assert.match(script,/vptqedxdxfoohbqctujf/);assert.match(script,/uavimjgccigpbwqmfkhh/);
  assert.match(script,/BETA_SERVICE_ROLE_KEY/);assert.doesNotMatch(script,/service_role\s*=\s*['"][A-Za-z0-9._-]{30,}/);
  assert.match(script,/ValidatePattern\('\^\[0-9a-fA-F\]/);assert.match(script,/ENTITLEMENT_READ_AFTER_WRITE_FAILED/);
  assert.match(sql,/security definer set search_path=''/);assert.match(sql,/revoke all .* from public,anon,authenticated/);assert.match(sql,/grant execute .* to service_role/);
  assert.doesNotMatch(sql,/e\.payment_reference|e\.metadata/);
});

test('storage model is tied to current schema and labels synthetic assumptions',()=>{
  const source=read('scripts/model-beta-storage-growth.mjs');
  for(const table of ['beta_health_scores','engine_meals','manual_workout_sets'])assert.match(source,new RegExp(table));
  assert.match(source,/LOCAL_PG17_11_SCHEMA_MODEL_NOT_REAL_USER_USAGE/);assert.match(source,/photos_in_postgres:false/);
});

test('actual-Postgres entitlement admin test covers denied, unknown, grant and revoke cases',()=>{
  const source=read('scripts/test-entitlement-admin-pg.mjs');
  assert.match(source,/set local role authenticated/);assert.match(source,/normalUserDenied/);
  assert.match(source,/ENTITLEMENT_USER_NOT_FOUND/);assert.match(source,/'REVOKED'/);assert.match(source,/'BETA'/);
  assert.match(source,/LOCAL_PG17_11_SYNTHETIC_ONLY/);
});

test('synthetic performance summary refuses to label local timing as real-user latency',()=>{
  const source=read('scripts/summarize-synthetic-sql-performance.mjs');
  assert.match(source,/LOCAL_PG17_11_SYNTHETIC_NOT_REAL_USER_LATENCY/);
  for(const action of ['getBodyRecords','upsertBodyRecord','addWorkoutRecord','getDashboardData','getHealthTimeline'])assert.match(source,new RegExp(action));
  assert.match(source,/INSTRUMENTED_NOT_REAL_USER_MEASURED/);
});
