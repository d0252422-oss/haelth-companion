// Configuration/route contracts only. No remote calls and no Edge claim.
import assert from 'node:assert/strict';
import {validateHostedManualConfig,hostedManualBootstrap,processHostedClaimedScoreJob} from '../supabase/functions/mobile-health-beta/hosted-manual-bootstrap.ts';
import {readManualRequest} from '../supabase/functions/mobile-health-beta/manual-request-body.ts';
const project='a'.repeat(20),host='aws-0-test.pooler.supabase.com';
Deno.test('manual ingress enforces byte limit and releases stalled body reader',async()=>{
 assert.deepEqual(await readManualRequest(new Request('https://unit.invalid',{method:'POST',body:'{"action":"read"}'})),{action:'read'});
 await assert.rejects(()=>readManualRequest(new Request('https://unit.invalid',{method:'POST',body:'x'.repeat(1048577)})),/BODY_TOO_LARGE/);
 let cancelled=false;const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}});
 await assert.rejects(()=>readManualRequest(new Request('https://unit.invalid',{method:'POST',body:stream}),25),/REQUEST_BODY_TIMEOUT/);assert.equal(cancelled,true);
});
const env:Record<string,string>={HEALTH_MANUAL_SQL_HOSTED_ENABLED:'1',HEALTH_MANUAL_RELEASE:'A',HEALTH_MANUAL_EXPECTED_PROJECT_REF:project,HEALTH_MANUAL_EXPECTED_DB_HOST:host,HEALTH_MANUAL_ALLOWED_ORIGIN:'https://synthetic.invalid',SUPABASE_URL:`https://${project}.supabase.co`,BETA_WEB_AUTH_VERIFY_URL:'https://script.google.com/macros/s/synthetic_only/exec',HEALTH_MANUAL_DATABASE_URL:`postgresql://health_manual_api.${project}:synthetic-local-unit@${host}:6543/postgres`};
Deno.test('hosted configuration default OFF and explicit project/role/TLS-origin guards',()=>{
 assert.equal(validateHostedManualConfig(()=>undefined),null);assert.equal(validateHostedManualConfig(k=>env[k])?.release,'A');
 for(const key of Object.keys(env).filter(k=>k!=='HEALTH_MANUAL_SQL_HOSTED_ENABLED'))assert.throws(()=>validateHostedManualConfig(k=>k===key?undefined:env[k]));
 for(const change of [{HEALTH_ENGINE_LOCAL_ONLY:'1'},{SUPABASE_URL:'https://another.invalid'},{HEALTH_MANUAL_RELEASE:'B'},{HEALTH_MANUAL_ALLOWED_ORIGIN:'http://localhost:57841'},{BETA_WEB_AUTH_VERIFY_URL:'https://user@script.google.com/macros/s/x/exec'}]){const changed:Record<string,string|undefined>={...env,...change};assert.throws(()=>validateHostedManualConfig(k=>changed[k]));}
 for(const url of [env.HEALTH_MANUAL_DATABASE_URL+'?sslmode=disable',env.HEALTH_MANUAL_DATABASE_URL.replace('health_manual_api','postgres'),env.HEALTH_MANUAL_DATABASE_URL.replace(':6543',':5432'),env.HEALTH_MANUAL_DATABASE_URL.replace(host,'127.0.0.1')])assert.throws(()=>validateHostedManualConfig(k=>k==='HEALTH_MANUAL_DATABASE_URL'?url:env[k]));
});
Deno.test('hosted disabled/malformed configuration, CORS and methods terminate without SQL',async()=>{
 const saved=Object.keys(env).concat('HEALTH_ENGINE_LOCAL_ONLY').map(k=>[k,Deno.env.get(k)] as const);
 try{
 for(const [k]of saved)Deno.env.delete(k);
 let r=await hostedManualBootstrap(new Request('https://unit.invalid/v1/engine/web',{method:'POST'}));assert.equal((await r.json()).error,'MANUAL_PROVIDER_DISABLED');assert.equal(r.headers.get('cache-control'),'no-store');
 await assert.rejects(()=>processHostedClaimedScoreJob({},'not-a-lease'),/MANUAL_PROVIDER_DISABLED/);
 Deno.env.set('HEALTH_MANUAL_SQL_HOSTED_ENABLED','1');r=await hostedManualBootstrap(new Request('https://unit.invalid',{method:'POST'}));assert.equal(r.status,503);
 await assert.rejects(()=>processHostedClaimedScoreJob({},'not-a-lease'),/MANUAL_PROVIDER_NOT_CONFIGURED/);
 for(const [k,v]of Object.entries(env))Deno.env.set(k,v);
 r=await hostedManualBootstrap(new Request('https://unit.invalid',{method:'OPTIONS',headers:{origin:env.HEALTH_MANUAL_ALLOWED_ORIGIN}}));assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),env.HEALTH_MANUAL_ALLOWED_ORIGIN);
 assert.equal((await hostedManualBootstrap(new Request('https://unit.invalid',{method:'OPTIONS',headers:{origin:'https://other.invalid'}}))).status,403);
 assert.equal((await hostedManualBootstrap(new Request('https://unit.invalid',{method:'GET'}))).status,405);
 }finally{for(const [k,v]of saved)v===undefined?Deno.env.delete(k):Deno.env.set(k,v);}
});
