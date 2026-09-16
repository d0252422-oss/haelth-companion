import fs from 'node:fs/promises';import path from 'node:path';import {spawnSync} from 'node:child_process';import {randomUUID} from 'node:crypto';
import {createLocalPostgres} from './local-engine-postgres.mjs';import {prepareEdgeTest} from './local-edge-container.mjs';
const out=process.env.WORKER_EVIDENCE_DIR;if(!out||!path.resolve(out).toLowerCase().startsWith('d:\\dev\\evidence\\'))throw Error('EVIDENCE_ROOT_REQUIRED');
await fs.mkdir(out,{recursive:true});let pg,edge;const started=new Date().toISOString();
try{
 pg=await createLocalPostgres({port:57485});await pg.admin.unsafe('alter role health_native_ingest login;alter role health_recompute_worker login');
 const triggerSecret=randomUUID()+randomUUID();edge=await prepareEdgeTest(out,path.join(out,'private'),pg.config,true,true,{triggerSecret});edge.start();
 for(let i=0;i<30;i++){try{if((await fetch('http://127.0.0.1:57921/_health',{signal:AbortSignal.timeout(1000)})).ok)break;}catch{}if(i===29)throw Error('EDGE_START_TIMEOUT');await new Promise(r=>setTimeout(r,500));}
 const config=path.join(out,'private','config.json');await fs.writeFile(config,JSON.stringify({...pg.config,triggerSecret,base:'http://127.0.0.1:57921/functions/v1/mobile-health-beta'}));
 await fs.writeFile(path.join(out,'postgres.json'),JSON.stringify(pg.evidence,null,2));
 const r=spawnSync('deno',['run','--allow-env','--allow-read','--allow-write','--allow-net','--config','config/engine-local.deno.json','scripts/test-background-edge.ts',config,path.join(out,'report.json')],{encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:4*1024*1024});
 await fs.writeFile(path.join(out,'stdout.log'),r.stdout||'');await fs.writeFile(path.join(out,'stderr.log'),r.stderr||'');await fs.writeFile(path.join(out,'command.json'),JSON.stringify({command:'node scripts/test-background-edge.mjs',started,ended:new Date().toISOString(),exit_code:r.status,error:r.error?.message},null,2));console.log(r.stdout?.slice(-3000));console.log(r.stderr?.slice(-1000));process.exitCode=r.status??1;
}finally{if(edge)await fs.writeFile(path.join(out,'edge.json'),JSON.stringify({metadata:edge.metadata,cleanup:await edge.close()},null,2));await pg?.close();}
