import fs from 'node:fs/promises';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {createLocalPostgres} from './local-engine-postgres.mjs';
const out=process.env.NONPRIV_EVIDENCE_DIR;
if(!out||!path.resolve(out).toLowerCase().startsWith('d:\\dev\\evidence\\'))throw Error('DEDICATED_EVIDENCE_REQUIRED');
await fs.mkdir(out,{recursive:true});let pg;
try{pg=await createLocalPostgres({port:57485});await pg.admin.unsafe('alter role health_manual_api login');
 const config=path.join(out,'local-config.json');await fs.writeFile(config,JSON.stringify(pg.config));
 await fs.writeFile(path.join(out,'postgres.json'),JSON.stringify(pg.evidence,null,2));
 const started=new Date().toISOString();const run=spawnSync('deno',['run','--allow-env','--allow-read','--allow-write','--allow-net','--config','config/engine-local.deno.json','scripts/test-nonprivileged-pg.ts',config,path.join(out,'pg-report.json')],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:5*1024*1024});
 await fs.writeFile(path.join(out,'stdout.log'),run.stdout||'');await fs.writeFile(path.join(out,'stderr.log'),run.stderr||'');
 await fs.writeFile(path.join(out,'command.json'),JSON.stringify({command:'node scripts/test-nonprivileged-pg.mjs',started,ended:new Date().toISOString(),exit_code:run.status,error:run.error?.message},null,2));
 console.log(run.stdout?.slice(-5000));console.log(run.stderr?.slice(-2000));process.exitCode=run.status??1;
}finally{await pg?.close();}
