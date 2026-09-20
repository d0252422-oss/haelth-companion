import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';

const input=process.env.MANUAL_SQL_REPORT;
const output=process.env.SYNTHETIC_PERFORMANCE_EVIDENCE_DIR;
if(!input||!output||!path.resolve(output).toLowerCase().startsWith('d:\\dev\\evidence\\'))throw Error('D_DRIVE_EVIDENCE_REQUIRED');
const report=JSON.parse(await readFile(input,'utf8'));
const number=value=>Number.isFinite(Number(value))?Number(value):null;
const elapsed=row=>row.started_at&&row.ended_at?Date.parse(row.ended_at)-Date.parse(row.started_at):number(row.timing?.responseEnd);
const percentile=(values,p)=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!sorted.length)return null;return Number(sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)].toFixed(2));};
const stats=(action,{transport='DIRECT_HTTP_TEST',metric=elapsed}={})=>{const values=report.http.filter(row=>row.action===action&&row.transport===transport&&row.response?.ok===true).map(metric).filter(Number.isFinite);return {samples:values.length,median_ms:percentile(values,.5),p95_ms:percentile(values,.95),worst_ms:percentile(values,1)};};
const dbCommit=stats('addWorkoutRecord',{metric:row=>number(row.response?.data?.timing?.dbCommitMs)});
const result={status:report.errors?.length?'FAIL':'PASS',classification:'LOCAL_PG17_11_SYNTHETIC_NOT_REAL_USER_LATENCY',simple_sql_read:stats('getBodyRecords'),simple_sql_write:stats('upsertBodyRecord'),training_save_api:stats('addWorkoutRecord'),training_db_commit:dbCommit,dashboard_browser:stats('getDashboardData',{transport:'BROWSER_ACTUAL_HTTP'}),timeline_30d_browser:stats('getHealthTimeline',{transport:'BROWSER_ACTUAL_HTTP'}),ui_ready_ms:'INSTRUMENTED_NOT_REAL_USER_MEASURED',background_recompute_ms:'INSTRUMENTED_NOT_REAL_USER_MEASURED',training_range_refresh_ms:'INSTRUMENTED_NOT_REAL_USER_MEASURED',source_report:path.resolve(input),measured_at:new Date().toISOString()};
await mkdir(output,{recursive:true});
await writeFile(path.join(output,'synthetic-sql-performance.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
if(result.status!=='PASS')process.exitCode=1;
