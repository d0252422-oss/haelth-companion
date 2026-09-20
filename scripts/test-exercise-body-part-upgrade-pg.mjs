// Rehearses the real pre-body-part catalog shape in an owned disposable PG17.11+ database.
// It never reads a remote connection string and never mutates a shared database.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createLocalPostgres} from './local-engine-postgres.mjs';

const targetMigration='20260920223000_manual_exercise_body_parts.sql';
const user='30000000-0000-4000-8000-000000000001';
const out=path.resolve(process.env.BODY_PART_UPGRADE_EVIDENCE_DIR||'D:/Dev/Evidence/exercise-body-parts-20260920/upgrade');
assert.ok(out.toLowerCase().startsWith('d:\\dev\\evidence\\'),'D-drive evidence path required');
await mkdir(out,{recursive:true});

let fixtureBefore;
const db=await createLocalPostgres({port:57484,release:'AB',beforeMigration:async({filename,admin})=>{
  if(filename!==targetMigration)return;
  await admin`insert into public.users(id,external_subject_hash,timezone)
    values(${user},${'f'.repeat(64)},'Asia/Taipei')`;
  await admin`insert into public.manual_exercise_catalog(exercise_id,owner_user_id,exercise_name,muscle_group) values
    ('fixture:legacy-chest',${user},'SYNTHETIC 舊胸部動作','胸部'),
    ('fixture:legacy-legs',${user},'SYNTHETIC 舊腿部動作','腿部')`;
  await admin`insert into public.manual_exercise_preferences(canonical_user_id,exercise_id) values
    (${user},'fixture:legacy-chest'),(${user},'fixture:legacy-legs')`;
  const chestRecord=randomUUID(),legsRecord=randomUUID(),session=randomUUID();
  await admin`insert into public.manual_workout_sets(
      canonical_user_id,record_id,exercise_id,session_id,local_date,revision,body
    ) values
    (${user},${chestRecord},'fixture:legacy-chest',${session},'2026-09-20',1,
      ${admin.json({source:'MANUAL_WEB',recordId:chestRecord,sessionId:session,date:'2026-09-20',exerciseId:'fixture:legacy-chest',exerciseName:'SYNTHETIC 舊胸部動作',muscleGroup:'胸部',weight:10,reps:10,totalVolume:100,totalSets:1,durationMinutes:20,revision:1})}),
    (${user},${legsRecord},'fixture:legacy-legs',${session},'2026-09-20',1,
      ${admin.json({source:'MANUAL_WEB',recordId:legsRecord,sessionId:session,date:'2026-09-20',exerciseId:'fixture:legacy-legs',exerciseName:'SYNTHETIC 舊腿部動作',muscleGroup:'腿部',weight:20,reps:10,totalVolume:200,totalSets:1,durationMinutes:20,revision:1})})`;
  fixtureBefore=(await admin`select
    (select count(*)::int from public.manual_exercise_catalog) as catalog,
    (select count(*)::int from public.manual_exercise_preferences) as preferences,
    (select count(*)::int from public.manual_workout_sets) as workouts`)[0];
}});

try{
  assert.ok(fixtureBefore,'upgrade fixture hook did not run');
  const after=(await db.admin`select
    (select count(*)::int from public.manual_exercise_catalog) as catalog,
    (select count(*)::int from public.manual_exercise_preferences) as preferences,
    (select count(*)::int from public.manual_workout_sets) as workouts`)[0];
  assert.deepEqual(after,fixtureBefore,'upgrade must preserve catalog, preference, and workout counts');

  const mapped=[...await db.admin`select exercise_id,muscle_group,body_part_id
    from public.manual_exercise_catalog where exercise_id like 'fixture:%' order by exercise_id`];
  assert.deepEqual(mapped,[
    {exercise_id:'fixture:legacy-chest',muscle_group:'CHEST',body_part_id:'system:chest'},
    {exercise_id:'fixture:legacy-legs',muscle_group:'LEGS',body_part_id:'system:legs'}
  ]);
  assert.equal((await db.admin`select count(*)::int as n from public.manual_exercise_body_parts where source='SYSTEM'`)[0].n,11);
  assert.equal((await db.admin`select count(*)::int as n from public.manual_exercise_catalog where body_part_id is null`)[0].n,0);
  assert.equal((await db.admin`select count(*)::int as n from public.manual_exercise_catalog c
    left join public.manual_exercise_body_parts b using(body_part_id) where b.body_part_id is null`)[0].n,0);
  assert.equal((await db.admin`select count(*)::int as n from (
      select b.display_name,count(distinct b.body_part_id)
      from public.manual_exercise_catalog c join public.manual_exercise_body_parts b using(body_part_id)
      group by b.display_name having count(distinct b.body_part_id)>1
    ) duplicate_display`)[0].n,0);

  const history=[...await db.admin`select exercise_id,body->>'muscleGroup' as muscle_group,
    body ? 'bodyPartId' as has_body_part_id from public.manual_workout_sets
    where canonical_user_id=${user} order by exercise_id`];
  assert.deepEqual(history,[
    {exercise_id:'fixture:legacy-chest',muscle_group:'胸部',has_body_part_id:false},
    {exercise_id:'fixture:legacy-legs',muscle_group:'腿部',has_body_part_id:false}
  ],'legacy workout snapshots must not be rewritten');

  // Compatibility window: the previous Edge revision classified by muscle_group.
  await db.admin`update public.manual_exercise_catalog set muscle_group='BACK'
    where exercise_id='fixture:legacy-chest'`;
  const legacyClassify=(await db.admin`select muscle_group,body_part_id from public.manual_exercise_catalog
    where exercise_id='fixture:legacy-chest'`)[0];
  assert.deepEqual(legacyClassify,{muscle_group:'BACK',body_part_id:'system:back'});
  assert.equal((await db.admin`select body->>'muscleGroup' as value from public.manual_workout_sets
    where exercise_id='fixture:legacy-chest'`)[0].value,'胸部','history stays a snapshot after classification');

  const report={status:'PASS',scope:'LOCAL_DISPOSABLE_PG_UPGRADE_REHEARSAL',remote:false,
    targetMigration,binary:db.evidence.binary_version,before:fixtureBefore,after,
    mapped,history,legacyEdgeClassify:legacyClassify,
    assertions:['row counts unchanged','CHEST/胸部 map to system:chest','LEGS/腿部 map to system:legs',
      'no null/orphan body-part references','legacy workout JSON unchanged','legacy Edge classify resolves stable body-part ID']};
  await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:'PASS',report:path.join(out,'report.json')}));
}finally{
  await db.close();
}
