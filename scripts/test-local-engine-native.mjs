import {createLocalPostgres} from './local-engine-postgres.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
const output=process.env.LOCAL_ENGINE_NATIVE_EVIDENCE_DIR;
const suite=process.argv.includes('--queue-publication')?'tests/engine-queue-publication.test.ts':'tests/local-engine-native.test.ts';
if(!output||!path.isAbsolute(output))throw Error('EXPLICIT_NEW_NATIVE_EVIDENCE_DIR_REQUIRED');
await mkdir(output,{recursive:false});
const pg=await createLocalPostgres({port:57484});
const config=path.join(pg.evidence.root,'runtime-config.json');await writeFile(config,JSON.stringify(pg.config));
await writeFile(path.join(output,'native-db.manifest.json'),JSON.stringify(pg.evidence,null,2));
try{
 const code=await new Promise((resolve,reject)=>{
  const child=spawn('deno',['test','--cached-only','--frozen-lockfile','--node-modules-dir=none','--config','config/engine-local.deno.json','--junit-path='+path.join(output,'native-junit.xml'),'--allow-env','--allow-read','--allow-write='+output,'--allow-sys','--allow-net=127.0.0.1',suite],{windowsHide:true,stdio:'inherit',env:{...process.env,HEALTH_ENGINE_LOCAL_ONLY:'1',LOCAL_ENGINE_TEST_CONFIG:config}});
  child.on('error',reject);child.on('exit',resolve);
 });process.exitCode=code;
}finally{await pg.close();}
