// Offline allowlisted frontend/backend/source package. Never publishes or reads local secrets.
import {readFile,writeFile,mkdir,copyFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
const output=process.argv[2],release=process.argv.includes('--release=AB')?'AB':'A';
if(!output||!path.isAbsolute(output))throw Error('EXPLICIT_NEW_ARTIFACT_DIRECTORY_REQUIRED');
await mkdir(output,{recursive:false});
const backend='supabase/functions/mobile-health-beta';
const files=['index.html','scripts/local-engine-web.js','scripts/manual-sql-config.js',
 'config/engine-local.deno.json','config/engine-local.deno.lock',backend+'/deno.json',
 'fixtures/algorithm-golden/apps-script-health-score-v1.0.snapshot.js'];
for(const name of await readdir(backend))if(name.endsWith('.ts'))files.push(backend+'/'+name);
for(const name of await readdir('supabase/migrations'))if(name.endsWith('.sql')&&(release==='AB'||!/manual_exercise_(catalog_sql|category_update)/.test(name)))files.push('supabase/migrations/'+name);
const manifest={created_at:new Date().toISOString(),source_revision:execFileSync('git',['--no-optional-locks','rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 status:'SOURCE_PACKAGE_HOSTED_PROVIDER_IMPLEMENTED_NOT_ENABLED',release,files:[],
 candidate_entry:'health-companion-beta/manual-preview/index.html (PROPOSED_NEW_PATH_NOT_DEPLOYED)',
 backend:{project_name:'health-companion-beta',project_ref:'uavimjgccigpbwqmfkhh',function:'mobile-health-beta',runtime:'Supabase Edge Runtime',route:'/functions/v1/mobile-health-beta/v1/engine/web',actual_edge_execution:'BLOCKED_DOCKER_BACKEND_STARTUP'},
 flags:{manual_sql:'OFF',exercise_management:'OFF',existing_provider:'UNCHANGED_APPS_SCRIPT'},
 source_boundary:'Source deploy tree with derived single-function CLI config and effective pinned Deno config; NOT a verified CLI Edge compiled bundle',
 migration_execution:'Historical source only. Never apply this whole directory; compare the exact current Beta migration inventory and execute only the reviewed non-destructive missing subset after all preconditions PASS.',
 calculation_dependency:'Exact unchanged frozen health-score-v1.0 executable snapshot; no fixture outputs or synthetic issuer',
 exclusions:['.env','tokens','test issuer','synthetic identity fixtures','databases','source maps','Android','private evidence','untracked deno.lock'],
 required_settings:['HEALTH_MANUAL_SQL_HOSTED_ENABLED','HEALTH_MANUAL_RELEASE','HEALTH_MANUAL_ALLOWED_ORIGIN','HEALTH_MANUAL_EXPECTED_PROJECT_REF','HEALTH_MANUAL_EXPECTED_DB_HOST','HEALTH_MANUAL_DATABASE_URL','BETA_WEB_AUTH_VERIFY_URL','Supabase SDK project configuration'],
 activation_conditions:['actual CLI Edge + PG17 + Web acceptance','actual verified Web session + existing canonical mapping; no automatic account links','actual transaction pool + TLS/custom role validation','authorized Beta migration/config/deployment','real OAuth user-scoped acceptance'],
 remote_operations:0};
for(const name of files){
 const original=await readFile(name);
 const bytes=name==='scripts/manual-sql-config.js'?Buffer.from(original.toString('utf8').replace("release:'A'",`release:'${release}'`)):original,source=bytes.toString('utf8');
 if(name==='scripts/manual-sql-config.js'&&(!source.includes(`release:'${release}'`)||!source.includes('enabled:false')))throw Error('UNSAFE_PUBLIC_PACKAGE_CONFIG');
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
