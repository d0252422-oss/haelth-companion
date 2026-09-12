import {createLocalPostgres} from './local-engine-postgres.mjs';
import {writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
const pg=await createLocalPostgres({port:57484});
const config=path.join(pg.evidence.root,'runtime-config.json');await writeFile(config,JSON.stringify(pg.config));
await writeFile('.engine-artifacts/runtime-e2e/native-db.manifest.json',JSON.stringify(pg.evidence,null,2));
try{
 const code=await new Promise((resolve,reject)=>{
  const child=spawn('deno',['test','--config','config/engine-local.deno.json','--junit-path=.engine-artifacts/runtime-e2e/native-junit.xml','--allow-env','--allow-read','--allow-write=.engine-artifacts/runtime-e2e','--allow-run','--allow-sys','--allow-net=127.0.0.1','tests/local-engine-native.test.ts'],{windowsHide:true,stdio:'inherit',env:{...process.env,HEALTH_ENGINE_LOCAL_ONLY:'1',LOCAL_ENGINE_TEST_CONFIG:config,ALGORITHM_PYTHON:path.resolve('.venv/Scripts/python.exe')}});
  child.on('error',reject);child.on('exit',resolve);
 });process.exitCode=code;
}finally{await pg.close();}
