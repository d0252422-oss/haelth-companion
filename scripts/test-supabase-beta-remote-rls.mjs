// Bounded Beta-only remote RLS test. Connections come from process memory and are never printed.
import {randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs';
import postgres from 'postgres';

const ref='uavimjgccigpbwqmfkhh',production='vptqedxdxfoohbqctujf';
const runtimeUrl=new URL(process.env.BETA_RUNTIME_DATABASE_URL||''),serviceKey=process.env.BETA_SERVICE_ROLE_KEY||'';
const host='aws-0-ap-southeast-1.pooler.supabase.com',caPath=process.env.BETA_DATABASE_CA;
if(ref===production||runtimeUrl.hostname!==host||runtimeUrl.pathname!=='/postgres'||serviceKey.length<40)throw Error('BETA_TARGET_DENIED');
if(decodeURIComponent(runtimeUrl.username)!==`health_manual_api.${ref}`)throw Error('DATABASE_ROLE_DENIED');
if(!caPath||!fs.statSync(caPath).isFile())throw Error('OFFICIAL_CA_REQUIRED');
const ssl={rejectUnauthorized:true,ca:fs.readFileSync(caPath,'utf8')};
const runtime=postgres(runtimeUrl.href,{ssl,prepare:false,max:1});
const A=randomUUID(),B=randomUUID(),record=randomUUID(),runId='beta-risk-'+randomUUID();
const hash=value=>createHash('sha256').update(runId+':'+value).digest('hex');
const identities={A:{id:A,subject:hash('subject-A'),email:hash('email-A')},B:{id:B,subject:hash('subject-B'),email:hash('email-B')}};
const report={target:ref,run_id:runId,status:'FAIL',writes:0,deletions:0,checks:{}};
const rpc=async(name,body)=>{const response=await fetch(`https://${ref}.supabase.co/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:serviceKey,authorization:`Bearer ${serviceKey}`,'content-type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw Error(`ADMIN_RPC_${name}_${response.status}`);return response.json();};
const denied=async work=>{try{await work();return false;}catch(error){return ['42501','23514'].includes(error.code)||/permission|policy/i.test(error.message);}};
const scoped=(identity,work)=>runtime.begin(async tx=>{await tx`select set_config('health.manual.subject',${identity.subject},true),set_config('health.manual.email',${identity.email},true)`;return work(tx);});
try{
 for(const [label,i] of Object.entries(identities)){await rpc('beta_admin_seed_synthetic_identity',{p_user_id:i.id,p_external_hash:hash('external-'+label),p_subject_hash:i.subject,p_email_hash:i.email,p_run_id:runId});report.writes+=3;}
 const role=(await runtime`select current_user::text,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication from pg_roles where rolname=current_user`)[0];
 report.checks.low_privilege=role.current_user==='health_manual_api'&&['rolsuper','rolbypassrls','rolcreatedb','rolcreaterole','rolreplication'].every(k=>role[k]===false);
 report.checks.a_entitled=await scoped(identities.A,async tx=>(await tx`select access_status from private.resolve_user_entitlement()`)[0]?.access_status==='BETA');
 await scoped(identities.A,tx=>tx`insert into public.engine_manual_body_records(canonical_user_id,record_id,revision,local_date,body) values(${A},${record},1,current_date,${tx.json({source:'MANUAL_WEB',weight:70,runId})})`);report.writes++;
 report.checks.a_write_a=await scoped(identities.A,async tx=>(await tx`select count(*)::int as n from public.engine_manual_body_records where record_id=${record}`)[0].n===1);
 report.checks.b_read_a=await scoped(identities.B,async tx=>(await tx`select count(*)::int as n from public.engine_manual_body_records where record_id=${record}`)[0].n===0);
 report.checks.a_write_b_denied=await denied(()=>scoped(identities.A,tx=>tx`insert into public.engine_manual_body_records(canonical_user_id,record_id,revision,local_date,body) values(${B},${randomUUID()},1,current_date,${tx.json({source:'MANUAL_WEB',weight:71,runId})})`));
 report.checks.missing_context_denied=(await runtime`select count(*)::int as n from private.resolve_user_entitlement()`)[0].n===0;
 report.checks.entitlement_mutation_denied=await denied(()=>scoped(identities.A,tx=>tx`update private.user_entitlements set access_status='PAID' where user_id=${A}`));
 if(!Object.values(report.checks).every(Boolean))throw Error('REMOTE_RLS_CHECK_FAILED');
 report.status='PASS';
}finally{
 try{for(const i of Object.values(identities)){await rpc('beta_admin_cleanup_synthetic_identity',{p_user_id:i.id,p_run_id:runId});report.deletions+=4;}}catch(error){report.cleanup_error=error.message||'CLEANUP_FAILED';report.status='FAIL';}
 await runtime.end();
 console.log(JSON.stringify(report));
}
if(report.status!=='PASS')process.exitCode=1;
