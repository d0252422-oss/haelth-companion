import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createLocalPostgres,subjects} from './local-engine-postgres.mjs';

const output=process.env.GLOBAL_EXERCISE_EVIDENCE_DIR;
if(!output||!path.resolve(output).toLowerCase().startsWith('d:\\dev\\evidence\\'))throw Error('D_DRIVE_EVIDENCE_REQUIRED');
await mkdir(output,{recursive:true});
let pg;
const report={status:'FAIL',classification:'LOCAL_PG17_11_SYNTHETIC_A_B',gates:{},measured_at:new Date().toISOString()};
const A=subjects.A.canonical,B=subjects.B.canonical;
async function visible(auth,canonical){
  return pg.admin.begin(async tx=>{
    await tx.unsafe('set local role authenticated');
    await tx`select set_config('request.jwt.claim.sub',${auth},true)`;
    return tx`select c.exercise_id,c.owner_user_id,c.exercise_name,c.muscle_group,p.alias,p.archived
      from public.manual_exercise_catalog c left join public.manual_exercise_preferences p
        on p.canonical_user_id=${canonical} and p.exercise_id=c.exercise_id
      order by c.exercise_id`;
  });
}
try{
  pg=await createLocalPostgres({port:57484,release:'AB'});
  const seed=await pg.admin`select exercise_id,exercise_name,muscle_group from public.manual_exercise_catalog where owner_user_id is null order by exercise_id`;
  assert.equal(seed.length,61);
  assert.equal(new Set(seed.map(x=>x.exercise_id)).size,61);
  const categoryCounts=Object.fromEntries((await pg.admin`select muscle_group,count(*)::int as count from public.manual_exercise_catalog where owner_user_id is null group by muscle_group order by muscle_group`).map(x=>[x.muscle_group,x.count]));
  assert.deepEqual(categoryCounts,{BACK:8,BICEPS:5,CARDIO:5,CHEST:8,CORE:6,FULL_BODY:2,GLUTES:4,LEGS:10,SHOULDERS:8,TRICEPS:5});
  assert.equal((await pg.admin`select count(*)::int as count from (select private.exercise_normalized_name(exercise_name) from public.manual_exercise_catalog where owner_user_id is null group by 1 having count(*)>1) d`)[0].count,0);
  report.gates.canonical_registry='PASS';
  const migration=await readFile('supabase/migrations/20260920222000_global_exercise_library_v1.sql','utf8');
  await pg.admin.begin(tx=>tx.unsafe(migration));
  assert.equal((await pg.admin`select count(*)::int as count from public.manual_exercise_catalog where owner_user_id is null`)[0].count,61);
  report.gates.idempotent_seed_reapply='PASS';

  const start=performance.now(),initialA=await visible(subjects.A.auth,A),catalogFetchMs=Number((performance.now()-start).toFixed(2));
  const initialB=await visible(subjects.B.auth,B);
  assert.equal(initialA.length,61);assert.equal(initialB.length,61);
  assert.ok(initialA.some(x=>x.exercise_id==='global:barbell-bench-press'));
  report.gates.new_user_library='PASS';

  await pg.admin.begin(async tx=>{
    await tx.unsafe('set local role service_role');
    await tx`insert into public.manual_exercise_preferences(canonical_user_id,exercise_id,alias,archived,revision)
      values(${A},'global:barbell-bench-press','A 自訂名稱',false,1),(${A},'global:barbell-back-squat',null,true,1)`;
  });
  const preferenceA=await visible(subjects.A.auth,A),preferenceB=await visible(subjects.B.auth,B);
  assert.equal(preferenceA.find(x=>x.exercise_id==='global:barbell-bench-press').alias,'A 自訂名稱');
  assert.equal(preferenceA.find(x=>x.exercise_id==='global:barbell-back-squat').archived,true);
  assert.equal(preferenceB.find(x=>x.exercise_id==='global:barbell-bench-press').alias,null);
  assert.equal(preferenceB.find(x=>x.exercise_id==='global:barbell-back-squat').archived,null);
  report.gates.per_user_alias_archive='PASS';

  const customA=randomUUID(),customB=randomUUID();
  await pg.admin.begin(async tx=>{await tx.unsafe('set local role service_role');
    await tx`insert into public.manual_exercise_catalog values(${customA},${A},'A-private-exercise','OTHER'),(${customB},${B},'A-private-exercise','OTHER')`;
    await tx`insert into public.manual_exercise_preferences(canonical_user_id,exercise_id) values(${A},${customA}),(${B},${customB})`;
  });
  const customVisibleA=await visible(subjects.A.auth,A),customVisibleB=await visible(subjects.B.auth,B);
  assert.ok(customVisibleA.some(x=>x.exercise_id===customA));assert.ok(!customVisibleA.some(x=>x.exercise_id===customB));
  assert.ok(customVisibleB.some(x=>x.exercise_id===customB));assert.ok(!customVisibleB.some(x=>x.exercise_id===customA));
  let sameOwnerDuplicateDenied=false,crossOwnerPreferenceDenied=false;
  try{await pg.admin`insert into public.manual_exercise_catalog values(${randomUUID()},${A},'  a-private-exercise  ','OTHER')`;}catch(error){sameOwnerDuplicateDenied=error.code==='23505';}
  try{await pg.admin.begin(async tx=>{await tx.unsafe('set local role service_role');await tx`insert into public.manual_exercise_preferences(canonical_user_id,exercise_id) values(${B},${customA})`;});}catch(error){crossOwnerPreferenceDenied=String(error.message).includes('EXERCISE_OWNER_MISMATCH');}
  assert.equal(sameOwnerDuplicateDenied,true);assert.equal(crossOwnerPreferenceDenied,true);
  report.gates.custom_isolation_and_duplicate_policy='PASS';

  const record=randomUUID(),session=randomUUID();
  await pg.admin.begin(async tx=>{await tx.unsafe('set local role service_role');
    await tx`insert into public.manual_workout_sets(canonical_user_id,record_id,exercise_id,session_id,local_date,revision,body)
      values(${A},${record},${customA},${session},current_date,1,${tx.json({source:'MANUAL_WEB',exerciseId:customA,exerciseName:'A-private-exercise'})})`;
    await tx`update public.manual_exercise_catalog set exercise_name='A-private-renamed' where exercise_id=${customA} and owner_user_id=${A}`;
  });
  const history=(await pg.admin`select exercise_id,body from public.manual_workout_sets where record_id=${record}`)[0];
  assert.equal(history.exercise_id,customA);assert.equal(history.body.exerciseName,'A-private-exercise');
  let referencedDeleteDenied=false;
  try{await pg.admin.begin(async tx=>{await tx.unsafe('set local role service_role');await tx`delete from public.manual_exercise_catalog where exercise_id=${customA}`;});}catch(error){referencedDeleteDenied=error.code==='23503';}
  assert.equal(referencedDeleteDenied,true);report.gates.workout_history_stability='PASS';

  let normalMutationDenied=false;
  try{await pg.admin.begin(async tx=>{await tx.unsafe('set local role authenticated');await tx`select set_config('request.jwt.claim.sub',${subjects.A.auth},true)`;await tx`update public.manual_exercise_catalog set exercise_name='tampered' where exercise_id='global:barbell-bench-press'`;});}catch(error){normalMutationDenied=error.code==='42501';}
  assert.equal(normalMutationDenied,true);report.gates.global_canonical_mutation_protection='PASS';

  const [storage]=await pg.admin`select
    coalesce(sum(pg_column_size(c)),0)::bigint as row_bytes,
    pg_indexes_size('public.manual_exercise_catalog'::regclass)::bigint as all_catalog_index_bytes
    from public.manual_exercise_catalog c where owner_user_id is null`;
  report.catalog={count:61,category_counts:categoryCounts,fetch_ms:catalogFetchMs,row_bytes:Number(storage.row_bytes),all_catalog_index_bytes:Number(storage.all_catalog_index_bytes)};
  report.gates.performance=catalogFetchMs<1000?'PASS':'FAIL';
  report.status=Object.values(report.gates).every(x=>x==='PASS')?'PASS':'FAIL';
  assert.equal(report.status,'PASS');
}catch(error){report.error=error.stack??String(error);process.exitCode=1;}
finally{
  report.ended_at=new Date().toISOString();
  await writeFile(path.join(output,'global-exercise-library-pg17.json'),JSON.stringify(report,null,2));
  await pg?.close();
}
console.log(JSON.stringify(report));
