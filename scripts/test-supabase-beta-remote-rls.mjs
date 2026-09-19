// Bounded Beta-only remote RLS test. Connections come from process memory and are never printed.
import {randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs';
import postgres from 'postgres';

const ref='uavimjgccigpbwqmfkhh',production='vptqedxdxfoohbqctujf';
const adminUrl=new URL(process.env.BETA_ADMIN_DATABASE_URL||''),runtimeUrl=new URL(process.env.BETA_RUNTIME_DATABASE_URL||'');
const host='aws-0-ap-southeast-1.pooler.supabase.com',caPath=process.env.BETA_DATABASE_CA;
if(ref===production||adminUrl.hostname!==host||runtimeUrl.hostname!==host||adminUrl.pathname!=='/postgres'||runtimeUrl.pathname!=='/postgres')throw Error('BETA_TARGET_DENIED');
if(decodeURIComponent(adminUrl.username)!==`cli_login_postgres.${ref}`||decodeURIComponent(runtimeUrl.username)!==`health_manual_api.${ref}`)throw Error('DATABASE_ROLE_DENIED');
if(!caPath||!fs.statSync(caPath).isFile())throw Error('OFFICIAL_CA_REQUIRED');
const ssl={rejectUnauthorized:true,ca:fs.readFileSync(caPath,'utf8')};
const admin=postgres(adminUrl.href,{ssl,prepare:false,max:1}),runtime=postgres(runtimeUrl.href,{ssl,prepare:false,max:1});
const A=randomUUID(),B=randomUUID(),record=randomUUID(),runId='beta-risk-'+randomUUID();
const hash=value=>createHash('sha256').update(runId+':'+value).digest('hex');
const identities={A:{id:A,subject:hash('subject-A'),email:hash('email-A')},B:{id:B,subject:hash('subject-B'),email:hash('email-B')}};
const report={target:ref,run_id:runId,status:'FAIL',writes:0,deletions:0,checks:{}};
const denied=async work=>{try{await work();return false;}catch(error){return ['42501','23514'].includes(error.code)||/permission|policy/i.test(error.message);}};
const scoped=(identity,work)=>runtime.begin(async tx=>{await tx`select set_config('health.manual.subject',${identity.subject},true),set_config('health.manual.email',${identity.email},true)`;return work(tx);});
try{
 await admin.begin(async tx=>{for(const [label,i] of Object.entries(identities)){await tx`insert into public.users(id,external_subject_hash,status,timezone) values(${i.id},${hash('external-'+label)},'ACTIVE','Asia/Taipei')`;await tx`insert into private.beta_web_identity_aliases(web_subject_hash,verified_email_hash,canonical_user_id) values(${i.subject},${i.email},${i.id})`;await tx`insert into private.user_entitlements(user_id,access_status,source,metadata) values(${i.id},'BETA','MANUAL_BETA',${tx.json({synthetic:true,runId})})`;report.writes+=3;}});
 const role=(await runtime`select current_user::text,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication from pg_roles where rolname=current_user`)[0];
 report.checks.low_privilege=role.current_user==='health_manual_api'&&['rolsuper','rolbypassrls','rolcreatedb','rolcreaterole','rolreplication'].every(k=>role[k]===false);
 report.checks.a_entitled=await scoped(identities.A,async tx=>(await tx`select access_status from private.resolve_user_entitlement()`)[0]?.access_status==='BETA');
 await scoped(identities.A,tx=>tx`insert into public.engine_manual_body_records(canonical_user_id,record_id,revision,local_date,body) values(${A},${record},1,current_date,${tx.json({source:'MANUAL_WEB',weight:70,runId})})`);report.writes++;
 report.checks.a_write_a=await scoped(identities.A,async tx=>(await tx`select count(*)::int as n from public.engine_manual_body_records where record_id=${record}`)[0].n===1);
 report.checks.b_read_a=await scoped(identities.B,async tx=>(await tx`select count(*)::int as n from public.engine_manual_body_records where record_id=${record}`)[0].n===0);
 report.checks.a_write_b_denied=await denied(()=>scoped(identities.A,tx=>tx`insert into public.engine_manual_body_records(canonical_user_id,record_id,revision,local_date,body) values(${B},${randomUUID()},1,current_date,${tx.json({source:'MANUAL_WEB',weight:71,runId})})`));
 report.checks.missing_context_denied=(await runtime`select count(*)::int as n from private.resolve_user_entitlement()`)[0].n===0;
 report.checks.entitlement_mutation_denied=await denied(()=>scoped(identities.A,tx=>tx`update private.user_entitlements set access_status='PAID' where user_id=${A}`));
 await admin`update private.user_entitlements set access_status='SUSPENDED' where user_id=${B}`;report.writes++;
 report.checks.suspended_denied=await scoped(identities.B,async tx=>(await tx`select access_status from private.resolve_user_entitlement()`)[0]?.access_status==='SUSPENDED');
 if(!Object.values(report.checks).every(Boolean))throw Error('REMOTE_RLS_CHECK_FAILED');
 report.status='PASS';
}finally{
 try{await admin.begin(async tx=>{const body=await tx`delete from public.engine_manual_body_records where canonical_user_id in (${A},${B}) and body->>'runId'=${runId}`;const ent=await tx`delete from private.user_entitlements where user_id in (${A},${B}) and metadata->>'runId'=${runId}`;const aliases=await tx`delete from private.beta_web_identity_aliases where canonical_user_id in (${A},${B})`;const users=await tx`delete from public.users where id in (${A},${B})`;report.deletions=body.count+ent.count+aliases.count+users.count;});}catch(error){report.cleanup_error=error.code||'CLEANUP_FAILED';report.status='FAIL';}
 await Promise.allSettled([runtime.end(),admin.end()]);
 console.log(JSON.stringify(report));
}
if(report.status!=='PASS')process.exitCode=1;
