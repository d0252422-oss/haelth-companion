// Request async context is in memory; only verified server-derived hashes enter SQL.
// No client canonical ID, shared mutable current-user field, or elevated role.
import {AsyncLocalStorage} from 'node:async_hooks';
type Context={webSubjectHash:string;emailHash:string};
export function scopedManualSql(raw:any,expectedLogin='health_manual_api'){
 const contexts=new AsyncLocalStorage<Context>();
 const begin=(optionsOrWork:string|((tx:any)=>Promise<any>),callback?:(tx:any)=>Promise<any>)=>{
  const options=typeof optionsOrWork==='string'?optionsOrWork:undefined,work=callback??optionsOrWork;
  if(typeof work!=='function'||(options&&options!=='isolation level repeatable read read only'))throw Error('UNSUPPORTED_MANUAL_TRANSACTION_OPTIONS');
  const context=contexts.getStore();
  const run=async(tx:any)=>{
   const [role]=await tx`select session_user::text as login,current_user::text as effective,
    rolsuper,rolbypassrls,rolinherit,rolcreatedb,rolcreaterole,rolreplication,
    exists(select 1 from pg_auth_members where member=(select oid from pg_roles where rolname=session_user)) as has_membership
    from pg_roles where rolname=session_user`;
   if(!role||role.login!==expectedLogin||role.effective!==expectedLogin||['rolsuper','rolbypassrls','rolinherit','rolcreatedb','rolcreaterole','rolreplication','has_membership'].some(k=>role[k]))throw Error('MANUAL_DATABASE_ROLE_REJECTED');
   await tx`select set_config('health.manual.subject',${context?.webSubjectHash||''},true),
    set_config('health.manual.email',${context?.emailHash||''},true),
    set_config('health.engine.experimental','on',true),set_config('lock_timeout','2000',true),
    set_config('statement_timeout','10000',true),set_config('idle_in_transaction_session_timeout','10000',true),set_config('transaction_timeout','15000',true)`;
   tx.manualNonPrivileged=true;
   return work(tx);
  };return options?raw.begin(options,run):raw.begin(run);
 };
 const sql:any=(...args:any[])=>begin(tx=>tx(...args));sql.begin=begin;sql.unsafe=(...args:any[])=>begin(tx=>tx.unsafe(...args));
 sql.json=(v:any)=>raw.json(v);sql.end=()=>raw.end();
 sql.withWeb=(identity:Context,work:()=>Promise<any>)=>{
  if(!identity||![identity.webSubjectHash,identity.emailHash].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)))throw Error('INVALID_WEB_SESSION_IDENTITY');
  return contexts.run(Object.freeze({webSubjectHash:identity.webSubjectHash,emailHash:identity.emailHash}),work);
 };
 return sql;
}
