// Actual Supabase user isolate, not an ordinary Deno server. Docker orchestration
// is reported separately from the CLI full-stack Gate. No remote settings loaded.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const image='public.ecr.aws/supabase/edge-runtime@sha256:c52405002a890ca9fcf77978671c57f3a988e03174afb277f84ac65bc917013c';
const docker=(args)=>execFileSync('docker',['--context','desktop-linux',...args],{encoding:'utf8',windowsHide:true,timeout:60000});
export async function prepareEdgeTest(evidence,privateDir,config,exercise,nonprivileged=false){
 assert.equal(config.host,'127.0.0.1');assert.equal(config.port,57485);assert.match(config.database,/^health_engine_[a-f0-9]{32}$/);
 const endpoint=JSON.parse(docker(['context','inspect','desktop-linux','--format','{{json .Endpoints.docker}}']));
 assert.equal(endpoint.Host,'npipe:////./pipe/dockerDesktopLinuxEngine');
 const server=JSON.parse(docker(['version','--format','{{json .Server}}']));assert.equal(server.Os,'linux');
 docker(['image','inspect',image,'--format','{{.Id}}']); // --pull=never below
 const root=path.join(evidence,'actual-edge');await mkdir(root,{recursive:true});
 const tls=path.join(privateDir,'tls');await mkdir(tls,{recursive:true});
 const cert=path.join(tls,'server.pem'),key=path.join(tls,'server.key'),ca=path.join(tls,'ca.pem'),caKey=path.join(tls,'ca.key'),csr=path.join(tls,'server.csr'),extensions=path.join(tls,'server.ext');
 const openssl=args=>execFileSync('C:/Program Files/Git/usr/bin/openssl.exe',args,{windowsHide:true,stdio:'ignore',timeout:10000});
 // Rustls correctly rejects a CA certificate used as the HTTPS leaf. Issue a
 // separate CA:false server leaf; trust only this ephemeral CA inside the test.
 openssl(['req','-x509','-newkey','rsa:2048','-noenc','-days','2','-subj','/CN=Health Companion isolated test CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign','-keyout',caKey,'-out',ca]);
 openssl(['req','-new','-newkey','rsa:2048','-noenc','-subj','/CN=host.docker.internal','-keyout',key,'-out',csr]);
 await writeFile(extensions,'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:host.docker.internal,IP:127.0.0.1\n');
 openssl(['x509','-req','-in',csr,'-CA',ca,'-CAkey',caKey,'-set_serial','1','-days','2','-extfile',extensions,'-out',cert]);
 openssl(['verify','-CAfile',ca,'-purpose','sslserver','-verify_hostname','host.docker.internal',cert]);
 const tlsConfig=path.join(privateDir,'tls-config.json');await writeFile(tlsConfig,JSON.stringify({cert,key}));
 await writeFile(path.join(root,'cert.pem'),await readFile(ca)); // Public local CA only
 const sql={host:'host.docker.internal',port:config.port,database:config.database,username:nonprivileged?'health_manual_api':'service_role'};
 const source=path.join(root,'source');await mkdir(source,{recursive:true});const sourceHashes={};
 const files=execFileSync('git',['--no-optional-locks','ls-files','supabase/functions/mobile-health-beta'],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/).concat(['config/engine-local.deno.json','config/engine-local.deno.lock','fixtures/algorithm-golden/apps-script-health-score-v1.0.snapshot.js']);
 for(const file of new Set([...files,'supabase/functions/mobile-health-beta/manual-sql-context.ts','supabase/functions/mobile-health-beta/hosted-database-ca.ts'])){const bytes=await readFile(file);const target=path.join(source,file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);sourceHashes[file]=createHash('sha256').update(bytes).digest('hex');}
 await writeFile(path.join(root,'source-hashes.json'),JSON.stringify(sourceHashes,null,2));
 const importMap=JSON.parse(await readFile('config/engine-local.deno.json','utf8'));
 await writeFile(path.join(root,'import-map.json'),JSON.stringify({imports:importMap.imports}));
 const env={HEALTH_ENGINE_LOCAL_ONLY:'1',HEALTH_MANUAL_EDGE_REHEARSAL:'1',HEALTH_MANUAL_SQL_LOCAL_CONFIG:JSON.stringify(sql),HEALTH_MANUAL_LOCAL_ORIGIN:'http://127.0.0.1:57841',HEALTH_MANUAL_WEB_SESSION_LOCAL:'1',HEALTH_EXERCISE_MANAGEMENT_LOCAL:exercise?'1':'0',SUPABASE_URL:'http://host.docker.internal:57841',SUPABASE_PUBLISHABLE_KEYS:JSON.stringify({default:'local-sdk-construction-fixture'}),SUPABASE_SECRET_KEYS:JSON.stringify({default:'local-sdk-construction-fixture'}),BETA_WEB_AUTH_VERIFY_URL:'https://host.docker.internal:57842/local-verify-web',SSL_CERT_FILE:'/test/cert.pem',DENO_TLS_CA_STORE:'mozilla,system'};
 await writeFile(path.join(root,'local.env'),Object.entries(env).map(([k,v])=>`${k}=${v}`).join('\n')+'\n');
 await writeFile(path.join(root,'index.ts'),`// Local main-worker dispatcher using official EdgeRuntime userWorkers API.
console.log(JSON.stringify({event:'ACTUAL_SUPABASE_EDGE_BOOT',version:Deno.version}));
Deno.serve(async(req)=>{
 if(new URL(req.url).pathname==='/_health')return Response.json({runtime:'SUPABASE_EDGE_USER_ISOLATES'});
 if(!new URL(req.url).pathname.startsWith('/functions/v1/mobile-health-beta/'))return new Response('NOT_FOUND',{status:404});
 try{
  const worker=await EdgeRuntime.userWorkers.create({servicePath:'/project/supabase/functions/mobile-health-beta',maybeEntrypoint:'file:///project/supabase/functions/mobile-health-beta/test-entry.ts',context:{importMapPath:'/test/import-map.json'},memoryLimitMb:256,workerTimeoutMs:150000,noModuleCache:false,forceCreate:false,cpuTimeSoftLimitMs:2000,cpuTimeHardLimitMs:2000,envVars:Object.entries(Deno.env.toObject())});
  return await worker.fetch(req,{signal:AbortSignal.timeout(30000)});
 }catch(error){console.error(String(error));return Response.json({error:'EDGE_DISPATCH_FAILED'},{status:503});}
});
`);
 await writeFile(path.join(source,'supabase/functions/mobile-health-beta/test-entry.ts'),`import application from './index.ts';
console.log(JSON.stringify({event:'ACTUAL_PRODUCT_HANDLER_USER_ISOLATE',version:Deno.version,pythonRequired:false}));
Deno.serve(application.fetch);
`);
 const name='health-edge-'+randomUUID();let started=false;
 return {tlsConfig,proxy:'http://127.0.0.1:57921/functions/v1/mobile-health-beta/v1/engine/web',metadata:{image,server,name,orchestrator:'DOCKER_DIRECT_OFFICIAL_EDGE_NOT_SUPABASE_CLI_STACK',policy:'per_request',limits:{memoryMb:256,cpuMsPerRequest:2000,workerWallMs:150000},hostEngine:false,syntheticAuth:'real ES256 verification via dedicated TLS issuer; not Google OAuth'},
 start(){
  docker(['run','--detach','--pull=never','--name',name,'--label','health.test=actual-edge','--memory','768m','--cpus','2','-p','127.0.0.1:57921:9000','--env-file',path.join(root,'local.env'),'--mount',`type=bind,source=${source},target=/project,readonly`,'--mount',`type=bind,source=${root},target=/test,readonly`,'--entrypoint','edge-runtime',image,'start','--main-service','/test','--policy','per_request','--max-parallelism','4','--user-worker-request-idle-timeout','30000','--request-read-timeout','10000']);started=true;
 },
 async close(){let resourceErrors=[];if(started){const logs=spawnSync('docker',['--context','desktop-linux','logs',name],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:8*1024*1024});await writeFile(path.join(root,'runtime.stdout.log'),logs.stdout||'');await writeFile(path.join(root,'runtime.stderr.log'),logs.stderr||'');resourceErrors=((logs.stdout||'')+'\n'+(logs.stderr||'')).split(/\r?\n/).filter(line=>/CPU time hard limit|memory limit reached|worker boot error|WorkerRequestCancelled/.test(line));docker(['stop','--time','20',name]);assert.equal(logs.status,0,'Runtime logs must be preserved');}return {retainedContainer:name,removed:false,resourceErrors};}
 };
}
