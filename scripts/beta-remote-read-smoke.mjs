// Future authorized Beta browser sessions only. No login/token extraction, writes,
// cleanup, session issuance, or local-fixture substitution. Importable by Playwright.
import assert from 'node:assert/strict';
import {targets} from './beta-cutover-preflight.mjs';
export const readCases=Object.freeze([
 ['getUserProfile','object'],['getDashboardData','object'],['getHealthTimeline','object'],
 ['getBodyRecords','array'],['getNutritionRecords','array'],['getWorkoutRecords','object'],
 ['getManualObservations','array'],['getManualObservationDaily','array'],
 ['getSleepRecords','array'],['getActivityRecords','array'],['getExerciseDatabase','array'],
 ['localEngineSnapshot','object'],
]);
export function assertSessionTarget({pageUrl,config},projectRef){
 const target=targets[projectRef];assert.ok(target,'BETA_TARGET_REQUIRED');
 const page=new URL(pageUrl),allowed=new URL(target.frontend);
 assert.equal(page.origin,allowed.origin,'BETA_WEB_ORIGIN_REQUIRED');
 assert.ok(page.pathname.startsWith(allowed.pathname),'BETA_WEB_PATH_REQUIRED');
 assert.equal(config?.enabled,true,'SQL_PROVIDER_REQUIRED');assert.equal(config?.release,'AB','AB_RELEASE_REQUIRED');
 assert.equal(config?.schemaVersion,'manual-sql-v1');assert.equal(config?.projectRef,projectRef);
 assert.equal(config?.endpoint,`https://${projectRef}.supabase.co/functions/v1/mobile-health-beta/v1/engine/web`,'EXACT_EDGE_ENDPOINT_REQUIRED');
}
export function assertReadShape(result,shape){
 assert.equal(result?.ok,true,'API_ENVELOPE_NOT_OK');
 if(shape==='array')assert.ok(Array.isArray(result.data),'EXPECTED_ARRAY');
 else assert.ok(result.data&&typeof result.data==='object'&&!Array.isArray(result.data),'EXPECTED_OBJECT');
 return result.data;
}
export async function runReadSmoke({pages,projectRef,date}){
 assert.ok(pages?.A&&pages?.B&&pages.A!==pages.B,'TWO_NORMAL_BETA_CONTEXTS_REQUIRED');
 assert.match(date,/^\d{4}-\d{2}-\d{2}$/);assert.equal(new Date(date).toISOString().slice(0,10),date);
 const identities={},checks=[];
 async function call(account,action,payload={}){
  const page=pages[account];
  assertSessionTarget({pageUrl:page.url(),config:await page.evaluate(()=>window.HEALTH_MANUAL_SQL_CONFIG)},projectRef);
  // Existing in-page transport uses its own session; credentials never leave page.
  return await page.evaluate(async({action,payload})=>{
   const response=await hostedManualFetch(action,payload);
   const result=await response.json();
   if(!response.ok)return {ok:false,error:result.error||('HTTP_'+response.status),httpStatus:response.status};
   return result;
  },{action,payload});
 }
 for(const account of ['A','B']){
  const identity=assertReadShape(await call(account,'getManualProviderIdentity'),'object');
  assert.match(identity.canonicalUserId,/^[a-f0-9-]{36}$/);assert.equal(identity.provider,'postgresql-manual-v1');assert.equal(identity.release,'AB');
  identities[account]=identity.canonicalUserId;
 }
 assert.notEqual(identities.A,identities.B,'A_B_CANONICAL_MAPPING_COLLISION');
 for(const account of ['A','B'])for(const [action,shape]of readCases){
  const result=assertReadShape(await call(account,action,{date,startDate:date,endDate:date}),shape);
  if(action==='getUserProfile')assert.equal(result.userId,identities[account]);
  checks.push({account,action,status:'PASS_RESPONSE_SHAPE',rows:Array.isArray(result)?result.length:undefined});
 }
 for(const account of ['A','B']){
  const forged=await call(account,'getBodyRecords',{date,canonical_user_id:identities[account==='A'?'B':'A']});
  assert.equal(forged.ok,false,'FORGED_IDENTITY_ACCEPTED');
  assert.equal(forged.error,'CLIENT_IDENTITY_FORBIDDEN','UNEXPECTED_ERROR_IS_NOT_ISOLATION_PROOF');
  checks.push({account,action:'forged_identity_read',status:'PASS_DENIED'});
 }
 return {status:'PASS_READ_SMOKE_ONLY',checks,remote_writes:0,remote_deletions:0,crud:'NOT_TESTED',row_isolation:'NOT_PROVEN_BY_EMPTY_OR_SHAPE_ONLY_READS',persistence_cache:'SEPARATE_BROWSER_CRUD_GATE_REQUIRED'};
}
