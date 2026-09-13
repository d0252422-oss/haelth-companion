// Deployed path: real SQL and existing verified Web sessions. No local issuer or startup DDL.
import postgres from 'npm:postgres@3.4.8';
import {LocalEngineRuntime} from './local-engine-runtime.ts';
import {verifyWebIdentity} from './index.ts';
type Env=(name:string)=>string|undefined;
export function validateHostedManualConfig(env:Env){
  if(env('HEALTH_MANUAL_SQL_HOSTED_ENABLED')!=='1')return null;
  const reject=()=>{throw Error('MANUAL_PROVIDER_NOT_CONFIGURED');};
  const project=env('HEALTH_MANUAL_EXPECTED_PROJECT_REF'),host=env('HEALTH_MANUAL_EXPECTED_DB_HOST');
  const origin=env('HEALTH_MANUAL_ALLOWED_ORIGIN'),release=env('HEALTH_MANUAL_RELEASE');
  if(env('HEALTH_ENGINE_LOCAL_ONLY')==='1'||!project||!/^[a-z]{20}$/.test(project)||!host
    ||env('SUPABASE_URL')!==`https://${project}.supabase.co`
    ||!/^aws-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)||!['A','AB'].includes(release||''))reject();
  let db:URL,web:URL,verifier:URL;
  try{db=new URL(env('HEALTH_MANUAL_DATABASE_URL')||'');web=new URL(origin||'');verifier=new URL(env('BETA_WEB_AUTH_VERIFY_URL')||'');}catch{return reject();}
  if(db!.protocol!=='postgresql:'||db!.hostname!==host||db!.port!=='6543'||db!.pathname!=='/postgres'
    ||decodeURIComponent(db!.username)!==`health_manual_api.${project}`||!db!.password||db!.search||db!.hash
    ||web!.protocol!=='https:'||web!.origin!==origin||web!.username||web!.password
    ||verifier!.protocol!=='https:'||verifier!.hostname!=='script.google.com'||!/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(verifier!.pathname)
    ||verifier!.username||verifier!.password||verifier!.search||verifier!.hash)reject();
  return {url:db!.href,origin:origin!,release:release as 'A'|'AB',project:project!,host:host!,login:'health_manual_api',verifier:verifier!.href};
}

// Every RPC/read/engine query, not just mutations, gets transaction-local role and limits.
// service_role execution is privileged; explicit canonical authorization remains necessary.
export function scopedManualSql(raw:any,expectedLogin='health_manual_api'){
  const begin=(optionsOrWork:string|((tx:any)=>Promise<any>),callback?:(tx:any)=>Promise<any>)=>{
   const options=typeof optionsOrWork==='string'?optionsOrWork:undefined,work=callback??optionsOrWork;
   if(typeof work!=='function'||(options&&options!=='isolation level repeatable read read only'))throw Error('UNSUPPORTED_MANUAL_TRANSACTION_OPTIONS');
   const run=async(tx:any)=>{
    await tx`select set_config('lock_timeout','2000',true),set_config('statement_timeout','10000',true),set_config('transaction_timeout','15000',true)`;
    const [role]=await tx`select session_user::text as login,rolsuper,rolbypassrls,rolinherit,
      pg_has_role(session_user,'service_role','SET') as can_set,
      pg_has_role(session_user,'service_role','USAGE') as inherits_privileges from pg_roles where rolname=session_user`;
    if(!role||role.login!==expectedLogin||role.rolsuper||role.rolbypassrls||role.rolinherit||role.inherits_privileges||!role.can_set)throw Error('MANUAL_DATABASE_ROLE_REJECTED');
    await tx.unsafe('set local role service_role');
    await tx`select set_config('health.engine.experimental','on',true),set_config('lock_timeout','2000',true),
      set_config('statement_timeout','10000',true),set_config('idle_in_transaction_session_timeout','10000',true),set_config('transaction_timeout','15000',true)`;
    return work(tx);
   };return options?raw.begin(options,run):raw.begin(run);
  };
  const sql:any=(...args:any[])=>begin(tx=>tx(...args));
  sql.begin=begin;sql.unsafe=(...args:any[])=>begin(tx=>tx.unsafe(...args));
  sql.json=(value:any)=>raw.json(value);sql.end=()=>raw.end();
  return sql;
}
export async function createHostedManualRuntime(raw:any,release:'A'|'AB',verify:typeof verifyWebIdentity){
  const sql=scopedManualSql(raw);
  try{
    await sql`select current_user`;
    const runtime=new LocalEngineRuntime({},async()=>{throw Error('INVALID_WEB_SESSION');},verify,{kind:'hosted',sql,release});
    await runtime.start();return runtime;
  }catch(error){await raw.end();throw error;}
}
let cached:Promise<LocalEngineRuntime>|undefined,fingerprint:string|undefined;
async function configuredRuntime(config:NonNullable<ReturnType<typeof validateHostedManualConfig>>){
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(config))))).map(v=>v.toString(16).padStart(2,'0')).join('');
  if(fingerprint&&fingerprint!==hash)throw Error('MANUAL_PROVIDER_ENVIRONMENT_CHANGED');
  fingerprint=hash;
  cached??=createHostedManualRuntime(postgres(config.url,{prepare:false,max:2,connect_timeout:5,idle_timeout:20,ssl:{rejectUnauthorized:true}}),config.release,verifyWebIdentity).catch(error=>{cached=undefined;throw error;});
  return await cached;
}
// Internal only: index.ts verifies worker secret/native session before claiming.
// No test issuer, second queue, re-claim or silent legacy fallback when enabled.
export async function processHostedClaimedScoreJob(job:Record<string,any>,token:string){
  const config=validateHostedManualConfig(name=>Deno.env.get(name));
  if(!config)throw Error('MANUAL_PROVIDER_DISABLED');
  return await(await configuredRuntime(config)).processClaimedJob(job,token);
}
export async function hostedManualBootstrap(request:Request):Promise<Response>{
  let config:ReturnType<typeof validateHostedManualConfig>;
  try{config=validateHostedManualConfig(name=>Deno.env.get(name));}catch{return Response.json({ok:false,error:'MANUAL_PROVIDER_NOT_CONFIGURED'},{status:503,headers:{'cache-control':'no-store'}});}
  if(!config)return Response.json({ok:false,error:'MANUAL_PROVIDER_DISABLED'},{status:503,headers:{'cache-control':'no-store'}});
  const origin=request.headers.get('origin');
  const headers={'access-control-allow-origin':config.origin,'access-control-allow-methods':'POST, OPTIONS',
    'access-control-allow-headers':'authorization, content-type, apikey, x-client-info, x-health-session-kind',vary:'Origin','cache-control':'no-store'};
  if(origin&&origin!==config.origin)return Response.json({ok:false,error:'ORIGIN_REJECTED'},{status:403,headers:{'cache-control':'no-store'}});
  if(request.method==='OPTIONS')return new Response(null,{status:origin?204:403,headers});
  if(request.method!=='POST')return Response.json({ok:false,error:'METHOD_NOT_ALLOWED'},{status:405,headers});
  try{
    const response=await(await configuredRuntime(config)).handle(request);
    return new Response(response.body,{status:response.status,headers:{...Object.fromEntries(response.headers),...headers}});
  }catch{return Response.json({ok:false,error:'MANUAL_PROVIDER_UNAVAILABLE',retryable:true},{status:503,headers});}
}
