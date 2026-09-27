// Exercises the exact candidate migration through the reviewed Supabase CLI
// against three owned disposable PostgreSQL databases. No remote URL, profile,
// token, password, or project is read.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import {createLocalPostgres} from './local-engine-postgres.mjs';

const reviewedCliVersion='2.115.0';
const reviewedCliExecutable='C:/Users/D0252/scoop/apps/supabase/2.115.0/supabase.exe';
const reviewedCliSha256='691a3312584891204dc11893abcd12fa656dbcce186ef8d0a2782f137463f6d7';
assert.equal(createHash('sha256').update(await readFile(reviewedCliExecutable)).digest('hex'),reviewedCliSha256,'UNREVIEWED_SUPABASE_CLI_BINARY');
const migrationName='20260920224000_manual_workout_set_order.sql';
const migrationBytes=await readFile(path.join('supabase/migrations',migrationName));
const migrationSha256=createHash('sha256').update(migrationBytes).digest('hex');
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const workingTreeClean=execFileSync('git',['status','--porcelain=v1','--untracked-files=all'],{encoding:'utf8'}).trim()==='';
const evidenceRoot=path.resolve(process.env.CORE_RELEASE_CLI_MIGRATION_EVIDENCE_DIR||'D:/Dev/Evidence/core-release-candidate-20260927/cli-migration');
assert.ok(evidenceRoot.toLowerCase().startsWith('d:\\dev\\evidence\\'),'D-drive evidence path required');
const runId=randomUUID(),runRoot=path.join(evidenceRoot,runId),workdir=path.join(runRoot,'workdir');
await mkdir(path.join(workdir,'supabase/migrations'),{recursive:true});
await writeFile(path.join(workdir,'supabase/config.toml'),'project_id = "core-release-cli-local-test"\n\n[db]\nmajor_version = 17\n\n[db.migrations]\nenabled = true\nschema_paths = []\n\n[db.seed]\nenabled = false\n');
await writeFile(path.join(workdir,'supabase/migrations',migrationName),migrationBytes);

const version=execFileSync(reviewedCliExecutable,['--version'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
assert.equal(version,reviewedCliVersion,'UNREVIEWED_SUPABASE_CLI_VERSION');
const fixture=await createLocalPostgres({port:57484,release:'A'});
const owner=postgres({host:'127.0.0.1',port:57484,username:'engine_owner',database:'postgres',max:1});
const successDb='cli_success_'+runId.replaceAll('-',''),failureDb='cli_failure_'+runId.replaceAll('-',''),ledgerLockDb='cli_ledger_'+runId.replaceAll('-','');
const user='41000000-0000-4000-8000-000000000001',session='42000000-0000-4000-8000-000000000001';

const invoke=(database,expectSuccess)=>{
  const url=`postgresql://engine_owner@127.0.0.1:57484/${database}?sslmode=disable`;
  assert.match(url,/^postgresql:\/\/engine_owner@127\.0\.0\.1:57484\//u);
  try{
    const stdout=execFileSync(reviewedCliExecutable,['db','push','--db-url',url,'--skip-vault','--workdir',workdir,'--yes'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000});
    assert.equal(expectSuccess,true,'CLI_MIGRATION_FAILURE_EXPECTED');return {status:0,stdout};
  }catch(error){
    assert.equal(expectSuccess,false,'CLI_MIGRATION_UNEXPECTED_FAILURE');return {status:error.status,stdout:String(error.stdout||''),stderr:String(error.stderr||'')};
  }
};
async function setup(database,{preexistingOrder=false}={}){
  await owner.unsafe(`create database ${database}`);
  const sql=postgres({host:'127.0.0.1',port:57484,username:'engine_owner',database,max:1});
  await sql.unsafe(`create table public.manual_workout_sets(
    canonical_user_id uuid not null,
    session_id uuid not null,
    deleted boolean not null default false${preexistingOrder?', set_order integer':''}
  )`);
  if(preexistingOrder)await sql`insert into public.manual_workout_sets(canonical_user_id,session_id,set_order) values(${user},${session},1),(${user},${session},1)`;
  else await sql`insert into public.manual_workout_sets(canonical_user_id,session_id) values(${user},${session}),(${user},${session})`;
  return sql;
}

let success,failure,ledger,locker;
try{
  success=await setup(successDb);failure=await setup(failureDb,{preexistingOrder:true});ledger=await setup(ledgerLockDb);
  const successResult=invoke(successDb,true);
  const successShape=(await success`select
    (select count(*)::int from public.manual_workout_sets) as row_count,
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='manual_workout_sets' and column_name='set_order') as has_column,
    exists(select 1 from pg_constraint where conrelid='public.manual_workout_sets'::regclass and conname='manual_workout_sets_set_order_positive') as has_constraint,
    exists(select 1 from pg_indexes where schemaname='public' and tablename='manual_workout_sets' and indexname='manual_workout_set_order_unique') as has_index`)[0];
  assert.deepEqual(successShape,{row_count:2,has_column:true,has_constraint:true,has_index:true});
  const successHistory=Array.from(await success`select version,name from supabase_migrations.schema_migrations order by version`,row=>({version:row.version,name:row.name}));
  assert.deepEqual(successHistory,[{version:'20260920224000',name:'manual_workout_set_order'}]);

  const failureResult=invoke(failureDb,false);
  assert.match(failureResult.stderr+failureResult.stdout,/duplicate key|23505/iu,'EXPECTED_UNIQUE_FAILURE_NOT_OBSERVED');
  const failureShape=(await failure`select
    (select count(*)::int from public.manual_workout_sets) as row_count,
    exists(select 1 from pg_constraint where conrelid='public.manual_workout_sets'::regclass and conname='manual_workout_sets_set_order_positive') as has_constraint,
    exists(select 1 from pg_indexes where schemaname='public' and tablename='manual_workout_sets' and indexname='manual_workout_set_order_unique') as has_index,
    to_regclass('supabase_migrations.schema_migrations') is not null as has_history_table`)[0];
  assert.deepEqual({row_count:failureShape.row_count,has_constraint:failureShape.has_constraint,has_index:failureShape.has_index},{row_count:2,has_constraint:false,has_index:false});
  const failedHistory=failureShape.has_history_table?Array.from(await failure`select version,name from supabase_migrations.schema_migrations where version='20260920224000'`,row=>({version:row.version,name:row.name})) : [];
  assert.deepEqual(failedHistory,[],'failed schema transaction must not receive a migration history row');

  await ledger.unsafe(`create schema supabase_migrations;create table supabase_migrations.schema_migrations(
    version text primary key, statements text[], name text
  )`);
  locker=postgres({host:'127.0.0.1',port:57484,username:'engine_owner',database:ledgerLockDb,max:1});
  let lockedResolve,releaseLock;const locked=new Promise(resolve=>{lockedResolve=resolve;}),hold=new Promise(resolve=>{releaseLock=resolve;});
  const lockTask=locker.begin(async tx=>{await tx.unsafe('lock table supabase_migrations.schema_migrations in share mode');lockedResolve();await hold;});
  await locked;const lockStarted=performance.now();const ledgerResult=invoke(ledgerLockDb,false),lockElapsedMs=Math.round(performance.now()-lockStarted);releaseLock();await lockTask;
  assert.match(ledgerResult.stderr+ledgerResult.stdout,/lock timeout|55P03/iu,'EXPECTED_LEDGER_LOCK_TIMEOUT_NOT_OBSERVED');
  assert.ok(lockElapsedMs>=4000&&lockElapsedMs<15000,`LEDGER_LOCK_TIMEOUT_NOT_BOUNDED: ${lockElapsedMs}`);
  const ledgerShape=(await ledger`select
    (select count(*)::int from public.manual_workout_sets) as row_count,
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='manual_workout_sets' and column_name='set_order') as has_column,
    (select count(*)::int from supabase_migrations.schema_migrations where version='20260920224000') as history_count`)[0];
  assert.deepEqual(ledgerShape,{row_count:2,has_column:false,history_count:0},'ledger timeout must roll back schema and history together');

  const report={status:'PASS',remote:false,sourceCommit,workingTreeClean,migration:{name:migrationName,sha256:migrationSha256},cli:{version,executable:reviewedCliExecutable,sha256:reviewedCliSha256,command:'db push --db-url LOOPBACK --skip-vault --workdir OWNED --yes'},
    success:{exitStatus:successResult.status,shape:successShape,history:successHistory},
    failure:{exitStatus:failureResult.status,shape:failureShape,history:failedHistory,expected:'23505 inside atomic DO'},
    ledgerLock:{exitStatus:ledgerResult.status,elapsedMs:lockElapsedMs,shape:ledgerShape,expected:'55P03 bounded history lock timeout'},
    assertions:['CLI 2.115 accepts session timeouts','schema DDL succeeds atomically','row count preserved','exact migration history recorded','injected preexisting duplicate makes exact migration fail','failed DO rolls back its constraint and index','failed migration gets no history row','history lock timeout remains bounded','history timeout rolls back schema and ledger together']};
  await writeFile(path.join(runRoot,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:'PASS',report:path.join(runRoot,'report.json')}));
}finally{
  await success?.end();await failure?.end();await ledger?.end();await locker?.end();await owner.end();await fixture.close();
}
