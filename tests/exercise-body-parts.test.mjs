import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const [migration,training,web,index,runtime]=await Promise.all([
  readFile(new URL('supabase/migrations/20260920223000_manual_exercise_body_parts.sql',root),'utf8'),
  readFile(new URL('supabase/functions/mobile-health-beta/manual-training-local.ts',root),'utf8'),
  readFile(new URL('scripts/local-engine-web.js',root),'utf8'),
  readFile(new URL('index.html',root),'utf8'),
  readFile(new URL('supabase/functions/mobile-health-beta/local-engine-runtime.ts',root),'utf8')
]);

test('body-part schema has stable system/user identity, ownership, and database duplicate barriers',()=>{
  assert.match(migration,/create table public\.manual_exercise_body_parts/i);
  assert.match(migration,/source text not null check \(source in \('SYSTEM', 'USER'\)\)/i);
  assert.match(migration,/manual_body_part_source_owner_coherent/i);
  assert.match(migration,/manual_body_part_system_key_unique/i);
  assert.match(migration,/manual_body_part_system_name_unique/i);
  assert.match(migration,/manual_body_part_owner_name_unique/i);
  assert.match(migration,/manual_body_part_name_guard/i);
  assert.match(migration,/BODY_PART_DUPLICATE_VISIBLE_NAME/);
  assert.match(migration,/new\.muscle_group is distinct from old\.muscle_group[\s\S]*new\.body_part_id := null/i);
  assert.match(migration,/foreign key\(body_part_id\)[\s\S]*on delete restrict/i);
  assert.match(migration,/enable row level security/i);
  assert.match(migration,/force row level security/i);
  assert.match(migration,/manual_body_part_runtime_(read|insert|delete)/i);
  assert.doesNotMatch(migration,/\b(drop\s+(?:table|schema)|truncate|delete\s+from\s+public\.manual_exercise_catalog)\b/i);
});

test('canonical system registry keeps deterministic identifiers and Chinese display names',()=>{
  const rows=[...migration.matchAll(/\('(system:[a-z0-9-]+)', '([A-Z_]+)', '([^']+)', 'SYSTEM', null\)/g)]
    .map(([,bodyPartId,canonicalKey,displayName])=>({bodyPartId,canonicalKey,displayName}));
  assert.equal(rows.length,11);
  assert.equal(new Set(rows.map(row=>row.bodyPartId)).size,11);
  assert.equal(new Set(rows.map(row=>row.canonicalKey)).size,11);
  assert.equal(new Set(rows.map(row=>row.displayName)).size,11);
  assert.deepEqual(Object.fromEntries(rows.map(row=>[row.canonicalKey,row.displayName])),{
    CHEST:'胸部',BACK:'背部',SHOULDERS:'肩部',BICEPS:'二頭肌',TRICEPS:'三頭肌',LEGS:'腿部',
    GLUTES:'臀部',CORE:'核心',CARDIO:'有氧',FULL_BODY:'全身',OTHER:'其他'
  });
});

test('service implements explicit existing/create modes and never uses display text as authority',()=>{
  assert.match(training,/async resolveBodyPart/);
  assert.match(training,/input\.bodyPartId/);
  assert.match(training,/input\.newBodyPartName/);
  assert.match(training,/AMBIGUOUS_BODY_PART_MODE/);
  assert.match(training,/private\.manual_body_part_normalized_name/);
  assert.match(training,/bodyPartReused:part\.reused/);
  assert.match(training,/insert into public\.manual_exercise_catalog\(exercise_id,owner_user_id,exercise_name,muscle_group,body_part_id\)/);
  assert.match(training,/update public\.manual_exercise_catalog set body_part_id=/);
  assert.match(training,/left join lateral \([\s\S]*snapshot_part on true/);
  assert.match(training,/async cleanupUnusedBodyPart/);
  assert.match(training,/not exists\([\s\S]*public\.manual_workout_sets/);
  assert.doesNotMatch(training,/insert into public\.manual_exercise_catalog values\(/);
  assert.match(runtime,/getExerciseBodyParts/);
});

test('custom exercise UI selects stable IDs and exposes an explicit create-body-part mode',()=>{
  assert.match(web,/id="exercise-create-body-part"/);
  assert.match(web,/id="exercise-create-body-part-name"/);
  assert.match(web,/＋ 新增訓練部位/);
  assert.match(web,/bodyPartId:bodyPartSelect\.value/);
  assert.match(web,/newBodyPartName:document\.getElementById\('exercise-create-body-part-name'\)\.value/);
  assert.match(web,/operation==='classify'\?\{bodyPartId:category\.value\}/);
  assert.match(web,/STALE_CATALOG_RESPONSE'&&attempt<1\)return load\(successText,attempt\+1\)/);
  assert.doesNotMatch(web,/id="exercise-create-category"/);
  assert.match(index,/const EXERCISE_CACHE_SCHEMA="v2"/);
  assert.match(index,/function exerciseBodyPartId/);
  assert.match(index,/option value="\$\{escapeHtml\(group\.bodyPartId\)\}"/);
  assert.doesNotMatch(index,/new Set\(activeExerciseOptions\(\)\.map\(exerciseMuscleGroup\)\)/);
});
