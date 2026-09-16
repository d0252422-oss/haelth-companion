// Offline inventory only: no network, SQL execution, credentials or deployment.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
export const settings=['HEALTH_MANUAL_SQL_HOSTED_ENABLED','HEALTH_MANUAL_RELEASE','HEALTH_MANUAL_ALLOWED_ORIGIN','HEALTH_MANUAL_EXPECTED_PROJECT_REF','HEALTH_MANUAL_EXPECTED_DB_HOST','HEALTH_MANUAL_DATABASE_URL'];
const versions=['20260912032458','20260912041126','20260912182042','20260913041844','20260913164024','20260913164026','20260913180000','20260913190152','20260916144345'];
const dependencies=[[],[0],[1],[1],[1,2],[3],[0,1,2],[1,6],[0,1,2,4,6,7]];
const purposes=['versioned output history/heads','meals, identity RLS and bounded queue triggers','manual body and receipts','exercise catalog/preferences/history/receipts','body recompute trigger','exercise category update grant','queue publication generation guard','manual sleep/steps/total energy and overlap publication guard','non-privileged runtime grants, request-context RLS and invoker publication; optional exercise policies'];
export function audit(){
 const migrationFiles=fs.readdirSync(path.join(repo,'supabase/migrations'));
 const all_migrations=migrationFiles.filter(n=>/^\d{14}_.*\.sql$/.test(n)).sort().map((name,i,names)=>{
  const file='supabase/migrations/'+name,sql=read(file),lines=sql.split(/\r?\n/);
  return {version:name.slice(0,14),file,sha256:hash(fs.readFileSync(path.join(repo,file))),purpose:name.slice(15,-4),
   chronological_predecessor:i?names[i-1].slice(0,14):null,dependency_scope:'Chronological baseline order; original eight plus local successor dependencies in migrations[].depends_on',
   ddl_and_privilege_locations:lines.flatMap((line,n)=>/^\s*(?:create|alter|grant|revoke|drop|truncate|delete|update)\b/i.test(line)?[{line:n+1,statement_start:line.trim()}]:[]),
   object_names:[...new Set([...sql.matchAll(/\b(?:table|function|index|sequence)\s+(?:if\s+not\s+exists\s+)?([a-z_][\w.]*)/gi)].map(m=>m[1]))],
   destructive_review:'Inventory includes function-body DML; not a top-level SQL safety verdict. Historical files must not be reapplied wholesale.',
   recovery:'No automatic reverse migration; preserve rows and hash-verified before-state; reviewed forward fix only.'};
 });
 const migrations=versions.map((version,i)=>{
  const names=migrationFiles.filter(n=>n.startsWith(version+'_'));if(names.length!==1)throw Error('MIGRATION_NOT_UNIQUE:'+version);
  const file='supabase/migrations/'+names[0],sql=read(file);
  return {version,file,sha256:hash(fs.readFileSync(path.join(repo,file))),purpose:purposes[i],depends_on:dependencies[i].map(j=>versions[j]),
   baseline_dependencies:i===1?['public.users','private.beta_native_auth_identities','auth.uid()','public.beta_health_records','private.beta_score_recompute_queue']:i===0?['public.users','authenticated','service_role']:[],
   reviewed_remote_state:i===8?'LOCAL_SUCCESSOR_NOT_REMOTE_CHECKED':'MISSING_AT_2026_09_14_METADATA_SNAPSHOT',
   ddl_and_privilege_locations:sql.split(/\r?\n/).flatMap((line,n)=>/^\s*(CREATE|ALTER|GRANT|REVOKE)\b/i.test(line)?[{line:n+1,statement_start:line.trim()}]:[]),
   destructive_review:'MANUAL_REVIEW_NO_TOP_LEVEL_DROP_TRUNCATE_DELETE_OR_BULK_UPDATE; function bodies/locks still require rehearsal',
   recovery:'Retain additive schema and new rows; disable provider/restore code; forward-fix changed functions. No automatic down migration.'};
 });
 const sources=['index.html','scripts/local-engine-web.js','scripts/manual-observation-web.js','scripts/web-view-state.js'];
 const local=read(sources[1]);const allow=local.match(/const hostedManualActions=new Set\(\[([^\]]+)\]/)?.[1];if(!allow)throw Error('ALLOWLIST_NOT_FOUND');
 const supported=new Set([...allow.matchAll(/'([^']+)'/g)].map(m=>m[1]));
 const actions=new Map();
 const add=(name,file,offset,source)=>{const a=actions.get(name)||{action:name,frontend_calls:[]};a.frontend_calls.push({file,line:source.slice(0,offset).split('\n').length});actions.set(name,a);};
 for(const file of sources){const source=read(file);for(const m of source.matchAll(/\b(?:apiGet|apiPost|sessionPost|localEngineRequest|createExternalSession)\(\s*['"]([^'"]+)['"]/g))add(m[1],file,m.index,source);}
 for(const action of supported)if(!actions.has(action))add(action,sources[1],local.indexOf("'"+action+"'"),local);
 const legacyAuth=new Set(['createSession','getCurrentUser','logout','getLineLinkStatus','completeLineGoogleLink','linkLineIdentity','unlinkLine','beginLineGoogleLink']);
 const backend='supabase/functions/mobile-health-beta/local-engine-runtime.ts',server=read(backend);
 const rows=[...actions.values()].sort((a,b)=>a.action.localeCompare(b.action)).map(a=>{
  const body=/Body/.test(a.action),obs=/Observation|Sleep|Activity/.test(a.action),training=/Workout|Training|Exercise/.test(a.action),nutrition=/Meal|Nutrition|Snapshot/.test(a.action);
  const shared=['getDashboardData','getTodaySummary','getHealthTimeline','refreshDerivedData'].includes(a.action);
  const category=body?'body':obs?'sleep/activity':training?'training/exercise':nutrition?'nutrition':shared?'dashboard/scores':'profile/auth/report/check-in';
  const enabled=supported.has(a.action),auth=legacyAuth.has(a.action);
  const offsets=[server.indexOf("'"+a.action+"'"),server.indexOf('"'+a.action+'"')].filter(n=>n>=0);const offset=offsets.length?Math.min(...offsets):-1;
  return {...a,category,status:auth?'LEGACY_ONLY':enabled?(shared?'PARTIAL':'SQL_READY'):'NOT_IMPLEMENTED',
   status_scope:'STATIC_HOSTED_ROUTE_COVERAGE_NOT_REMOTE_ACCEPTANCE',
   edge_handler:enabled?{file:backend,line:offset<0?null:server.slice(0,offset).split('\n').length,function:'LocalEngineRuntime.handle'}:null,
   sql:!enabled?'NONE_IN_HOSTED_DATA_PATH':body?'engine_manual_body_records; engine_body_mutation_receipts':obs?'engine_manual_observations; engine_observation_receipts; daily reconciliation':training?'manual_exercise_catalog; manual_exercise_preferences; manual_workout_sets; manual_training_receipts':nutrition?'engine_meals; engine_mutation_receipts; engine_output_heads/history':'canonical identity; published daily score/queue/output queries (inspect handler per action)',
   auth:auth?'Existing Apps Script verified session bridge; account-link mutations require separate authorization':enabled?'verifyWebIdentity -> resolveVerifiedManualWebIdentity -> checkManualWebMapping; rechecked within write transaction':'HOSTED_MANUAL_ACTION_NOT_SUPPORTED; no implicit Sheets fallback',
   tenant:enabled?'Verified session hashes -> transaction-local context; effective health_manual_api NO BYPASSRLS/NO memberships; owner RLS and server predicates':'NOT_APPLICABLE',
   return_schema:enabled?'Action-specific existing handle response in {ok,data}; frontend assertManualResponseShape; this inventory does not infer missing fields':'Legacy response or explicit unsupported error',
   error_contract:enabled?'Origin403/method405/config503; typed {ok:false,error}; transient DB errors retryable; no-store':'Unsupported hosted data action fails closed; legacy auth errors remain visible',
   cache:enabled?'localSessionEpoch + user/environment + read serials; pending idempotency envelope retained until reconciled':'Unsupported actions need explicit NOT_AVAILABLE UI before full-site cutover',
   recompute:!enabled?'NONE':training?'Workout raw aggregates; score analysis not connected; no score fabricated':body||obs||nutrition||shared?'Bounded input date/old date invalidation and generation-guarded publication where mutation applies':'NONE'};
 });
 const sqlFiles=['manual-body-local.ts','manual-training-local.ts','manual-observations-local.ts','manual-web-identity.ts','local-engine-runtime.ts'].map(n=>'supabase/functions/mobile-health-beta/'+n);
 const sql_locations=sqlFiles.flatMap(file=>read(file).split(/\r?\n/).flatMap((line,n)=>/\b(?:async |function |class |select |insert into |update |delete from )/i.test(line)?[{file,line:n+1,source:line.trim()}]:[]));
 return {schema:'beta-preparation-inventory-v2',all_migrations,source_files:[...new Set(sources.concat(sqlFiles,['supabase/functions/mobile-health-beta/hosted-manual-bootstrap.ts']))].map(file=>({file,sha256:hash(fs.readFileSync(path.join(repo,file)))})),settings,migrations,actions:rows,sql_locations,
  limitations:['Literal call/allowlist inventory; dynamic caller reachability requires review, not a runtime test.','SQL_READY is a route implementation label, never a cutover or OAuth PASS.','Dashboard/timeline coverage is partial: profile/targets/check-in/weekly/photo are not implemented in hosted provider.','No remote query, grant, migration, session or data mutation is executed by this script.']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=audit();const output=process.argv[2];if(output){if(!path.isAbsolute(output))throw Error('ABSOLUTE_EVIDENCE_FILE_REQUIRED');fs.writeFileSync(output,JSON.stringify(result,null,2),{flag:'wx'});}
 console.log(JSON.stringify({migrations:result.migrations.length,actions:result.actions.length,settings:result.settings.length,status_counts:result.actions.reduce((o,a)=>(o[a.status]=(o[a.status]||0)+1,o),{}),remote_mutations:0,report:output||null}));
}
