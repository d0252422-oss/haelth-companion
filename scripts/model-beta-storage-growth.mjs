import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createLocalPostgres} from './local-engine-postgres.mjs';

const output=process.env.BETA_STORAGE_EVIDENCE_DIR;
if(!output||!path.resolve(output).toLowerCase().startsWith('d:\\dev\\evidence\\'))throw Error('D_DRIVE_EVIDENCE_REQUIRED');
await mkdir(output,{recursive:true});
let pg;
try{
  pg=await createLocalPostgres({port:57484,release:'AB'});
  const [base]=await pg.admin.unsafe(`select
    coalesce(sum(pg_relation_size(c.oid)) filter(where n.nspname in ('public','private')),0)::bigint as data_bytes,
    coalesce(sum(pg_indexes_size(c.oid)) filter(where n.nspname in ('public','private')),0)::bigint as index_bytes
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p')`);
  const [sizes]=await pg.admin.unsafe(`select
    pg_column_size(row(gen_random_uuid(),gen_random_uuid(),1,current_date,false,jsonb_build_object('source','MANUAL_WEB','weight',72.4,'bodyFat',18.2),now()))::int as body,
    pg_column_size(row(gen_random_uuid(),gen_random_uuid(),1,current_date,false,jsonb_build_object('foodName','一般餐點','calories',650,'protein',35.5,'carbs',70.25,'fat',20.1),jsonb_build_object('items',jsonb_build_array(jsonb_build_object('name','一般餐點'))),now()))::int as nutrition,
    pg_column_size(row(gen_random_uuid(),gen_random_uuid(),'exercise-1',gen_random_uuid(),current_date,1,false,jsonb_build_object('source','MANUAL_WEB','exerciseName','深蹲','muscleGroup','腿部','weight',60,'reps',10,'totalVolume',600),now()))::int as training_set,
    pg_column_size(row(gen_random_uuid(),gen_random_uuid(),'sleep',current_date,'Asia/Taipei','manual',1,false,jsonb_build_object('source','manual','domain','sleep','timezone','Asia/Taipei','date',current_date,'recordId',gen_random_uuid(),'value',480,'unit','minute','coverage','SESSION','revision',1,'deleted',false),now(),now()))::int as sleep,
    pg_column_size(row(gen_random_uuid(),gen_random_uuid(),'steps',current_date,'Asia/Taipei','manual',1,false,jsonb_build_object('source','manual','domain','steps','timezone','Asia/Taipei','date',current_date,'recordId',gen_random_uuid(),'value',8000,'unit','count','coverage','FULL_DAY','revision',1,'deleted',false),now(),now()))::int as steps,
    pg_column_size(row(gen_random_uuid(),gen_random_uuid(),'total_energy',current_date,'Asia/Taipei','manual',1,false,jsonb_build_object('source','manual','domain','total_energy','timezone','Asia/Taipei','date',current_date,'recordId',gen_random_uuid(),'value',2200,'unit','kcal','coverage','FULL_DAY','revision',1,'deleted',false),now(),now()))::int as energy,
    pg_column_size(row(gen_random_uuid(),gen_random_uuid(),current_date,'health_overall',82,0.875,'HIGH','VALID',array[]::text[],'health-score-v1.0',repeat('a',64),'{}'::jsonb,now(),now(),now(),now()))::int as score,
    pg_column_size(row(gen_random_uuid(),gen_random_uuid(),repeat('b',64),jsonb_build_object('status','SAVED','records',jsonb_build_array(jsonb_build_object('recordId',gen_random_uuid(),'weight',60,'reps',10)))))::int as receipt`);
  const assumptions={body_rows:30,nutrition_rows:90,workouts:12,sets_per_workout:5,sleep_rows:30,steps_rows:30,energy_rows:30,score_rows:240,mutation_receipts:192};
  const dataPerUserMonth=assumptions.body_rows*sizes.body+assumptions.nutrition_rows*sizes.nutrition+assumptions.workouts*assumptions.sets_per_workout*sizes.training_set+assumptions.sleep_rows*sizes.sleep+assumptions.steps_rows*sizes.steps+assumptions.energy_rows*sizes.energy+assumptions.score_rows*sizes.score+assumptions.mutation_receipts*sizes.receipt;
  const growth=(users)=>{const data=dataPerUserMonth*users,indexLow=Math.round(data*.35),indexHigh=Math.round(data*.65);return {users,months:1,data_only_bytes:data,index_overhead_bytes_range:[indexLow,indexHigh],total_growth_bytes_range:[data+indexLow,data+indexHigh]};};
  const monthlyRange=growth(1).total_growth_bytes_range;
  const threshold=bytes=>[Math.floor(bytes/monthlyRange[1]),Math.floor(bytes/monthlyRange[0])];
  const report={status:'PASS',classification:'LOCAL_PG17_11_SCHEMA_MODEL_NOT_REAL_USER_USAGE',base_schema:{data_bytes:Number(base.data_bytes),index_bytes:Number(base.index_bytes),total_bytes:Number(base.data_bytes)+Number(base.index_bytes)},row_bytes:sizes,assumptions,scenarios:[1,10,100,1000].map(growth),threshold_user_months:{mb500:threshold(500*1024*1024),gb1:threshold(1024**3),gb5:threshold(5*1024**3)},top_growth_tables:['public.beta_health_scores','private mutation receipt tables','public.engine_meals / public.manual_workout_sets'],unknown_components:['TOAST behavior for unusually large JSON','vacuum/free-space overhead','native connector high-frequency records','future audit/history retention'],photos_in_postgres:false,index_overhead_assumption:'35%-65% of modeled row bytes; range intentionally avoids false precision',measured_at:new Date().toISOString()};
  await writeFile(path.join(output,'storage-growth-model.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}finally{await pg?.close();}
