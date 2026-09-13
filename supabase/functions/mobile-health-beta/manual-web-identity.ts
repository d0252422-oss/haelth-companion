// Existing verified Web-session mapping, read-only: never call the alias-writing RPC.
type Json=Record<string,any>;
const sha=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(b=>b.toString(16).padStart(2,'0')).join('');
export async function resolveVerifiedManualWebIdentity(sql:any,verified:{subject:string,email:string}) {
  if(typeof verified.subject!=='string'||!verified.subject||verified.subject.length>256||typeof verified.email!=='string'||!verified.email.trim()||verified.email.length>320)throw Error('INVALID_WEB_SESSION_IDENTITY');
  const identity={kind:'web',webSubjectHash:await sha(verified.subject),emailHash:await sha(verified.email.trim().toLowerCase())};
  return await sql.begin(async(tx:any)=>{await tx.unsafe('set transaction read only');return await checkManualWebMapping(tx,identity);});
}
export async function checkManualWebMapping(tx:any,identity:Json,lock=false) {
  const columns=`select a.web_subject_hash,a.verified_email_hash,a.canonical_user_id,a.provider,a.environment,u.status
    from private.beta_web_identity_aliases a join public.users u on u.id=a.canonical_user_id
    where a.web_subject_hash=$1 or a.verified_email_hash=$2 limit 3`;
  const rows=await tx.unsafe(columns+(lock?' for share of a,u':''),[identity.webSubjectHash,identity.emailHash]);
  if(!rows.length)throw Error('WEB_IDENTITY_NOT_LINKED');
  if(rows.length!==1||rows[0].web_subject_hash!==identity.webSubjectHash||rows[0].verified_email_hash!==identity.emailHash||rows[0].provider!=='google'||rows[0].environment!=='beta'||(identity.canonical&&identity.canonical!==rows[0].canonical_user_id))throw Error('WEB_IDENTITY_CONFLICT');
  if(rows[0].status!=='ACTIVE')throw Error('WEB_IDENTITY_INACTIVE');
  return {...identity,canonical:rows[0].canonical_user_id};
}
export async function prepareManualRead(tx:any,identity:Json) {
  await tx.unsafe('set transaction read only');
  if(identity.kind==='web')await checkManualWebMapping(tx,identity);
  else {await tx.unsafe('set local role authenticated');await tx`select set_config('request.jwt.claim.sub',${identity.auth},true)`;}
}
export async function prepareManualWrite(tx:any,identity:Json) {
  if(identity.kind==='web')await checkManualWebMapping(tx,identity,true);
}
export async function manualPrivilegedRead(sql:any,identity:Json,read:(tx:any)=>Promise<any>,snapshot=false) {
  const work=async(tx:any)=>{await tx.unsafe('set transaction read only');if(identity.kind==='web')await checkManualWebMapping(tx,identity);return await read(tx);};
  return snapshot?await sql.begin('isolation level repeatable read read only',work):await sql.begin(work);
}
