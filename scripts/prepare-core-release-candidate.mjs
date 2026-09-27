// Builds a hash-manifested, write-once-at-creation Beta release bundle. It never deploys,
// connects to a database, reads secrets, or includes private health/test data.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,readdir,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {BETA_PROJECT_REF,MIGRATION_PATH,MIGRATION_SHA256,MIGRATION_VERSION,verifyCoreReleaseMigration} from './verify-core-release-migration.mjs';
import {assertCanonicalRelativePath} from './verify-core-release-artifact.mjs';

const root=path.resolve('.');
const outputRoot=path.resolve(process.env.CORE_RELEASE_ARTIFACT_ROOT||'D:/Dev/Evidence/core-release-candidate-20260927/package');
assert.ok(outputRoot.toLowerCase().startsWith('d:\\dev\\evidence\\'),'D-drive evidence destination required');
const build=JSON.parse(await readFile(path.join(root,'build.json'),'utf8'));
assert.equal(build.buildId,'20260927-core-release-candidate-01');
const REVIEWED_SUPABASE_CLI_VERSION='2.115.0';
const REVIEWED_SUPABASE_CLI_EXECUTABLE='C:/Users/D0252/scoop/apps/supabase/2.115.0/supabase.exe';
const REVIEWED_SUPABASE_CLI_SHA256='691a3312584891204dc11893abcd12fa656dbcce186ef8d0a2782f137463f6d7';
const git=args=>execFileSync('git',['--no-optional-locks',...args],{cwd:root,encoding:'utf8'}).trim();
const commit=git(['rev-parse','HEAD']);
assert.equal(git(['status','--porcelain=v1','--untracked-files=all']),'','WORKTREE_MUST_BE_CLEAN');
const destination=path.join(outputRoot,`${build.buildId}-${commit.slice(0,12)}`);
try{await stat(destination);throw Error('ARTIFACT_DESTINATION_ALREADY_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}

const webFiles=['build.json','index.html','scripts/build-version.js','scripts/manual-sql-config.js','scripts/core-ux-contract.js','scripts/local-engine-web.js','scripts/web-view-state.js','scripts/manual-observation-web.js'];
const edgeFiles=['background-bootstrap.ts','background-routing.ts','background-runtime.ts','bounded-auth-fetch.ts','canonical-user-id.ts','deno.json','engine-portable.ts','entitlement.ts','hosted-database-ca.ts','hosted-manual-bootstrap.ts','index.ts','local-engine-runtime.ts','local-manual-bootstrap.ts','manual-body-engine.ts','manual-body-local.ts','manual-daily-read.ts','manual-observation-projection.ts','manual-observations-local.ts','manual-request-body.ts','manual-sql-context.ts','manual-training-local.ts','manual-web-identity.ts','score-bridge.ts','score-read-contract.ts','worker-sql-context.ts'];
const edgeExternalFiles=['config/engine-local.deno.lock','fixtures/algorithm-golden/apps-script-health-score-v1.0.snapshot.js'];
const releaseFiles=[MIGRATION_PATH,'docs/releases/20260927-core-release-candidate-01.md','scripts/verify-core-release-migration.mjs','scripts/verify-core-release-artifact.mjs','scripts/test-core-release-cli-migration.mjs'];
const candidateFiles=[...webFiles,...edgeFiles.map(file=>'supabase/functions/mobile-health-beta/'+file),...edgeExternalFiles,...releaseFiles];

const rollbackWebRoot='D:/Dev/Evidence/health-state-resilience-web-20260926-124445';
const rollbackWebManifestPath=path.join(rollbackWebRoot,'live-rollback-manifest.json');
const rollbackWebManifestSha256='130378d4714e89b346d679245e4f560261a8b16ab31914176d81637a74b3f05a';
const rollbackEdgeEvidenceRoot='D:/Dev/Evidence/core-release-candidate-20260927/rollback-edge-v41-active-20260927';
const rollbackEdgeRoot=path.join(rollbackEdgeEvidenceRoot,'source');
const rollbackEdgeManifestPath=path.join(rollbackEdgeEvidenceRoot,'remote-function-manifest.json');
const rollbackEdgeManifestSha256='ba16389dc163f112dd4ff17949607869fd04b26d685d159a2c75086813014803';
const remoteMigrationInventoryPath='D:/Dev/Evidence/core-release-candidate-20260927/remote-beta-migration-inventory-20260927.json';
const cliMigrationReportPath=path.resolve(process.env.CORE_RELEASE_CLI_MIGRATION_REPORT||'');
assert.ok(process.env.CORE_RELEASE_CLI_MIGRATION_REPORT&&path.isAbsolute(cliMigrationReportPath)&&cliMigrationReportPath.toLowerCase().startsWith('d:\\dev\\evidence\\'),'ABSOLUTE_D_DRIVE_CLI_MIGRATION_REPORT_REQUIRED');
const sha256=content=>createHash('sha256').update(content).digest('hex');
const normalize=value=>value.replaceAll('\\','/');
const copied=[];
async function writeChecked(sourceRoot,relative,targetPrefix,kind,expected=null,extra={}){
  assertCanonicalRelativePath(normalize(relative));assertCanonicalRelativePath(normalize(targetPrefix));
  const sourceBase=path.resolve(sourceRoot),source=path.resolve(sourceBase,relative);
  assert.ok(normalize(source).startsWith(normalize(sourceBase)+'/'),`source escapes root: ${relative}`);
  const content=await readFile(source),hash=sha256(content);
  if(expected){assert.equal(content.length,expected.bytes,`byte length mismatch: ${relative}`);assert.equal(hash,expected.sha256,`hash mismatch: ${relative}`);}
  const target=path.join(destination,targetPrefix,relative);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content,{flag:'wx'});
  const output=await readFile(target);assert.equal(sha256(output),hash,`post-write hash mismatch: ${relative}`);assert.equal(output.length,content.length,`post-write length mismatch: ${relative}`);
  copied.push({kind,path:normalize(path.join(targetPrefix,relative)),bytes:content.length,sha256:hash,...extra});
}
async function writeGenerated(relative,content,kind){
  const bytes=Buffer.from(content),target=path.join(destination,relative);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});
  assert.equal(sha256(await readFile(target)),sha256(bytes),`generated output hash mismatch: ${relative}`);
  copied.push({kind,path:normalize(relative),bytes:bytes.length,sha256:sha256(bytes),provenance:'DETERMINISTIC_RELEASE_PACKAGER_OUTPUT'});
}
async function listFiles(directory,prefix=''){
  const result=[];for(const entry of await readdir(directory,{withFileTypes:true})){const relative=prefix?path.join(prefix,entry.name):entry.name;if(entry.isDirectory())result.push(...await listFiles(path.join(directory,entry.name),relative));else if(entry.isFile())result.push(normalize(relative));}return result.sort();
}
async function verifyProvenanceManifest(file,expected,expectedSha256){
  const content=await readFile(file),manifest=JSON.parse(content);
  assert.equal(sha256(content),expectedSha256,`${path.basename(file)} reviewed manifest hash mismatch`);
  for(const [key,value]of Object.entries(expected))assert.equal(manifest[key],value,`${path.basename(file)} ${key} mismatch`);
  assert.ok(Array.isArray(manifest.files)&&manifest.files.length>0,`${path.basename(file)} files missing`);
  for(const row of manifest.files)assertCanonicalRelativePath(row.path);
  assert.equal(new Set(manifest.files.map(row=>row.path)).size,manifest.files.length,`${path.basename(file)} duplicate paths`);
  return {content,manifest,sha256:sha256(content)};
}
async function verifyImportClosure(bundleRoot){
  const functionRoot=path.join(bundleRoot,'supabase/functions/mobile-health-beta'),sources=(await listFiles(functionRoot)).filter(file=>/\.(?:ts|js|mjs|cjs)$/u.test(file));
  for(const relative of sources){const absolute=path.join(functionRoot,relative),source=await readFile(absolute,'utf8');for(const match of source.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/gu)){const specifier=match[1];if(!specifier.startsWith('.'))continue;const resolved=path.resolve(path.dirname(absolute),specifier);assert.ok(normalize(resolved).startsWith(normalize(bundleRoot)+"/"),`relative import escapes bundle: ${relative} -> ${specifier}`);await stat(resolved).catch(()=>{throw Error(`RELATIVE_IMPORT_MISSING: ${relative} -> ${specifier}`);});}}
  const config=JSON.parse(await readFile(path.join(functionRoot,'deno.json'),'utf8'));assert.equal(typeof config.lock,'string','Deno lock path missing');await stat(path.resolve(functionRoot,config.lock)).catch(()=>{throw Error('DENO_LOCK_MISSING_FROM_BUNDLE');});
  return {sourceFiles:sources.length,lock:normalize(path.relative(bundleRoot,path.resolve(functionRoot,config.lock)))};
}
function verifyDenoBundle(bundleRoot){
  const deno=process.env.DENO_EXECUTABLE||'deno',functionRoot=path.join(bundleRoot,'supabase/functions/mobile-health-beta');
  const denoDir=process.env.DENO_DIR;assert.ok(denoDir&&path.isAbsolute(denoDir),'ABSOLUTE_REVIEWED_DENO_DIR_REQUIRED');
  execFileSync(deno,['check','--cached-only','--frozen-lockfile','--node-modules-dir=none','--config','deno.json','index.ts'],{cwd:functionRoot,env:process.env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  return {status:'PASS_CACHED_FROZEN',entry:'supabase/functions/mobile-health-beta/index.ts',dependencyCache:'EXTERNAL_REVIEWED_ABSOLUTE_DENO_DIR'};
}
async function verifySupabaseCliContract(){
  assert.equal(sha256(await readFile(REVIEWED_SUPABASE_CLI_EXECUTABLE)),REVIEWED_SUPABASE_CLI_SHA256,'UNREVIEWED_SUPABASE_CLI_BINARY');
  const version=execFileSync(REVIEWED_SUPABASE_CLI_EXECUTABLE,['--version'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  assert.equal(version,REVIEWED_SUPABASE_CLI_VERSION,'UNREVIEWED_SUPABASE_CLI_VERSION');
  const help=execFileSync(REVIEWED_SUPABASE_CLI_EXECUTABLE,['db','push','--help'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  for(const flag of ['--dry-run','--skip-vault','--project-ref','--workdir'])assert.match(help,new RegExp(flag.replaceAll('-','\\-'),'u'),`SUPABASE_CLI_FLAG_MISSING: ${flag}`);
  return {version,executable:REVIEWED_SUPABASE_CLI_EXECUTABLE,sha256:REVIEWED_SUPABASE_CLI_SHA256,command:'supabase db push',requiredFlags:['--dry-run','--skip-vault','--project-ref','--workdir'],binaryDistribution:'OPERATOR_MUST_USE_REVIEWED_BINARY; binary is not bundled',operatorProfile:'MUST_BE_NAMED_IN_SEPARATE_AUTHORIZATION'};
}

const actualEdge=(await readdir(path.join(root,'supabase/functions/mobile-health-beta'))).filter(file=>!file.startsWith('.')).sort();
assert.deepEqual(actualEdge,edgeFiles.slice().sort(),'Edge allowlist must cover the complete function directory exactly');
assert.equal(sha256(await readFile(path.join(root,MIGRATION_PATH))),MIGRATION_SHA256,'migration hash changed');

const rollbackWeb=await verifyProvenanceManifest(rollbackWebManifestPath,{schema:'health-companion-live-web-rollback-v1',buildId:'20260926-health-state-resilience-06'},rollbackWebManifestSha256);
assert.deepEqual(rollbackWeb.manifest.files.map(row=>row.path).sort(),webFiles.slice().sort(),'rollback Web manifest must cover exact deployable set');
const rollbackEdge=await verifyProvenanceManifest(rollbackEdgeManifestPath,{schema:'health-companion-active-edge-export-v1',projectRef:BETA_PROJECT_REF,slug:'mobile-health-beta',status:'ACTIVE',version:41,verifyJwt:false,importMap:true,ezbrSha256:'ec3150a3c3075b677a1bf730b793b65690d2fecdc37fd884ad6f8bc8c08f1253'},rollbackEdgeManifestSha256);
assert.match(rollbackEdge.manifest.entrypointPath,/\/source\/supabase\/functions\/mobile-health-beta\/index\.ts$/u,'ROLLBACK_ENTRYPOINT_MISMATCH');
assert.match(rollbackEdge.manifest.importMapPath,/\/source\/supabase\/functions\/mobile-health-beta\/deno\.json$/u,'ROLLBACK_IMPORT_MAP_MISMATCH');
assert.deepEqual(await listFiles(rollbackEdgeRoot),rollbackEdge.manifest.files.map(row=>row.path).sort(),'rollback Edge export differs from its manifest');
const candidateDeno=await readFile(path.join(root,'supabase/functions/mobile-health-beta/deno.json'));
const rollbackDeno=rollbackEdge.manifest.files.find(row=>row.path==='supabase/functions/mobile-health-beta/deno.json');
assert.ok(rollbackDeno);assert.equal(sha256(candidateDeno),rollbackDeno.sha256,'rollback support lock may only be paired with the same deno.json dependency map');
const remoteMigrationInventoryBytes=await readFile(remoteMigrationInventoryPath),remoteMigrationInventory=JSON.parse(remoteMigrationInventoryBytes);
const migrationVerification=await verifyCoreReleaseMigration({targetProjectRef:BETA_PROJECT_REF,inventory:remoteMigrationInventory});
const cliMigrationReportBytes=await readFile(cliMigrationReportPath),cliMigrationReport=JSON.parse(cliMigrationReportBytes);
assert.equal(cliMigrationReport.status,'PASS','CLI_MIGRATION_COMPATIBILITY_NOT_PASS');assert.equal(cliMigrationReport.remote,false,'CLI_MIGRATION_EVIDENCE_MUST_BE_LOCAL');assert.equal(cliMigrationReport.sourceCommit,commit,'CLI_MIGRATION_EVIDENCE_COMMIT_MISMATCH');assert.equal(cliMigrationReport.workingTreeClean,true,'CLI_MIGRATION_EVIDENCE_DIRTY_SOURCE');assert.equal(cliMigrationReport.cli?.version,REVIEWED_SUPABASE_CLI_VERSION,'CLI_MIGRATION_EVIDENCE_VERSION_MISMATCH');assert.equal(cliMigrationReport.cli?.executable,REVIEWED_SUPABASE_CLI_EXECUTABLE,'CLI_MIGRATION_EVIDENCE_EXECUTABLE_MISMATCH');assert.equal(cliMigrationReport.cli?.sha256,REVIEWED_SUPABASE_CLI_SHA256,'CLI_MIGRATION_EVIDENCE_BINARY_HASH_MISMATCH');assert.equal(cliMigrationReport.migration?.name,path.basename(MIGRATION_PATH),'CLI_MIGRATION_EVIDENCE_NAME_MISMATCH');assert.equal(cliMigrationReport.migration?.sha256,MIGRATION_SHA256,'CLI_MIGRATION_EVIDENCE_HASH_MISMATCH');

for(const file of candidateFiles)await writeChecked(root,file,'candidate','candidate');
for(const row of rollbackWeb.manifest.files)await writeChecked(rollbackWebRoot,row.path,'rollback/web-v06','rollback-web-v06',row);
await writeChecked(path.dirname(rollbackWebManifestPath),path.basename(rollbackWebManifestPath),'rollback/web-v06','rollback-web-v06-provenance',{bytes:rollbackWeb.content.length,sha256:rollbackWeb.sha256});
for(const row of rollbackEdge.manifest.files)await writeChecked(rollbackEdgeRoot,row.path,'rollback/edge-v41','rollback-edge-v41',row);
await writeChecked(path.dirname(rollbackEdgeManifestPath),path.basename(rollbackEdgeManifestPath),'rollback/edge-v41','rollback-edge-v41-provenance',{bytes:rollbackEdge.content.length,sha256:rollbackEdge.sha256});
await writeChecked(root,'config/engine-local.deno.lock','rollback/edge-v41','rollback-edge-v41-support',null,{provenance:'candidate lock paired with byte-identical v41 deno.json; active export omitted lock'});
await writeChecked(path.dirname(remoteMigrationInventoryPath),path.basename(remoteMigrationInventoryPath),'release-evidence','remote-beta-migration-inventory',{bytes:remoteMigrationInventoryBytes.length,sha256:sha256(remoteMigrationInventoryBytes)});
await writeChecked(path.dirname(cliMigrationReportPath),path.basename(cliMigrationReportPath),'release-evidence','local-cli-migration-compatibility',{bytes:cliMigrationReportBytes.length,sha256:sha256(cliMigrationReportBytes)});

// Version-preserving migration workdir: every remote-history migration plus the
// single candidate, and no later repository migrations. Authorized operators
// must run dry-run first and verify that only MIGRATION_VERSION is pending.
const releaseMigrationFiles=[];
for(const row of remoteMigrationInventory.migrations){
  const version=String(row.version),name=String(row.name);assert.match(version,/^\d{14}$/u);assert.match(name,/^[a-z0-9_]+$/u);
  const relative=`supabase/migrations/${version}_${name}.sql`;await writeChecked(root,relative,'migration-workdir','migration-history-baseline');releaseMigrationFiles.push(relative);
}
await writeChecked(root,MIGRATION_PATH,'migration-workdir','migration-candidate');releaseMigrationFiles.push(MIGRATION_PATH);
await writeGenerated('migration-workdir/supabase/config.toml',`project_id = "health-companion-core-release-candidate"\n\n[db]\nmajor_version = 17\n\n[db.migrations]\nenabled = true\nschema_paths = []\n\n[db.seed]\nenabled = false\n`,'migration-workdir-config');
assert.deepEqual(await listFiles(path.join(destination,'migration-workdir/supabase/migrations')),releaseMigrationFiles.map(file=>normalize(file.slice('supabase/migrations/'.length))).sort(),'isolated migration workdir drift');

const importClosure={candidate:await verifyImportClosure(path.join(destination,'candidate')),rollbackEdge:await verifyImportClosure(path.join(destination,'rollback/edge-v41'))};
const denoValidation={candidate:verifyDenoBundle(path.join(destination,'candidate')),rollbackEdge:verifyDenoBundle(path.join(destination,'rollback/edge-v41'))};
const supabaseCliValidation=await verifySupabaseCliContract();
const forbiddenNames=/(^|\/)(\.env|\.env\..+|service-role|database-password|oauth-client-secret|token)(\/|$)/iu;
const forbiddenContents=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,/\bsb_(?:secret|service_role)_[A-Za-z0-9_-]{16,}/u,/\bsbp_[A-Za-z0-9_-]{20,}/u,/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/u,/\bpostgres(?:ql)?:\/\/[^:\s/@]+:[^@\s/]+@/iu,/\bAIza[0-9A-Za-z_-]{30,}\b/u,/(?:service_role|database_password|oauth_client_secret)\s*[:=]\s*['"][^'"]{8,}/iu];
for(const entry of copied){assert.equal(forbiddenNames.test(entry.path),false,`forbidden artifact name: ${entry.path}`);const text=await readFile(path.join(destination,entry.path),'utf8');for(const pattern of forbiddenContents)assert.equal(pattern.test(text),false,`suspected secret in ${entry.path}`);}

const migrationWorkdir=normalize(path.join(destination,'migration-workdir'));
const cliCommandContract={tool:'Supabase CLI db push',version:REVIEWED_SUPABASE_CLI_VERSION,executable:REVIEWED_SUPABASE_CLI_EXECUTABLE,sha256:REVIEWED_SUPABASE_CLI_SHA256,operatorProfile:'MUST_BE_NAMED_IN_SEPARATE_AUTHORIZATION',workdir:migrationWorkdir,dryRunArgs:['db','push','--dry-run','--skip-vault','--project-ref',BETA_PROJECT_REF,'--workdir',migrationWorkdir],applyArgs:['db','push','--skip-vault','--project-ref',BETA_PROJECT_REF,'--workdir',migrationWorkdir],authenticationMode:'EXISTING_SUPABASE_DB_PASSWORD_ENV',requiredSecretEnvironment:['SUPABASE_DB_PASSWORD'],temporaryLoginRoleForbidden:true,interactiveAuthForbidden:true,passwordOnCommandLineForbidden:true,stopIfOutputContains:['Initialising login role','Enter your database password'],expectedOnlyPendingMigration:MIGRATION_VERSION};
const manifest={
  schema:'health-companion-core-release-candidate-v2',createdAt:new Date().toISOString(),buildId:build.buildId,
  candidateCommit:commit,candidateWorktree:'CLEAN',betaProjectRef:BETA_PROJECT_REF,productionProjectRefDenied:'vptqedxdxfoohbqctujf',
  actualLiffEntry:'https://liff.line.me/2011116657-9SpSnQlN?range=30d',
  authorization:{status:'NOT_GRANTED',allowedRemoteMutations:[],separateExplicitApprovalRequired:{databaseMigration:true,edgeDeploy:true,webDeploy:true,betaTestWrites:true,configurationOrSecrets:true,production:true,retryAfterAmbiguousMigrationResult:true}},
  order:[`DB:version-preserving source ${MIGRATION_VERSION} only`,'Edge:mobile-health-beta','Web:Beta Pages'],
  migration:{...migrationVerification.migration,executor:'Supabase CLI db push from isolated migration-workdir only after explicit authorization',reviewedCli:supabaseCliValidation,cliCommandContract,workdir:'migration-workdir',dryRunRequired:true,skipVaultRequired:true,expectedOnlyPendingMigration:MIGRATION_VERSION,verificationScript:'candidate/scripts/verify-core-release-migration.mjs',cliCompatibilityEvidence:'release-evidence/'+path.basename(cliMigrationReportPath),remoteInventory:'release-evidence/remote-beta-migration-inventory-20260927.json',remoteInventoryMustBeRefetchedAtAuthorizationBoundary:true,nonConcurrentIndexLockRisk:'BOUNDED_BY_5S_LOCK_TIMEOUT_AND_30S_STATEMENT_TIMEOUT_THROUGH_HISTORY_INSERT; inspect pg_locks/pg_stat_activity first; on ambiguous timeout inspect history/schema and never blind-retry'},
  stopCheckpoints:['after DB catalog/history/readback','after Edge schema/config/browser-closed worker smoke','after Web build-id/LIFF smoke'],
  backgroundAnalysis:{requiredConfiguration:[{name:'HEALTH_BACKGROUND_SQL_ENABLED',expected:'1',secret:false},{name:'HEALTH_MANUAL_EXPECTED_PROJECT_REF',expected:BETA_PROJECT_REF,secret:false},{name:'SUPABASE_URL',expected:`https://${BETA_PROJECT_REF}.supabase.co`,secret:false},{name:'HEALTH_MANUAL_EXPECTED_DB_HOST',validation:'aws-*.pooler.supabase.com and both URLs match',secret:false},{name:'HEALTH_MANUAL_ALLOWED_ORIGIN',validation:'exact Beta Web HTTPS origin',secret:false},{name:'HEALTH_RECOMPUTE_DATABASE_URL',validation:`postgresql URL on port 6543 /postgres with username health_recompute_worker.${BETA_PROJECT_REF}`,mustExist:true,secret:true},{name:'HEALTH_NATIVE_DATABASE_URL',validation:`postgresql URL on port 6543 /postgres with username health_native_ingest.${BETA_PROJECT_REF}`,mustExist:true,secret:true},{name:'HEALTH_RECOMPUTE_TRIGGER_SECRET',validation:'at least 32 characters; never log value',mustExist:true,secret:true}],requiredDatabaseContracts:['health_recompute_worker role and least-privilege worker functions/grants','health_native_ingest role and ingestion/status functions/grants'],requiredSmoke:['scheduler calls /internal/score-recompute/drain with x-score-worker-secret against current Edge version','leased recompute job completes after browser closes','generation and published generation converge','failure retry remains bounded','Android/shortcut ingestion and connector status succeed through health_native_ingest without changing schedule'],status:'PREPARED_NOT_REMOTE_VERIFIED'},
  capabilityBoundaries:{rawCrud:'weight/body-fat, meals, training sets, sleep, steps, total energy',trainingDerivedAnalysis:'DEFERRED_NOT_CONNECTED',bodyStatusSql:'DEFERRED_PRODUCT_CONTRACT_NOT_DEFINED',observationAnalysis:'FULL_DAY steps and sleep duration use the existing frozen score publication; exact timing is additionally required for portable interval metrics; total energy and partial-day observations remain raw-only'},
  maxMaintenanceWindowMinutes:20,testWriteAuthorization:'NOT_INCLUDED_REQUIRES_SEPARATE_EXPLICIT_BETA_AUTHORIZATION',
  productionDeployment:false,productionWrites:0,files:copied,importClosure,denoValidation,
  rollback:{database:'retain additive schema; never drop/restore snapshot',edge:{path:'rollback/edge-v41',slug:'mobile-health-beta',version:41,status:'ACTIVE',verifyJwt:false,entrypoint:'supabase/functions/mobile-health-beta/index.ts',importMap:'supabase/functions/mobile-health-beta/deno.json',preserveExistingConfigurationAndSecrets:true,sourceManifestSha256:rollbackEdge.sha256,supportLock:'config/engine-local.deno.lock is separately identified support material'},web:{path:'rollback/web-v06',buildId:rollbackWeb.manifest.buildId,sourceManifestSha256:rollbackWeb.sha256,commitProvenance:'UNVERIFIED_NOT_REQUIRED_FOR_HASH_VERIFIED_BYTE_ROLLBACK'}}
};
await writeFile(path.join(destination,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
const manifestContent=await readFile(path.join(destination,'release-manifest.json'));
const result={status:'PASS',destination,buildId:build.buildId,commit,worktree:'CLEAN',files:copied.length,manifestSha256:sha256(manifestContent),secretScan:'PASS',importClosure:'PASS',denoValidation:'PASS_CACHED_FROZEN',remoteMutations:0};
await writeFile(path.join(destination,'artifact-result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result));
