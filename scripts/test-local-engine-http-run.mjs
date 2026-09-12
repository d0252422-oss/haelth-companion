// Standalone fresh HTTP regression; owns only a new loopback synthetic cluster and child.
import {createLocalPostgres} from './local-engine-postgres.mjs';
import {writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
const pg=await createLocalPostgres();
const config=path.join(pg.evidence.root,'runtime-config.json');
await writeFile(config,JSON.stringify(pg.config));
const child=spawn('deno',['run','--config','config/engine-local.deno.json','--allow-env','--allow-read','--allow-sys','--allow-net=127.0.0.1','scripts/local-engine-server.ts',config],{windowsHide:true,stdio:['ignore','inherit','inherit'],env:{...process.env,HEALTH_ENGINE_LOCAL_ONLY:'1'}});
const closed=new Promise(resolve=>child.once('exit',resolve));
try{
 let ready=false;
 for(let i=0;i<40;i++){
  if(child.exitCode!==null)throw Error('HTTP_HOST_EXIT');
  try{if((await fetch('http://127.0.0.1:57841/local-health',{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,250));
 }
 if(!ready)throw Error('HTTP_HOST_HEALTH_TIMEOUT');
 process.exitCode=await new Promise((resolve,reject)=>{
  const tests=spawn(process.execPath,['--test','--test-reporter=junit','--test-reporter-destination=.engine-artifacts/blocker-closure/http.xml','tests/local-engine-http.test.mjs'],{windowsHide:true,stdio:'inherit'});
  tests.on('exit',resolve);tests.on('error',reject);
 });
 await writeFile('.engine-artifacts/blocker-closure/http-db.json',JSON.stringify(pg.evidence,null,2));
}finally{
 child.kill('SIGINT');
 await Promise.race([closed,new Promise(r=>setTimeout(r,5000))]);
 if(child.exitCode===null)child.kill();
 await pg.close();
}
