// Owns a disposable native PostgreSQL process; never reads DATABASE_URL or remote config.
import {spawnSync} from 'node:child_process';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import postgres from 'postgres';
import subjects from '../fixtures/engine-local-identities.json' with {type:'json'};
import {manualReleaseIncludesMigration} from './manual-release-migrations.mjs';

export {subjects};
export async function createLocalPostgres({port=57483,release=process.env.LOCAL_ENGINE_RELEASE||'AB',beforeMigration,includeMigration}={}){
  const root=path.resolve('.engine-artifacts/runtime-e2e/pg-'+randomUUID());
  await mkdir(root,{recursive:true});
  // Explicit official portable binary only; old npm18.4 is retained but not executed (CVE-2026-16239).
  if(!process.env.LOCAL_ENGINE_PG_BIN || !path.isAbsolute(process.env.LOCAL_ENGINE_PG_BIN))throw Error('PATCHED_POSTGRES_BIN_REQUIRED');
  const bin=path.resolve(process.env.LOCAL_ENGINE_PG_BIN);
  const invoke=(exe,args)=>{const r=spawnSync(path.join(bin,exe+'.exe'),args,{windowsHide:true,encoding:'utf8',timeout:60000});if(r.status!==0)throw new Error(exe+' failed: '+r.stderr);return r.stdout;};
  const binaryVersion=invoke('postgres',['--version']).trim();
  const version=/PostgreSQL\) (\d+)\.(\d+)/.exec(binaryVersion);
  const expectedMajor=Number(process.env.LOCAL_ENGINE_PG_MAJOR||18);
  if(!version || ![17,18].includes(expectedMajor)||Number(version[1])!==expectedMajor || Number(version[2])<(expectedMajor===17?11:6))throw Error('REVIEWED_PATCHED_POSTGRES_REQUIRED');
  if(![57483,57484,57485].includes(port)||!['A','AB'].includes(release))throw Error('INVALID_LOCAL_TEST_CONFIGURATION');
  invoke('initdb',['-D',path.join(root,'data'),'-U','engine_owner','--auth=trust','--encoding=UTF8','--locale=C']);
  invoke('pg_ctl',['-D',path.join(root,'data'),'-l',path.join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
  const config={host:'127.0.0.1',port,username:'engine_owner',database:'postgres',max:1};
  let admin=postgres(config);
  const dbName='health_engine_'+randomUUID().replaceAll('-','');
  await admin.unsafe(`create database ${dbName}`);await admin.end();
  config.database=dbName;admin=postgres(config);
  const evidence={root,port,database:dbName,synthetic_only:true,remote:false,binary:bin,binary_version:binaryVersion,expected_major:expectedMajor,release,migrations:[],omitted_migrations:[],started_at:new Date().toISOString()};
  try {
    await admin.unsafe(`create role anon nologin;create role authenticated nologin;create role service_role login bypassrls;
      create schema auth;create schema extensions;create extension pgcrypto with schema extensions;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create table auth.identities(id uuid primary key,user_id uuid references auth.users(id),provider text);
      create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
      grant usage on schema public,auth to anon,authenticated,service_role;
      grant execute on function auth.uid() to authenticated;grant authenticated to service_role;`);
    for(const filename of (await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort()){
      if(!manualReleaseIncludesMigration(filename,release) || (includeMigration && !includeMigration(filename))){evidence.omitted_migrations.push(filename);continue;}
      if(beforeMigration)await beforeMigration({filename,admin,evidence});
      let source=await readFile('supabase/migrations/'+filename,'utf8');
      const digest=createHash('sha256').update(source).digest('hex');
      if(filename.includes('durable_beta_score_processor')){
        // Keep actual queue/lease/retry functions. Omit unavailable outbound cron/net/vault only.
        source=source.replace(/^create extension .*;\r?\n/gm,'')
          .replace(/create or replace function public.beta_authorize_score_worker[\s\S]*?\$\$;/,'')
          .replace(/^.*(?:revoke|grant).*beta_authorize_score_worker.*\r?\n/gm,'')
          .split('do $job$')[0];
      }
      await admin.begin(tx=>tx.unsafe(source));
      evidence.migrations.push({filename,sha256:digest,scope:filename.includes('durable_beta_score_processor')?'QUEUE_ONLY_OUTBOUND_SCHEDULER_OMITTED':'FULL'});
    }
    await admin.unsafe('grant usage on schema private to service_role');
    for(const [name,user] of Object.entries(subjects)){
      await admin`insert into auth.users values(${user.auth},${name.toLowerCase()+'@example.invalid'},now())`;
      await admin`insert into auth.identities values(${randomUUID()},${user.auth},'google')`;
      if(user.canonical){
        await admin`insert into public.users(id,external_subject_hash,timezone) values(${user.canonical},${createHash('sha256').update(name).digest('hex')},'Asia/Taipei')`;
        await admin`insert into private.beta_native_auth_identities(auth_user_id,canonical_user_id,provider) values(${user.auth},${user.canonical},'google')`;
        await admin`insert into private.user_entitlements(user_id,access_status,source,metadata) values(${user.canonical},'BETA','MANUAL_BETA',${admin.json({synthetic:true,fixture:name})})`;
      }
    }
    evidence.server=(await admin`select version(),inet_server_addr()::text as address,current_database() as database`)[0];
    evidence.extensions=await admin`select extname,extversion from pg_extension order by extname`;
    evidence.platform_boundary={auth_schema:'SYNTHETIC_CONTRACT_FIXTURE_NOT_SUPABASE_AUTH_SERVER',unavailable_extensions:['pg_cron','pg_net','supabase_vault'],outbound_scheduler:'OMITTED_NOT_REPLACED_WITH_FAKE_FUNCTIONS'};
    const before=(await admin`select count(*)::int as n from public.users`)[0].n;let faultCode;
    try{await admin.begin(async tx=>{await tx.unsafe('create table public.synthetic_failed_migration_probe(id int)');await tx.unsafe('select * from public.synthetic_deliberately_missing_relation');});}
    catch(error){faultCode=error.code;}
    if(faultCode!=='42P01'||(await admin`select to_regclass('public.synthetic_failed_migration_probe') as name`)[0].name!==null||(await admin`select count(*)::int as n from public.users`)[0].n!==before)throw Error('MIGRATION_FAILURE_NOT_ATOMIC');
    evidence.migration_failure_probe={sqlstate:faultCode,ddl_rolled_back:true,existing_users_preserved:true,rollback_strategy:'transaction per migration; retain previous committed schema, never reset database'};
    await writeFile(path.join(root,'ownership.json'),JSON.stringify(evidence,null,2));
    return {admin,config:{...config,username:'service_role',max:8},evidence,
      async close(){await admin.end();invoke('pg_ctl',['-D',path.join(root,'data'),'-w','stop','-m','fast']);}};
  }catch(error){await admin.end();invoke('pg_ctl',['-D',path.join(root,'data'),'-w','stop','-m','fast']);throw error;}
}
