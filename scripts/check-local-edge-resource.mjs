// Read-only Docker inspection plus bounded CLI serve in an isolated project, no migrations/start/reset.
import {spawnSync} from 'node:child_process';
import {writeFile,readFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
const root=path.resolve('.engine-artifacts/blocker-closure');
const started_at=new Date().toISOString();
const runId=randomUUID(),workdir=path.join(root,'edge-preflight-'+runId);
await mkdir(path.join(workdir,'supabase'),{recursive:true});
const entry=path.resolve('supabase/functions/mobile-health-beta/index.ts').replaceAll('\\','/');
await writeFile(path.join(workdir,'supabase/config.toml'),`project_id = "health-engine-${runId}"
[api]
port = 57921
[db]
port = 57922
shadow_port = 57920
major_version = 17
[functions.mobile-health-beta]
enabled = true
verify_jwt = false
entrypoint = "${entry}"
`);
const commands=[['supabase',['--version']],['supabase',['functions','serve','--help']],['docker',['context','show']],['docker',['version','--format','{{json .Server}}']],['supabase',['functions','serve','mobile-health-beta','--workdir',workdir]]];
const results=[];
for(const [exe,args] of commands){
 const start=new Date().toISOString();const r=spawnSync(exe,args,{windowsHide:true,encoding:'utf8',timeout:45000});
 results.push({command:[exe,...args],start,end:new Date().toISOString(),exit_code:r.status,error:r.error?.code,stdout:r.stdout,stderr:r.stderr});
}
const log=await readFile(path.join(process.env.LOCALAPPDATA,'Docker/log/host/com.docker.backend.exe.log'),'utf8');
const relevant=log.split(/\r?\n/).filter(line=>line.includes('backend crashed, dumping error')&&line.includes('sailor-ingest.sock')).slice(-1);
const report={source_revision:spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim(),started_at,ended_at:new Date().toISOString(),results,docker_last_socket_failure:relevant,edge_runtime_version:'NOT_VERIFIED',edge_execution:results.at(-1).stdout?.includes('failed to connect to the docker API')?'BLOCKED_DOCKER_API':'NOT_VERIFIED_INSPECT_COMMAND_OUTPUT',not_performed:['factory reset','permissions change','socket removal','db reset','migrations','remote writes','fallback runtime'],cli_serve_attempt:'RESOURCE_PREFLIGHT_ONLY_NOT_ENGINE_ACCEPTANCE'};
await writeFile(path.join(root,'edge-resource-'+runId+'.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
process.exitCode=results.at(-1).exit_code===0?0:1;
