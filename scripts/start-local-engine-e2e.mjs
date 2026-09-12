import {createLocalPostgres} from './local-engine-postgres.mjs';
import {writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
const pg=await createLocalPostgres();
const config=path.join(pg.evidence.root,'runtime-config.json');
await writeFile(config,JSON.stringify(pg.config));
await writeFile('.engine-artifacts/runtime-e2e/database.manifest.json',JSON.stringify(pg.evidence,null,2));
const child=spawn('deno',['run','--watch=health_companion_algorithms/domain_runtime.py,scripts/python-algorithm-worker.py','--config','config/engine-local.deno.json','--allow-env','--allow-read','--allow-run','--allow-sys','--allow-net=127.0.0.1','scripts/local-engine-server.ts',config],{
  windowsHide:true,stdio:'inherit',env:{...process.env,HEALTH_ENGINE_LOCAL_ONLY:'1',ALGORITHM_PYTHON:path.resolve('.venv/Scripts/python.exe')}});
let stopping=false;
const stop=async()=>{if(stopping)return;stopping=true;child.kill('SIGINT');await pg.close();};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
child.on('exit',async(code)=>{await stop();process.exitCode=code||0;});
