import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {execFileSync,spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {classifySql,isBaselined} from './ai-pool-policy.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cfg=JSON.parse(fs.readFileSync(path.join(root,'config/ai-pool-v2.tools.json')));
const baseline=JSON.parse(fs.readFileSync(path.join(root,'config/sql-lint-baseline.json')));
const files=[...new Set(execFileSync('git',['--no-optional-locks','ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(f=>f.endsWith('.sql')&&fs.existsSync(path.join(root,f))))];
const changed=[],baselined=[];
for(const f of files){const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex');(isBaselined(baseline,f,hash)?baselined:changed).push(f);}
let result={status:'INFO_BASELINED',blocking:0,parser_errors:0};let raw=[];
if(changed.length){const r=spawnSync(path.join(cfg.venvRoot,'Scripts/python.exe'),['-m','sqlfluff','lint','--dialect','postgres','--format','json','--processes','1',...changed],{cwd:root,encoding:'utf8',timeout:240000,maxBuffer:32*1024*1024,env:{...process.env,PYTHONUTF8:'1'}});try{raw=JSON.parse(r.stdout);result=r.error||![0,1].includes(r.status)?{status:'FAIL_BLOCKING',reason:'SQLFluff execution failure'}:classifySql(raw);}catch{result={status:'FAIL_BLOCKING',reason:'Missing/invalid SQLFluff JSON'};}}
console.log(JSON.stringify({...result,changed,baselined,raw},null,2));process.exitCode=result.status==='FAIL_BLOCKING'?1:0;
