type Row={access_status?:string;plan_code?:string|null;starts_at?:Date|string;expires_at?:Date|string|null;grace_until?:Date|string|null};
const FULL=['can_view_dashboard','can_add_health_data','can_use_nutrition','can_use_training','can_use_analysis'] as const;
const empty=()=>Object.fromEntries(FULL.map(name=>[name,false]));
export type Entitlement={status:string;plan:string|null;isAllowed:boolean;reason:string;expiresAt:string|null;graceUntil:string|null;capabilities:Record<string,boolean>};
export function resolveUserEntitlement(row:Row|undefined,now=new Date()):Entitlement{
 const status=row?.access_status||'MISSING',starts=row?.starts_at?new Date(row.starts_at):null,expires=row?.expires_at?new Date(row.expires_at):null,grace=row?.grace_until?new Date(row.grace_until):null;
 const validDates=!!starts&&!Number.isNaN(starts.valueOf())&&starts<=now&&(!expires||!Number.isNaN(expires.valueOf())&&expires>now);
 const beta=status==='BETA'&&validDates;
 let reason=beta?'ACCESS_GRANTED':status==='MISSING'?'ACCESS_NOT_GRANTED':status==='SUSPENDED'?'ACCESS_SUSPENDED':status==='REVOKED'?'ACCESS_REVOKED':status==='EXPIRED'||expires&&expires<=now?'ACCESS_EXPIRED':starts&&starts>now?'ACCESS_NOT_STARTED':'ACCESS_PLAN_NOT_ENABLED';
 return {status,plan:row?.plan_code||null,isAllowed:beta,reason,expiresAt:expires?.toISOString()||null,graceUntil:grace?.toISOString()||null,capabilities:beta?Object.fromEntries(FULL.map(name=>[name,true])):empty()};
}
export async function readUserEntitlement(sql:any):Promise<Entitlement>{
 const rows=await sql`select * from private.resolve_user_entitlement()`;
 if(rows.length>1)throw Error('ENTITLEMENT_CONFLICT');
 return resolveUserEntitlement(rows[0]);
}
