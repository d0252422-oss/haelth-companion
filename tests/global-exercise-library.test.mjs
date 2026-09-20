import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const migration=await readFile(new URL('../supabase/migrations/20260920222000_global_exercise_library_v1.sql',import.meta.url),'utf8');
const training=await readFile(new URL('../supabase/functions/mobile-health-beta/manual-training-local.ts',import.meta.url),'utf8');
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const seed=[...migration.matchAll(/\('(global:[a-z0-9-]+)',\s*'([^']+)',\s*'(CHEST|BACK|SHOULDERS|BICEPS|TRICEPS|LEGS|GLUTES|CORE|CARDIO|FULL_BODY|OTHER)'\)/g)]
  .map(([,exerciseId,name,category])=>({exerciseId,name,category}));
const expected={CHEST:8,BACK:8,SHOULDERS:8,BICEPS:5,TRICEPS:5,LEGS:10,GLUTES:4,CORE:6,CARDIO:5,FULL_BODY:2,OTHER:0};

test('global exercise v1 is a complete deterministic canonical registry',()=>{
  assert.equal(seed.length,61);
  assert.equal(new Set(seed.map(x=>x.exerciseId)).size,seed.length);
  assert.equal(new Set(seed.map(x=>x.name.normalize('NFC').trim().toLocaleLowerCase('zh-Hant'))).size,seed.length);
  assert.ok(seed.every(x=>/^global:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(x.exerciseId)&&x.exerciseId.length<=128));
  assert.deepEqual(Object.fromEntries(Object.keys(expected).map(category=>[category,seed.filter(x=>x.category===category).length])),expected);
  for(const required of ['槓鈴臥推','伏地挺身','引體向上','槓鈴深蹲','羅馬尼亞硬舉','臀推','棒式','跑步機','壺鈴擺盪'])assert.ok(seed.some(x=>x.name===required),required);
});

test('seed and duplicate controls are additive, repeatable, and fail closed',()=>{
  assert.match(migration,/on conflict\s*\(exercise_id\) do nothing/i);
  assert.match(migration,/create unique index if not exists manual_exercise_global_normalized_name_unique/i);
  assert.match(migration,/create unique index if not exists manual_exercise_owner_normalized_name_unique/i);
  assert.match(migration,/owner_user_id is null/);
  assert.doesNotMatch(migration,/\b(drop\s+(?:table|schema)|truncate|delete\s+from)\b/i);
  assert.match(training,/DUPLICATE_CUSTOM_EXERCISE_NAME/);
  assert.match(training,/private\.exercise_normalized_name\(exercise_name\)=private\.exercise_normalized_name/);
});

test('web keeps canonical category codes while presenting Chinese labels',()=>{
  for(const [category,label] of Object.entries({CHEST:'胸部',BACK:'背部',SHOULDERS:'肩部',BICEPS:'二頭肌',TRICEPS:'三頭肌',LEGS:'腿部',GLUTES:'臀部',CORE:'核心',CARDIO:'有氧',FULL_BODY:'全身',OTHER:'其他'})){
    assert.match(html,new RegExp(`${category}:\"${label}\"`));
  }
  assert.match(html,/DUPLICATE_CUSTOM_EXERCISE_NAME/);
});
