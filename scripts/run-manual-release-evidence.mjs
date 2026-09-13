// Bounded local-only suite orchestration. Each child exit is recorded separately.
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
const root=process.cwd(),output=process.argv[2],mode=process.argv[3]||'regression';
if(!output||!path.isAbsolute(output)||!path.resolve(output).toLowerCase().startsWith('d:\\dev\\evidence\\'))throw Error('EXPLICIT_SCOPED_D_EVIDENCE_REQUIRED');
const run=path.join(output,mode+'-'+randomUUID());await mkdir(run,{recursive:true});
const env={...process.env,ALGORITHM_PYTHON:path.join(root,'.venv/Scripts/python.exe'),DENO_DIR:'D:/DevCache/health-companion-canonical-20260913-020110/deno',MANUAL_SQL_EVIDENCE_DIR:output,MANUAL_SQL_PRIVATE_TRACE_DIR:path.join(output,'private-synthetic-traces'),LOCAL_ENGINE_PG_BIN:'D:/Dev/Projects/web-health-companion-phase4a/.engine-artifacts/blocker-closure/tools/postgresql-18.6-win-x64-dce1e5c113de4020b338a04a3fdcf39c/portable/pgsql/bin'};
const source=execFileSync('git',['--no-optional-locks','rev-parse','HEAD'],{encoding:'utf8'}).trim();
const sourceFiles=[...new Set(execFileSync('git',['--no-optional-locks','ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean))];
const sourceHashes={};for(const name of sourceFiles)sourceHashes[name]=createHash('sha256').update(await readFile(name)).digest('hex');
await writeFile(path.join(run,'source-hashes.json'),JSON.stringify(sourceHashes,null,2));
const results=[];
const denoFlags=['--cached-only','--frozen-lockfile','--node-modules-dir=none','--config','config/engine-local.deno.json'];
const tests=(await readdir('tests')).filter(n=>n.endsWith('.test.cjs')).map(n=>'tests/'+n);
const commands=mode==='e2e'?[['browser-http-postgres',process.execPath,['scripts/test-manual-sql-e2e.mjs','--implementation-ready','--release-exercise'],900000]]:
 mode==='runtime'?[['runtime-unit-transport','deno',['test',...denoFlags,'--allow-env','--allow-read','--allow-sys','--allow-net=127.0.0.1','tests/manual-release-runtime.test.ts'],90000]]:[
 ['node',process.execPath,['--test','--test-reporter=tap','--test-reporter-destination=stdout','--test-reporter=junit','--test-reporter-destination='+path.join(run,'node-junit.xml'),...tests],240000],
 ['python',env.ALGORITHM_PYTHON,['-m','pytest','tests_python','-q','--junitxml='+path.join(run,'python-junit.xml')],240000],
 ['deno-portable-and-runtime','deno',['test',...denoFlags,'--junit-path',path.join(run,'deno-junit.xml'),'--allow-env','--allow-read','--allow-sys','--allow-net=127.0.0.1','tests/engine-portable.test.ts','tests/manual-release-runtime.test.ts'],120000],
 ['typecheck','deno',['check',...denoFlags,'scripts/local-engine-server.ts','tests/manual-release-runtime.test.ts'],90000],
 ['lint','deno',['lint','--config','config/engine-local.deno.json','supabase/functions/mobile-health-beta/manual-training-local.ts','supabase/functions/mobile-health-beta/local-manual-bootstrap.ts','supabase/functions/mobile-health-beta/bounded-auth-fetch.ts','supabase/functions/mobile-health-beta/manual-body-local.ts','supabase/functions/mobile-health-beta/manual-web-identity.ts'],90000],
 ['progress',process.execPath,['scripts/calculate-project-progress.mjs','--check'],30000],
 ];
for(const [name,exe,args,timeout]of commands){
 const start=new Date().toISOString();console.log('START '+name+' '+start);
 let stdout='',stderr='',timedOut=false;
 const child=spawn(exe,args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 const timer=setTimeout(()=>{timedOut=true;child.kill();},timeout);
 const exit=await new Promise(resolve=>{child.once('error',e=>{stderr+=e.message;resolve(-1);});child.once('exit',code=>resolve(code));});clearTimeout(timer);
 await writeFile(path.join(run,name+'.stdout.log'),stdout);await writeFile(path.join(run,name+'.stderr.log'),stderr);
 const result={name,command:[exe,...args],cwd:root,source_revision:source,started_at:start,ended_at:new Date().toISOString(),exit_code:exit,timed_out:timedOut,fresh:'FRESH_EXECUTION',stdout:name+'.stdout.log',stderr:name+'.stderr.log'};results.push(result);console.log('END '+name+' exit='+exit);await writeFile(path.join(run,'commands.json'),JSON.stringify(results,null,2));
}
const changed=[];for(const [name,before]of Object.entries(sourceHashes))if(createHash('sha256').update(await readFile(name)).digest('hex')!==before)changed.push(name);await writeFile(path.join(run,'source-check-after.json'),JSON.stringify({source_revision:source,changed_during_run:changed},null,2));
const files=await readdir(run),manifest=[];for(const name of files){const b=await readFile(path.join(run,name));manifest.push({path:name,sha256:createHash('sha256').update(b).digest('hex')});}await writeFile(path.join(run,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({run,results:results.map(r=>({name:r.name,exit_code:r.exit_code}))}));process.exitCode=results.some(r=>r.exit_code!==0)?1:0;
