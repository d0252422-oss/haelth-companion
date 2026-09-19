import {assert} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {resolveUserEntitlement} from "../supabase/functions/mobile-health-beta/entitlement.ts";

const now=new Date('2026-09-20T12:00:00Z');
Deno.test('controlled Beta entitlement is the only currently enabled full-access state',()=>{
 const active=resolveUserEntitlement({access_status:'BETA',starts_at:'2026-09-01T00:00:00Z',expires_at:'2026-10-01T00:00:00Z'},now);
 assert(active.isAllowed);assert(active.capabilities.can_view_dashboard);assert(active.reason==='ACCESS_GRANTED');
 for(const status of ['FREE','TRIAL','PAID','EXPIRED','SUSPENDED','REVOKED'])assert(!resolveUserEntitlement({access_status:status,starts_at:'2026-09-01T00:00:00Z',expires_at:'2026-10-01T00:00:00Z'},now).isAllowed);
});
Deno.test('missing, future, expired, and invalid entitlement fail closed',()=>{
 assert(resolveUserEntitlement(undefined,now).reason==='ACCESS_NOT_GRANTED');
 assert(resolveUserEntitlement({access_status:'BETA',starts_at:'2026-10-01T00:00:00Z'},now).reason==='ACCESS_NOT_STARTED');
 assert(resolveUserEntitlement({access_status:'BETA',starts_at:'2026-09-01T00:00:00Z',expires_at:'2026-09-19T00:00:00Z'},now).reason==='ACCESS_EXPIRED');
 assert(!resolveUserEntitlement({access_status:'BETA',starts_at:'invalid'},now).isAllowed);
});
