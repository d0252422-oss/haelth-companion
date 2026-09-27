// Rehearses the exact additive set_order upgrade against pre-existing workout
// history in an owned disposable PostgreSQL 17.11+ database. No remote URL is
// read and no shared database is mutated.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createLocalPostgres} from './local-engine-postgres.mjs';

const targetMigration='20260920224000_manual_workout_set_order.sql';
const user='31000000-0000-4000-8000-000000000001';
const out=path.resolve(process.env.WORKOUT_SET_ORDER_EVIDENCE_DIR||'D:/Dev/Evidence/core-release-candidate-20260927/set-order-upgrade');
assert.ok(out.toLowerCase().startsWith('d:\\dev\\evidence\\'),'D-drive evidence path required');
await mkdir(out,{recursive:true});

let before;
const historicalRecords=[randomUUID(),randomUUID()],historicalSession=randomUUID();
const db=await createLocalPostgres({port:57484,release:'AB',beforeMigration:async({filename,admin})=>{
  if(filename!==targetMigration)return;
  await admin`insert into public.users(id,external_subject_hash,timezone)
    values(${user},${'e'.repeat(64)},'Asia/Taipei')`;
  await admin`insert into public.manual_exercise_catalog(exercise_id,owner_user_id,exercise_name,muscle_group,body_part_id)
    values('fixture:set-order',${user},'SYNTHETIC 舊訓練動作','CHEST','system:chest')`;
  await admin`insert into public.manual_exercise_preferences(canonical_user_id,exercise_id)
    values(${user},'fixture:set-order')`;
  for(const [index,recordId] of historicalRecords.entries())await admin`insert into public.manual_workout_sets(
      canonical_user_id,record_id,exercise_id,session_id,local_date,revision,body
    ) values(${user},${recordId},'fixture:set-order',${historicalSession},'2026-09-20',1,
      ${admin.json({source:'MANUAL_WEB',recordId,sessionId:historicalSession,date:'2026-09-20',exerciseId:'fixture:set-order',exerciseName:'SYNTHETIC 舊訓練動作',muscleGroup:'CHEST',weight:10+index,reps:5,totalVolume:(10+index)*5,totalSets:1,durationMinutes:20,revision:1})})`;
  before=(await admin`select count(*)::int as row_count,
    count(*) filter(where deleted)::int as deleted_count
    from public.manual_workout_sets where canonical_user_id=${user}`)[0];
}});

try{
  assert.ok(before,'pre-migration fixture hook did not run');
  const after=(await db.admin`select count(*)::int as row_count,
    count(*) filter(where deleted)::int as deleted_count,
    count(*) filter(where set_order is null)::int as null_order_count
    from public.manual_workout_sets where canonical_user_id=${user}`)[0];
  assert.deepEqual({row_count:after.row_count,deleted_count:after.deleted_count},before);
  assert.equal(after.null_order_count,before.row_count,'historical order must remain unknown');

  const column=(await db.admin`select data_type,is_nullable from information_schema.columns
    where table_schema='public' and table_name='manual_workout_sets' and column_name='set_order'`)[0];
  assert.deepEqual(column,{data_type:'integer',is_nullable:'YES'});
  const constraint=(await db.admin`select pg_get_constraintdef(oid) as definition
    from pg_constraint where conrelid='public.manual_workout_sets'::regclass
      and conname='manual_workout_sets_set_order_positive'`)[0];
  assert.match(constraint.definition,/CHECK \(\(set_order > 0\)\)/i);
  const index=(await db.admin`select indexdef from pg_indexes
    where schemaname='public' and tablename='manual_workout_sets'
      and indexname='manual_workout_set_order_unique'`)[0];
  assert.match(index.indexdef,/UNIQUE INDEX manual_workout_set_order_unique/i);
  assert.match(index.indexdef,/canonical_user_id, session_id, set_order/i);
  assert.match(index.indexdef,/WHERE \(\(NOT deleted\) AND \(set_order IS NOT NULL\)\)/i);

  const source=await readFile('supabase/migrations/'+targetMigration,'utf8');
  await db.admin.begin(tx=>tx.unsafe(source));
  const afterReplay=(await db.admin`select count(*)::int as row_count,
    count(*) filter(where set_order is null)::int as null_order_count
    from public.manual_workout_sets where canonical_user_id=${user}`)[0];
  assert.deepEqual(afterReplay,{row_count:before.row_count,null_order_count:before.row_count});

  const newSession=randomUUID();
  for(const setOrder of [1,2]){
    const recordId=randomUUID();
    await db.admin`insert into public.manual_workout_sets(
      canonical_user_id,record_id,exercise_id,session_id,local_date,set_order,revision,body
    ) values(${user},${recordId},'fixture:set-order',${newSession},'2026-09-21',${setOrder},1,
      ${db.admin.json({source:'MANUAL_WEB',recordId,sessionId:newSession,setOrder,date:'2026-09-21',exerciseId:'fixture:set-order',exerciseName:'SYNTHETIC 舊訓練動作',muscleGroup:'CHEST',weight:12,reps:5,totalVolume:60,totalSets:1,durationMinutes:20,revision:1})})`;
  }
  const stored=await db.admin`select set_order from public.manual_workout_sets
    where canonical_user_id=${user} and session_id=${newSession} order by set_order`;
  assert.deepEqual(stored.map(row=>row.set_order),[1,2]);
  await assert.rejects(()=>db.admin`insert into public.manual_workout_sets(
    canonical_user_id,record_id,exercise_id,session_id,local_date,set_order,revision,body
  ) values(${user},${randomUUID()},'fixture:set-order',${newSession},'2026-09-21',2,1,'{}'::jsonb)`,error=>error.code==='23505');
  await assert.rejects(()=>db.admin`insert into public.manual_workout_sets(
    canonical_user_id,record_id,exercise_id,session_id,local_date,set_order,revision,body
  ) values(${user},${randomUUID()},'fixture:set-order',${randomUUID()},'2026-09-21',0,1,'{}'::jsonb)`,error=>error.code==='23514');

  const report={status:'PASS',scope:'LOCAL_DISPOSABLE_PG17_SET_ORDER_UPGRADE',remote:false,
    targetMigration,binary:db.evidence.binary_version,before,after,column,constraint,index,
    replay:{rowCount:afterReplay.row_count,historicalNullOrderCount:afterReplay.null_order_count},
    newOrder:stored.map(row=>row.set_order),assertions:[
      'historical row count unchanged','historical set_order remains NULL','migration replay is idempotent',
      'column is nullable integer','positive CHECK enforced','active-session unique order enforced','new order 1..N persists'
    ]};
  await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:'PASS',report:path.join(out,'report.json')}));
}finally{
  await db.close();
}
