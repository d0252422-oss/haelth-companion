// Offline allowlisted frontend/backend/source package. Never publishes or reads local secrets.
import {readFile,writeFile,mkdir,copyFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
import {manualReleaseIncludesMigration,RELEASE_A_OMITTED_MIGRATIONS} from './manual-release-migrations.mjs';
const output=process.argv[2],release=process.argv.includes('--release=AB')?'AB':'A';
if(!output||!path.isAbsolute(output))throw Error('EXPLICIT_NEW_ARTIFACT_DIRECTORY_REQUIRED');
await mkdir(output,{recursive:false});
const backend='supabase/functions/mobile-health-beta';
const files=['index.html','build.json','scripts/build-version.js','scripts/core-ux-contract.js','scripts/local-engine-web.js','scripts/web-view-state.js','scripts/manual-observation-web.js','scripts/manual-sql-config.js',
 'config/engine-local.deno.json','config/engine-local.deno.lock',backend+'/deno.json',
 'fixtures/algorithm-golden/apps-script-health-score-v1.0.snapshot.js'];
for(const name of await readdir(backend))if(name.endsWith('.ts'))files.push(backend+'/'+name);
for(const name of await readdir('supabase/migrations'))if(name.endsWith('.sql')&&manualReleaseIncludesMigration(name,release))files.push('supabase/migrations/'+name);
const sourceRevision=execFileSync('git',['--no-optional-locks','rev-parse','HEAD'],{encoding:'utf8'}).trim();
const sourceStatus=execFileSync('git',['--no-optional-locks','status','--porcelain=v1','--untracked-files=normal'],{encoding:'utf8'}).replaceAll('\r\n','\n');
const manifest={created_at:new Date().toISOString(),source_revision:sourceRevision,source_base_revision:sourceRevision,
 source_worktree_state:sourceStatus.trim()?'DIRTY':'CLEAN',source_status_sha256:createHash('sha256').update(sourceStatus).digest('hex'),source_status_entry_count:sourceStatus.trim()?sourceStatus.trimEnd().split('\n').length:0,
 status:'SOURCE_PACKAGE_HOSTED_PROVIDER_IMPLEMENTED_NOT_ENABLED',release,files:[],
 candidate_entry:'https://d0252422-oss.github.io/health-companion-beta/',
 entry_evidence:'Existing Beta entry recorded in repository release docs; current remote frontend revision/artifact and login return-path NOT_VERIFIED. No new preview site is proposed.',
 pre_cutover_snapshot:'NOT_CAPTURED; package generation is not a rollback point for the current remote deployment',
 backend:{project_name:'health-companion-beta',project_ref:'uavimjgccigpbwqmfkhh',function:'mobile-health-beta',runtime:'Supabase Edge Runtime',route:'/functions/v1/mobile-health-beta/v1/engine/web',actual_edge_execution:'NOT_INFERRED_FROM_SOURCE_PACKAGE; verify the selected runtime report and source hashes'},
 flags:{manual_sql:'OFF',exercise_management:'OFF',background_sql:'OFF',existing_provider:'UNCHANGED_APPS_SCRIPT'},
 background:{roles:['health_native_ingest','health_recompute_worker'],switch_boundary:'SQL-first rejects native ingestion/drain unless separate background config is ready; never privileged fallback',device_acceptance:'DEFERRED_NOT_INFERRED_FROM_SOURCE'},
 source_boundary:'Source deploy tree with derived single-function CLI config and effective pinned Deno config; NOT a verified CLI Edge compiled bundle',
 migration_execution:'Historical source only. Never apply this whole directory; compare the exact current Beta migration inventory and execute only the reviewed non-destructive missing subset after all preconditions PASS.',
 omitted_migrations:release==='A'?[...RELEASE_A_OMITTED_MIGRATIONS]:[],
 calculation_dependency:'Exact unchanged frozen health-score-v1.0 executable snapshot; no fixture outputs or synthetic issuer',
 exclusions:['.env','tokens','test issuer','synthetic identity fixtures','databases','source maps','Android','private evidence','untracked deno.lock'],
 required_settings:['HEALTH_MANUAL_SQL_HOSTED_ENABLED','HEALTH_MANUAL_RELEASE','HEALTH_MANUAL_ALLOWED_ORIGIN','HEALTH_MANUAL_EXPECTED_PROJECT_REF','HEALTH_MANUAL_EXPECTED_DB_HOST','HEALTH_MANUAL_DATABASE_URL','HEALTH_BACKGROUND_SQL_ENABLED','HEALTH_NATIVE_DATABASE_URL','HEALTH_RECOMPUTE_DATABASE_URL','HEALTH_RECOMPUTE_TRIGGER_SECRET','BETA_WEB_AUTH_VERIFY_URL','Supabase SDK project configuration'],
 activation_conditions:['actual CLI Edge + PG17 + Web acceptance','actual verified Web session + existing canonical mapping; no automatic account links','actual transaction pool + TLS/custom role validation','authorized Beta migration/config/deployment','real OAuth user-scoped acceptance'],
 remote_operations:0};
for(const name of files){
 const original=await readFile(name);
 let bytes=original;
 if(name==='scripts/manual-sql-config.js'){
  const sourceContext={};
  vm.runInNewContext(original.toString('utf8'),sourceContext,{filename:name});
  const sourceConfig=sourceContext.HEALTH_MANUAL_SQL_CONFIG;
  if(!sourceConfig||typeof sourceConfig!=='object')throw Error('INVALID_MANUAL_SQL_CONFIG');
  const safeConfig={...sourceConfig,enabled:false,release};
  bytes=Buffer.from(`globalThis.HEALTH_MANUAL_SQL_CONFIG=Object.freeze(${JSON.stringify(safeConfig)});\n`);
  const verifyContext={};
  vm.runInNewContext(bytes.toString('utf8'),verifyContext,{filename:name});
  if(verifyContext.HEALTH_MANUAL_SQL_CONFIG?.release!==release||verifyContext.HEALTH_MANUAL_SQL_CONFIG?.enabled!==false)throw Error('UNSAFE_PUBLIC_PACKAGE_CONFIG');
 }
 const source=bytes.toString('utf8');
 if(name.endsWith('.js')&&!name.includes('fixtures/'))new vm.Script(source,{filename:name});
 if(name==='index.html')for(const [,script]of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(script,{filename:name});
 if(name.endsWith('.ts')&&/Deno\.Command|local-engine-auth|synthetic-issuer/.test(source))throw Error('FORBIDDEN_DEPLOY_DEPENDENCY:'+name);
 await mkdir(path.dirname(path.join(output,name)),{recursive:true});await writeFile(path.join(output,name),bytes);
 manifest.files.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
// Check every literal relative TS/JS import in the shipped backend against the actual source tree.
const listed=new Set(files);
for(const file of files.filter(f=>f.startsWith(backend)&&f.endsWith('.ts'))){
 const text=await readFile(file,'utf8');
 for(const match of text.matchAll(/(?:from\s*|import\s*\()(['"])(\.[^'"]+)\1/g)){
  const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(file),match[2]));
  if(!listed.has(resolved))throw Error('UNPACKAGED_RUNTIME_IMPORT:'+file+' -> '+resolved);
 }
}
// Preserve the actual function's gateway contract, but do not ship unrelated local
// services/seeds or silently reuse the source project's shared local port settings.
const sourceConfig=await readFile('supabase/config.toml','utf8');
const functionSection=sourceConfig.match(/^\[functions\.mobile-health-beta\]\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
if(!functionSection||!/^verify_jwt = false$/m.test(functionSection)
 ||!functionSection.includes('entrypoint = "./functions/mobile-health-beta/index.ts"')
 ||!functionSection.includes('import_map = "./functions/mobile-health-beta/deno.json"'))throw Error('REVIEW_FUNCTION_CONFIG_BEFORE_PACKAGING');
const cliConfig='# Derived offline review/deploy config; local start requires a separate isolated-port configuration.\n'
 +`project_id = "health-manual-review-${release.toLowerCase()}"\n[db]\nmajor_version = 17\n[db.seed]\nenabled = false\n`
 +'[functions.mobile-health-beta]\n'+functionSection;
await writeFile(path.join(output,'supabase/config.toml'),cliConfig);
manifest.files.push({path:'supabase/config.toml',bytes:Buffer.byteLength(cliConfig),sha256:createHash('sha256').update(cliConfig).digest('hex')});
manifest.cli_config={source:'supabase/config.toml',source_sha256:createHash('sha256').update(sourceConfig).digest('hex'),
 derivation:'Only the existing function section, PG17 major and seeds OFF; no local service startup acceptance',
 local_start:'NOT_AUTHORIZED_BY_PACKAGING; use a new unique local-project/ports configuration for actual Edge rehearsal'};
await writeFile(path.join(output,'artifact-manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({status:manifest.status,output,release,files:manifest.files.length,source_bytes:manifest.files.reduce((n,f)=>n+f.bytes,0),remote_operations:0}));
