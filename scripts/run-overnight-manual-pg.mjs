import {createLocalPostgres} from './local-engine-postgres.mjs';
import {spawnSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';import {randomUUID} from 'node:crypto';
const parent=process.argv[2];if(!parent||!path.isAbsolute(parent))throw Error('EXPLICIT_EVIDENCE_DIR_REQUIRED');
const output=path.join(parent,'overnight-pg-'+randomUUID());await mkdir(output,{recursive:true});
const pg=await createLocalPostgres({port:57485});
const config=path.join(output,'runtime-config.json');await writeFile(config,JSON.stringify(pg.config));
const args=['run','--cached-only','--frozen-lockfile','--node-modules-dir=none','--config','config/engine-local.deno.json','--allow-env','--allow-read','--allow-sys','--allow-net=127.0.0.1','--allow-write='+output,'scripts/test-overnight-manual-pg.ts',config,path.join(output,'report.json')];
const started=new Date().toISOString();let result;
try{result=spawnSync('deno',args,{windowsHide:true,encoding:'utf8',timeout:300000,env:{...process.env,HEALTH_ENGINE_LOCAL_ONLY:'1',HEALTH_EXERCISE_MANAGEMENT_LOCAL:'1'}});await writeFile(path.join(output,'stdout.log'),result.stdout||'');await writeFile(path.join(output,'stderr.log'),result.stderr||'');}
finally{await pg.close();await writeFile(path.join(output,'command.json'),JSON.stringify({command:['deno',...args],cwd:process.cwd(),started_at:started,ended_at:new Date().toISOString(),exit_code:result?.status??-1,database:pg.evidence,cleanup:'OWNED_PG_STOPPED_DB_RETAINED'},null,2));}
console.log(JSON.stringify({output,exit_code:result?.status,stdout:result?.stdout,stderr:result?.stderr}));process.exitCode=result?.status===0?0:1;
