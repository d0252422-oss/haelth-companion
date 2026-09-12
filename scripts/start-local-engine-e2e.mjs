import {createLocalPostgres} from './local-engine-postgres.mjs';
import {writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
const pg=await createLocalPostgres();
const config=path.join(pg.evidence.root,'runtime-config.json');
await writeFile(config,JSON.stringify(pg.config));
await writeFile(path.join(pg.evidence.root,'host-database.manifest.json'),JSON.stringify(pg.evidence,null,2));
const child=spawn('deno',['run','--config','config/engine-local.deno.json','--allow-env','--allow-read','--allow-sys','--allow-net=127.0.0.1','scripts/local-engine-server.ts',config],{
  windowsHide:true,stdio:'inherit',env:{...process.env,HEALTH_ENGINE_LOCAL_ONLY:'1'}});
let stopping=false;
const stop=async()=>{if(stopping)return;stopping=true;child.kill('SIGINT');await pg.close();};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
child.on('exit',async(code)=>{await stop();process.exitCode=code||0;});
