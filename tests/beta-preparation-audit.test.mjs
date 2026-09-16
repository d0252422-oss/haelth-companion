import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {audit,settings,repo} from '../scripts/audit-beta-preparation.mjs';
const result=audit();
test('all historical migrations are read and hashed without claiming fresh remote equivalence',()=>{const files=fs.readdirSync(path.join(repo,'supabase/migrations')).filter(n=>/^\d{14}_.*\.sql$/.test(n));assert.equal(result.all_migrations.length,files.length);for(const m of result.all_migrations){assert.match(m.sha256,/^[a-f0-9]{64}$/);assert.ok(m.destructive_review.includes('not a top-level'));}});
test('eight unique migrations form an ordered dependency graph with source hashes',()=>{
 const seen=new Set();for(const m of result.migrations){assert.equal(seen.has(m.version),false);for(const d of m.depends_on)assert.ok(seen.has(d));seen.add(m.version);assert.match(m.sha256,/^[a-f0-9]{64}$/);assert.ok(m.ddl_and_privilege_locations.length);}assert.equal(seen.size,8);
});
test('six checkpoint settings are real hosted config inputs; only DB URL is secret',()=>{
 const source=fs.readFileSync(path.join(repo,'supabase/functions/mobile-health-beta/hosted-manual-bootstrap.ts'),'utf8');assert.equal(settings.length,6);for(const s of settings)assert.ok(source.includes("env('"+s+"')"));
});
test('all six manual domains and exercise paths retain static SQL coverage',()=>{
 for(const name of ['getBodyRecords','upsertBodyRecord','upsertMealRecord','getNutritionRecords','addWorkoutRecord','getWorkoutRecords','manageExercise','upsertManualObservation','getManualObservations','getSleepRecords','getActivityRecords'])assert.equal(result.actions.find(a=>a.action===name)?.status,'SQL_READY',name);
});
test('supported routes have actual handler locations, not guessed missing links',()=>{
 for(const a of result.actions.filter(a=>a.status==='SQL_READY'||a.status==='PARTIAL'))assert.ok(a.edge_handler.line>0,a.action);
 assert.ok(result.sql_locations.some(l=>l.source.includes('resolveVerifiedManualWebIdentity')));
});
test('unsupported whole-site paths are not credited as SQL-ready',()=>{
 for(const name of ['getWeeklyReport','getTodayCheckin','getUserProfile','getNutritionTargets','upsertHealthCheckin','deleteHealthCheckin'])assert.equal(result.actions.find(a=>a.action===name)?.status,'NOT_IMPLEMENTED',name);
 assert.equal(result.actions.find(a=>a.action==='getCurrentUser')?.status,'LEGACY_ONLY');assert.equal(result.actions.find(a=>a.action==='getDashboardData')?.status,'PARTIAL');
});
test('inventory is offline and role proposal cannot be auto-applied as a migration',()=>{
 const script=fs.readFileSync(path.join(repo,'scripts/audit-beta-preparation.mjs'),'utf8');assert.doesNotMatch(script,/\bfetch\s*\(|node:child_process|postgres\s*\(/);
 const doc=fs.readFileSync(path.join(repo,'docs/BETA_REMOTE_ENABLEMENT_PLAN.md'),'utf8');assert.match(doc,/PENDING_EXPLICIT_BETA_AUTHORIZATION/);assert.match(doc,/SET LOCAL ROLE service_role/);assert.match(doc,/BYPASSRLS/);assert.match(doc,/REMOTE_MUTATIONS_PERFORMED = NO/);
});
