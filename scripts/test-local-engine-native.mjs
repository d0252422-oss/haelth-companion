import {createLocalPostgres} from './local-engine-postgres.mjs';
import {writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
const pg=await createLocalPostgres({port:57484});
const config=path.join(pg.evidence.root,'runtime-config.json');await writeFile(config,JSON.stringify(pg.config));
await writeFile('.engine-artifacts/blocker-closure/native-db.manifest.json',JSON.stringify(pg.evidence,null,2));
try{
 const code=await new Promise((resolve,reject)=>{
  const child=spawn('deno',['test','--config','config/engine-local.deno.json','--junit-path=.engine-artifacts/blocker-closure/native-junit.xml','--allow-env','--allow-read','--allow-write=.engine-artifacts/runtime-e2e,.engine-artifacts/blocker-closure','--allow-sys','--allow-net=127.0.0.1','tests/local-engine-native.test.ts'],{windowsHide:true,stdio:'inherit',env:{...process.env,HEALTH_ENGINE_LOCAL_ONLY:'1',LOCAL_ENGINE_TEST_CONFIG:config}});
  child.on('error',reject);child.on('exit',resolve);
 });process.exitCode=code;
}finally{await pg.close();}
