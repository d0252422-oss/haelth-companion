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
  assert.equal(manifest.source_base_revision,manifest.source_revision);
  assert.match(manifest.source_worktree_state,/^(CLEAN|DIRTY)$/);
  assert.match(manifest.source_status_sha256,/^[0-9a-f]{64}$/);
  assert.ok(Number.isSafeInteger(manifest.source_status_entry_count)&&manifest.source_status_entry_count>=0);
 assert.equal(manifest.flags.background_sql,'OFF');
 for(const setting of ['HEALTH_BACKGROUND_SQL_ENABLED','HEALTH_NATIVE_DATABASE_URL','HEALTH_RECOMPUTE_DATABASE_URL','HEALTH_RECOMPUTE_TRIGGER_SECRET'])assert.ok(manifest.required_settings.includes(setting));
 assert.deepEqual(manifest.background.roles,['health_native_ingest','health_recompute_worker']);
 assert.match(manifest.backend.actual_edge_execution,/NOT_INFERRED_FROM_SOURCE_PACKAGE/);
 const releaseAExerciseChain=['20260913041844_manual_exercise_catalog_sql.sql','20260913164026_manual_exercise_category_update.sql','20260920222000_global_exercise_library_v1.sql','20260920223000_manual_exercise_body_parts.sql','20260920224000_manual_workout_set_order.sql'];
 for(const migration of releaseAExerciseChain)assert.equal(manifest.files.some(f=>f.path.endsWith('/'+migration)),release==='AB',`${migration} must follow the AB exercise dependency boundary`);
 assert.deepEqual(manifest.omitted_migrations,release==='A'?releaseAExerciseChain:[]);
 assert.match(readFileSync('scripts/local-engine-postgres.mjs','utf8'),/manualReleaseIncludesMigration\(filename,release\)/u);
 assert.ok(manifest.files.some(f=>f.path.includes('engine_queue_publication_guard')));
 assert.ok(manifest.files.some(f=>f.path==='build.json'));
 for(const file of manifest.files){const b=readFileSync(path.join(output,file.path));assert.equal(createHash('sha256').update(b).digest('hex'),file.sha256);assert.equal(b.length,file.bytes);}
 const packagedHtml=readFileSync(path.join(output,'index.html'),'utf8');
 const packagedPaths=new Set(manifest.files.map(file=>file.path.replaceAll('\\','/')));
 const packagedBuild=JSON.parse(readFileSync(path.join(output,'build.json'),'utf8')),buildContext={URL};
 vm.runInNewContext(readFileSync(path.join(output,'scripts/build-version.js'),'utf8'),buildContext);
 assert.equal(buildContext.HealthBuildVersion.BUILD_ID,packagedBuild.buildId);
 for(const match of packagedHtml.matchAll(/<script\s+[^>]*src=["'](?!https?:|\/\/)([^"'?]+)(?:\?[^"']*)?["']/giu)){
   const localPath=match[1].replace(/^\.\//,'').replaceAll('\\','/');
   assert.ok(packagedPaths.has(localPath),`packaged index references missing local script: ${localPath}`);
   assert.doesNotThrow(()=>readFileSync(path.join(output,localPath)),`packaged local script must exist: ${localPath}`);
 }
});
