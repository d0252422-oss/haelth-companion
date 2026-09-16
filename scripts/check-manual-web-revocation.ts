// Repository/transaction test only; invoked inside the owned synthetic PG rehearsal.
import assert from 'node:assert/strict';
import postgres from 'npm:postgres@3.4.8';
import {LocalEngineRuntime} from '../supabase/functions/mobile-health-beta/local-engine-runtime.ts';
import {createHostedManualRuntime} from '../supabase/functions/mobile-health-beta/hosted-manual-bootstrap.ts';
import {resolveVerifiedManualWebIdentity} from '../supabase/functions/mobile-health-beta/manual-web-identity.ts';
import subjects from '../fixtures/engine-local-identities.json' with {type:'json'};
const config=JSON.parse(await Deno.readTextFile(Deno.args[0]));
if(Deno.env.get('HEALTH_ENGINE_LOCAL_ONLY')!=='1'||config.host!=='127.0.0.1'||![57483,57484,57485].includes(config.port)||!/^health_engine_[a-f0-9]{32}$/.test(config.database)||config.username!=='service_role')throw Error('UNSAFE_TEST_DATABASE');
const admin=postgres({...config,username:'engine_owner',max:1});
const nonprivileged=Deno.args.includes('--nonprivileged');
const runtime=nonprivileged?await createHostedManualRuntime(postgres({...config,username:'health_manual_api',max:1}), 'AB',()=>Promise.reject(Error('HTTP_AUTH_NOT_PART_OF_REPOSITORY_TEST'))):new LocalEngineRuntime(config,()=>Promise.reject(Error('HTTP_AUTH_NOT_PART_OF_REPOSITORY_TEST')));
const before=(await admin`select status from public.users where id=${subjects.A.canonical}`)[0].status;
assert.equal(before,'ACTIVE');
const identity=await resolveVerifiedManualWebIdentity(runtime.sql,{subject:'web-session-'+subjects.A.auth,email:'a@example.invalid'});
const payload={clientRequestId:crypto.randomUUID()},checks:string[]=[];
try{
  await admin`update public.users set status='REVOKED' where id=${subjects.A.canonical}`;
  for(const [name,read]of [
    ['engine_read',()=>runtime.read(identity,'engine_meals')],
    ['snapshot_queue',()=>runtime.snapshot(identity)],
    ['legacy_timeline',()=>runtime.legacyTimeline(identity)],
    ['meal_receipt',()=>runtime.mealWriteStatus(identity,payload)],
    ['body_read',()=>runtime.manualBody.read(identity,{})],
    ['body_receipt',()=>runtime.manualBody.status(identity,payload)],
    ['catalog',()=>runtime.manualTraining.catalog(identity)],
    ['workouts',()=>runtime.manualTraining.workouts(identity,{})],
    ['training_receipt',()=>runtime.manualTraining.status(identity,payload)],
  ] as const){await assert.rejects(()=>nonprivileged?runtime.sql.withWeb(identity,read):read(),/WEB_IDENTITY_INACTIVE/);checks.push(name);}
}finally{await admin`update public.users set status=${before} where id=${subjects.A.canonical}`;await runtime.close();await admin.end();}
console.log(JSON.stringify({status:'PASS',checks,role:nonprivileged?'health_manual_api NOBYPASSRLS; mapping rechecked after initial resolution':'service_role BYPASSRLS; explicit Web mapping rechecked after initial resolution',database:config.database,real_oauth:'NOT_RUN'}));
