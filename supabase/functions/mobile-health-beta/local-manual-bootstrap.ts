// CLI-local Edge rehearsal only; no test issuer, subprocess, remote worker or auth bypass.
import { LocalEngineRuntime } from './local-engine-runtime.ts';
import {verifyWebIdentity} from './index.ts';
import postgres from 'npm:postgres@3.4.8';
import {createHostedManualRuntime} from './hosted-manual-bootstrap.ts';
let runtime: Promise<LocalEngineRuntime> | undefined;
let runtimeFingerprint: string | undefined;
export async function localManualEnvironmentFingerprint(config: Record<string,any>, env:(name:string)=>string|undefined) {
  // Kept only in memory; never log credentials or add this to evidence.
  const source=JSON.stringify([config,...['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEYS','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEYS','SUPABASE_SECRET_KEY','HEALTH_MANUAL_WEB_SESSION_LOCAL','BETA_WEB_AUTH_VERIFY_URL'].map(env)]);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source)))).map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function validateLocalManualConfig(config: Record<string, any>, env: (name:string)=>string|undefined) {
  const url=new URL(env('SUPABASE_URL')||'https://invalid.invalid');
  if(env('HEALTH_ENGINE_LOCAL_ONLY')!=='1'||env('DENO_DEPLOYMENT_ID')||env('HEALTH_MANUAL_EDGE_REHEARSAL')!=='1'
    ||url.protocol!=='http:'||url.pathname!=='/'||url.username||url.password||url.search||url.hash||!(/^(127\.0\.0\.1|localhost|host\.docker\.internal|supabase_kong_[a-z0-9_-]+)$/.test(url.hostname))
    ||!['127.0.0.1','host.docker.internal'].includes(config.host)||![57483,57484,57485].includes(config.port)
    ||!/^health_engine_[a-f0-9]{32}$/.test(config.database)||!['service_role','health_manual_api'].includes(config.username)
    ||config.path||config.socket||config.ssl||config.password)throw Error('UNSAFE_LOCAL_EDGE_CONFIGURATION');
  return {host:config.host,port:config.port,database:config.database,username:config.username};
}
export async function localManualBootstrap(request: Request, admin: any): Promise<Response|null> {
  const source=Deno.env.get('HEALTH_MANUAL_SQL_LOCAL_CONFIG');
  if(!source)return null;
  const config=validateLocalManualConfig(JSON.parse(source),name=>Deno.env.get(name));
  const fingerprint=await localManualEnvironmentFingerprint(config,name=>Deno.env.get(name));
  if(runtimeFingerprint!==undefined&&runtimeFingerprint!==fingerprint)throw Error('LOCAL_RUNTIME_ENVIRONMENT_CHANGED');
  runtimeFingerprint=fingerprint;
  // admin client is environment-bound, never user/session-bound. Token verified per request.
  runtime??=(async()=>{if(config.username==='health_manual_api')return await createHostedManualRuntime(postgres({...config,max:2,prepare:false,connect_timeout:5,idle_timeout:20}),Deno.env.get('HEALTH_EXERCISE_MANAGEMENT_LOCAL')==='1'?'AB':'A',verifyWebIdentity);
  const instance=new LocalEngineRuntime(config,async token=>{
    const {data,error}=await admin.auth.getUser(token);
    if(error&&(error.status===0||error.status>=500))throw Error('AUTH_SERVICE_UNAVAILABLE');
    if(error||!data?.user)throw Error('INVALID_SUPABASE_SESSION');
    return data.user;
  },verifyWebIdentity);await instance.start();return instance;})();
  return (await runtime).handle(request);
}
