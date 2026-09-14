// Local deterministic tooling. No installers, global configuration, Docker jobs or remote API tests.
import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import crypto from 'node:crypto';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cfg=JSON.parse(fs.readFileSync(path.join(repo,'config/ai-pool-v2.tools.json'),'utf8'));
const argv=process.argv.slice(2),arg=(key,fallback)=>argv.includes(key)?argv[argv.indexOf(key)+1]:fallback;
const mode=arg('--mode','tools');if(!['tools','regression','all'].includes(mode))throw Error('MODE');
const id=new Date().toISOString().replace(/[:.]/g,'-');const out=path.resolve(arg('--report-root',path.join(repo,'reports/ai-pool-v2',id)));
if(!out.toLowerCase().startsWith('d:\\')||fs.existsSync(out))throw Error('NEW_UNIQUE_D_REPORT_DIRECTORY_REQUIRED');
fs.mkdirSync(out,{recursive:true});for(const d of ['security','sbom','commands'])fs.mkdirSync(path.join(out,d));
const cache=cfg.cacheRoot,env={...process.env,TEMP:cache+'/ai-pool-temp',TMP:cache+'/ai-pool-temp',PLAYWRIGHT_BROWSERS_PATH:cfg.toolsRoot+'/playwright-browsers',NPM_CONFIG_CACHE:cache+'/npm',npm_config_store_dir:cache+'/pnpm',PIP_CACHE_DIR:cache+'/pip',TRIVY_CACHE_DIR:cache+'/trivy',OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY:cache+'/osv',XDG_CACHE_HOME:cache,PYTHONPYCACHEPREFIX:cache+'/python',ZIZMOR_NO_ONLINE_AUDITS:'true',SYFT_CHECK_FOR_APP_UPDATE:'false',PYTHONUTF8:'1'};
for(const key of Object.keys(env))if(/TOKEN|PASSWORD|SECRET|API_KEY/i.test(key))delete env[key];
for(const d of ['ai-pool-temp','python','osv','trivy'])fs.mkdirSync(path.join(cache,d),{recursive:true});
const results=[];const head=execFileSync('git',['--no-optional-locks','rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
function save(){fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({head,mode,started_at:id,updated_at:new Date().toISOString(),results,remote_uploads:0,docker_jobs:0,docker_images_added:0},null,2));}
function skip(name,status,reason,required=false){results.push({name,status,reason,required});save();}
async function run(name,exe,args,{timeout=240000,required=false,findings=false,cwd=repo}={}){
 const dir=path.join(out,'commands',name);fs.mkdirSync(dir);const start=new Date().toISOString();const logs={stdout:fs.openSync(path.join(dir,'stdout.log'),'w'),stderr:fs.openSync(path.join(dir,'stderr.log'),'w')};
 let error=null,timedOut=false;const code=await new Promise(resolve=>{
  const child=spawn(exe,args,{cwd,env,windowsHide:true,stdio:['ignore',logs.stdout,logs.stderr]});const timer=setTimeout(()=>{timedOut=true;child.kill();},timeout);
  child.on('error',e=>{error=e.code;clearTimeout(timer);resolve(null)});child.on('close',c=>{clearTimeout(timer);resolve(c)});
 });for(const fd of Object.values(logs))fs.closeSync(fd);
 const record={name,command:[exe,...args],cwd,start,end:new Date().toISOString(),exit_code:code,error,timedOut,required,status:error||timedOut?'BLOCKED':code===0?'PASS':'FAIL',classification:code!==0&&findings?'FINDINGS_OR_ERROR_INSPECT_REPORT':'EXECUTION',fresh:true};
 fs.writeFileSync(path.join(dir,'command.json'),JSON.stringify(record,null,2));results.push(record);save();console.log(name+': '+record.status);return record;
}
const tool=n=>path.join(cfg.toolsRoot,cfg.tools[n]);const py=path.join(cfg.venvRoot,'Scripts/python.exe');
const tracked=execFileSync('git',['--no-optional-locks','ls-files','-z'],{cwd:repo,encoding:'utf8'}).split('\0').filter(Boolean);
if(mode!=='regression'){
 // Scan an allowlisted tracked-source snapshot, never .env, .git, DBs, APKs or user caches.
 const snapshot=path.join(out,'scan-source');fs.mkdirSync(snapshot);const copied=[];
 for(const file of tracked){
  if(!/^(?:\.github\/.*|supabase\/(?:functions\/.*\.(?:ts|json)|migrations\/.*\.sql|config\.toml)|scripts\/.*|health_companion_algorithms\/.*|android-helper\/.*(?:\.gradle\.kts|gradle\.properties)|(?:package(?:-lock)?\.json|pyproject\.toml|requirements[^/]*\.txt|index\.html|LICENSE[^/]*))$/.test(file))continue;
  if(/(?:^|\/)(?:\.env|\.secrets|local\.properties)|\.(?:pem|key|p12|jks)$|deno\.lock$/.test(file))continue;
  const source=path.join(repo,file);if(!fs.existsSync(source)||fs.statSync(source).size>4*1024*1024)continue;
  const bytes=fs.readFileSync(source),dest=path.join(snapshot,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);copied.push({file,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
 }
 fs.writeFileSync(path.join(out,'scan-scope.json'),JSON.stringify({files:copied,excludes:'untracked/private settings, git history, binary artifacts, local datasets, node_modules, real credentials; locked dependencies only; missing Gradle locks reported as coverage limits'},null,2));
 const workflows=tracked.filter(f=>/^\.github\/workflows\/.*\.ya?ml$/.test(f));
 await run('actionlint',tool('actionlint'),['-shellcheck=','-pyflakes=',...workflows],{required:true});
 await run('zizmor',tool('zizmor'),['--offline','--no-progress','--format','json','--cache-dir',cache+'/zizmor','.github/workflows'],{findings:true});
 await run('sqlfluff',py,['-m','sqlfluff','lint','--dialect','postgres','--format','json','--processes','1','supabase/migrations'],{findings:true});
 if(mode==='all')await regression();
 skip('schemathesis','NOT_APPLICABLE','PREPARED_NO_OPENAPI_SCHEMA; do not fabricate schema or fuzz production');
 const empty=path.join(out,'empty.env');fs.writeFileSync(empty,'');
 await run('act-list',tool('act'),['--list','--no-cache-server','--env-file',empty,'--secret-file',empty,'--var-file',empty,'-P','ubuntu-latest=node:24-bookworm-slim'],{});
 const osvArgs=['scan','source','--offline','--no-resolve','--format','json','--output-file',path.join(out,'security/osv-report.json'),'--recursive'];
 if(argv.includes('--refresh-security-db'))osvArgs.push('--download-offline-databases');osvArgs.push(snapshot);
 await run('osv',tool('osv'),osvArgs,{findings:true,timeout:600000});
 if(argv.includes('--refresh-security-db'))await run('trivy-db',tool('trivy'),['fs','--download-db-only','--skip-version-check','--cache-dir',cache+'/trivy'],{timeout:300000});
 await run('trivy',tool('trivy'),['fs','--offline-scan','--skip-db-update','--skip-java-db-update','--skip-check-update','--skip-version-check','--scanners','vuln,misconfig,secret,license','--format','json','--output',path.join(out,'security/trivy-report.json'),'--cache-dir',cache+'/trivy',snapshot],{findings:true,timeout:300000});
 const trivyFile=path.join(out,'security/trivy-report.json');if(fs.existsSync(trivyFile)){try{const report=JSON.parse(fs.readFileSync(trivyFile,'utf8'));for(const result of report.Results||[])for(const secret of result.Secrets||[]){secret.Match='[REDACTED]';if(secret.Code)secret.Code={Lines:[],redacted:true};}fs.writeFileSync(trivyFile,JSON.stringify(report,null,2));}catch{}}
 await run('syft',tool('syft'),['scan','dir:'+snapshot,'--source-name','health-companion','--source-version',head,'-o','cyclonedx-json='+path.join(out,'sbom/health-companion.cdx.json')],{});
}
async function regression(){
 const projectPython=path.join(repo,'.venv/Scripts/python.exe');env.ALGORITHM_PYTHON=projectPython;
 await run('lint',projectPython,['-m','ruff','check','health_companion_algorithms'],{required:true});
 await run('typecheck',projectPython,['-m','mypy','health_companion_algorithms'],{required:true});
 await run('node-critical',process.execPath,['--test','tests/algorithm-golden-parity.test.cjs','tests/domain-score-response.test.cjs','tests/manual-sql-ui.test.cjs','tests/local-edge-harness.test.cjs'],{required:true});
 await run('python-critical',projectPython,['-m','pytest','-q','tests_python/test_algorithm_golden_parity.py','tests_python/test_domain_engines.py','--junitxml='+path.join(out,'python-critical.xml'),'-o','cache_dir='+cache+'/python/pytest'],{required:true});
 await run('frontend-build',process.execPath,['--test','tests/manual-package.test.cjs'],{required:true});
 if(env.LOCAL_ENGINE_PG_BIN&&env.ENGINE_PLAYWRIGHT_MODULE){
  env.DENO_DIR=env.DENO_DIR||cfg.toolsRoot+'/deno-cache';env.ENGINE_BROWSER_EXECUTABLE=path.join(cfg.toolsRoot,cfg.browser.executable);env.MANUAL_SQL_EVIDENCE_DIR=out;env.MANUAL_SQL_PRIVATE_TRACE_DIR=out+'/private-traces';
  if(!out.toLowerCase().startsWith('d:\\dev\\evidence\\'))skip('postgres-browser','BLOCKED','existing E2E requires explicit D:/Dev/Evidence private synthetic evidence root',true);
  else await run('postgres-browser',process.execPath,['scripts/test-manual-sql-e2e.mjs','--implementation-ready','--release-exercise'],{required:true,timeout:900000});
 }else skip('postgres-browser','BLOCKED','Set existing reviewed LOCAL_ENGINE_PG_BIN, LOCAL_ENGINE_PG_MAJOR, ENGINE_PLAYWRIGHT_MODULE; no new service/image inferred',true);
 await run('docker-health','docker',['--context','desktop-linux','info','--format','{{.ServerVersion}} {{.DockerRootDir}}']);
 skip('edge-health','NOT_RUN','Only if an existing run-owned local Edge endpoint is available; no stack/container started by toolchain runner');
}
if(mode==='regression')await regression();
save();console.log('Evidence: '+out);process.exitCode=results.some(r=>r.required&&r.status!=='PASS')?1:0;
