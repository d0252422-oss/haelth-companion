// Offline packaging contract, not deployment/Edge acceptance. Artifacts retained on D.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{readFileSync,mkdirSync}=require('node:fs'),{randomUUID,createHash}=require('node:crypto'),vm=require('node:vm');
for(const release of ['A','AB'])test(`offline ${release} package public release matches manifest and stays OFF`,()=>{
 const output=path.resolve('.engine-artifacts','package-contract-'+randomUUID());
 mkdirSync(path.dirname(output),{recursive:true});
 execFileSync(process.execPath,['scripts/prepare-manual-beta-package.mjs',output,'--release='+release],{cwd:process.cwd(),windowsHide:true,timeout:30000});
 const manifest=JSON.parse(readFileSync(path.join(output,'artifact-manifest.json'),'utf8')),ctx={};
 vm.runInNewContext(readFileSync(path.join(output,'scripts/manual-sql-config.js'),'utf8'),ctx);
 assert.equal(manifest.release,release);assert.equal(ctx.HEALTH_MANUAL_SQL_CONFIG.release,release);assert.equal(ctx.HEALTH_MANUAL_SQL_CONFIG.enabled,false);
 assert.equal(manifest.remote_operations,0);
 assert.equal(manifest.flags.background_sql,'OFF');
 for(const setting of ['HEALTH_BACKGROUND_SQL_ENABLED','HEALTH_NATIVE_DATABASE_URL','HEALTH_RECOMPUTE_DATABASE_URL','HEALTH_RECOMPUTE_TRIGGER_SECRET'])assert.ok(manifest.required_settings.includes(setting));
 assert.deepEqual(manifest.background.roles,['health_native_ingest','health_recompute_worker']);
 assert.match(manifest.backend.actual_edge_execution,/NOT_INFERRED_FROM_SOURCE_PACKAGE/);
 assert.equal(manifest.files.some(f=>f.path.includes('manual_exercise_catalog_sql')),release==='AB');
 assert.ok(manifest.files.some(f=>f.path.includes('engine_queue_publication_guard')));
 for(const file of manifest.files){const b=readFileSync(path.join(output,file.path));assert.equal(createHash('sha256').update(b).digest('hex'),file.sha256);assert.equal(b.length,file.bytes);}
});
