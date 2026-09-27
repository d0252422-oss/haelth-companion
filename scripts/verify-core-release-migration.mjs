// Offline, read-only migration contract verifier. It never connects to Supabase,
// applies SQL, reads credentials, or changes migration history.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const BETA_PROJECT_REF='uavimjgccigpbwqmfkhh';
export const PRODUCTION_PROJECT_REF='vptqedxdxfoohbqctujf';
export const MIGRATION_VERSION='20260920224000';
export const MIGRATION_NAME='manual_workout_set_order';
export const MIGRATION_PATH='supabase/migrations/20260920224000_manual_workout_set_order.sql';
export const MIGRATION_SHA256='0c95b68ff5eb03e4223ccf842eb68fc085e6e12e4f0053015cdea9e41ce1a25c';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

function migrationHistory(inventory){
  assert.equal(inventory?.projectRef,BETA_PROJECT_REF,'BETA_PROJECT_REF_MISMATCH');
  assert.ok(Array.isArray(inventory?.migrations),'MIGRATION_INVENTORY_REQUIRED');
  const entries=inventory.migrations.map(row=>({version:String(row.version),name:String(row.name??'')}));
  const versions=entries.map(row=>row.version);
  assert.equal(new Set(versions).size,versions.length,'DUPLICATE_REMOTE_MIGRATION_VERSION');
  assert.ok(versions.includes('20260920223000'),'REQUIRED_PREDECESSOR_MISSING');
  return {entries,versions};
}

export async function verifyCoreReleaseMigration({targetProjectRef,inventory,phase='inventory',baselineCount=null,baselineInventory=null,migrationRoot=root}){
  assert.equal(targetProjectRef,BETA_PROJECT_REF,'TARGET_MUST_BE_EXACT_BETA');
  assert.notEqual(targetProjectRef,PRODUCTION_PROJECT_REF,'PRODUCTION_TARGET_FORBIDDEN');
  assert.ok(['inventory','pre','post'].includes(phase),'INVALID_VERIFICATION_PHASE');
  const bytes=await readFile(path.join(migrationRoot,MIGRATION_PATH));
  assert.equal(sha256(bytes),MIGRATION_SHA256,'MIGRATION_BYTES_CHANGED');
  const history=migrationHistory(inventory);
  const candidateRows=history.entries.filter(row=>row.version===MIGRATION_VERSION||row.name===MIGRATION_NAME);
  const exactRows=candidateRows.filter(row=>row.version===MIGRATION_VERSION&&row.name===MIGRATION_NAME);
  const present=candidateRows.length>0,table=inventory.table??null;
  if(phase==='inventory')assert.equal(present,false,'CANDIDATE_MIGRATION_ALREADY_PRESENT_REVIEW_REQUIRED');
  if(phase==='pre'){
    assert.equal(present,false,'CANDIDATE_MIGRATION_ALREADY_PRESENT_REVIEW_REQUIRED');
    assert.ok(table&&Number.isSafeInteger(table.workoutSetCount)&&table.workoutSetCount>=0,'PRE_MIGRATION_ROW_COUNT_REQUIRED');
    assert.equal(table.hasSetOrder,false,'UNEXPECTED_PARTIAL_SET_ORDER_SCHEMA');
    assert.equal(Boolean(table.indexDefinition),false,'UNEXPECTED_PARTIAL_SET_ORDER_INDEX');
    assert.equal(Boolean(table.constraintDefinition),false,'UNEXPECTED_PARTIAL_SET_ORDER_CONSTRAINT');
  }
  if(phase==='post'){
    assert.ok(baselineInventory,'BASELINE_MIGRATION_INVENTORY_REQUIRED');
    const baseline=migrationHistory(baselineInventory);
    assert.equal(baseline.entries.some(row=>row.version===MIGRATION_VERSION||row.name===MIGRATION_NAME),false,'BASELINE_ALREADY_CONTAINS_CANDIDATE');
    const baselineKeys=new Set(baseline.entries.map(row=>`${row.version}\0${row.name}`)),postKeys=new Set(history.entries.map(row=>`${row.version}\0${row.name}`));
    const added=history.entries.filter(row=>!baselineKeys.has(`${row.version}\0${row.name}`));
    const removed=baseline.entries.filter(row=>!postKeys.has(`${row.version}\0${row.name}`));
    assert.equal(removed.length,0,'REMOTE_MIGRATION_HISTORY_REMOVED');
    assert.equal(added.length,1,'EXACTLY_ONE_MIGRATION_HISTORY_ROW_REQUIRED');
    assert.deepEqual(added[0],{version:MIGRATION_VERSION,name:MIGRATION_NAME},'VERSION_PRESERVING_HISTORY_ROW_REQUIRED');
    assert.equal(candidateRows.length,1,'DUPLICATE_OR_MISMATCHED_CANDIDATE_HISTORY');
    assert.equal(exactRows.length,1,'EXACT_CANDIDATE_MIGRATION_HISTORY_MISSING');
    assert.ok(table&&Number.isSafeInteger(table.workoutSetCount)&&table.workoutSetCount>=0,'POST_MIGRATION_ROW_COUNT_REQUIRED');
    assert.ok(Number.isSafeInteger(baselineCount)&&baselineCount>=0,'BASELINE_ROW_COUNT_REQUIRED');
    assert.equal(table.workoutSetCount,baselineCount,'WORKOUT_SET_COUNT_CHANGED');
    assert.equal(table.hasSetOrder,true,'SET_ORDER_COLUMN_MISSING');
    assert.equal(String(table.dataType).toLowerCase(),'integer','SET_ORDER_TYPE_MISMATCH');
    assert.equal(String(table.isNullable).toUpperCase(),'YES','SET_ORDER_MUST_REMAIN_NULLABLE');
    assert.match(String(table.indexDefinition),/create unique index manual_workout_set_order_unique on public\.manual_workout_sets using btree \(canonical_user_id, session_id, set_order\) where \(\(not deleted\) and \(set_order is not null\)\)/i,'SET_ORDER_INDEX_MISMATCH');
    // PostgreSQL CHECK constraints already accept NULL; the column remains
    // nullable and the migration's exact positive-value contract is sufficient.
    assert.match(String(table.constraintDefinition),/check\s*\(\(*set_order > 0\)*\)/i,'SET_ORDER_CONSTRAINT_MISMATCH');
  }
  return {
    status:phase==='post'?'POSTCONDITIONS_VERIFIED_READ_ONLY':'PREPARED_READ_ONLY',phase,targetProjectRef,
    migration:{sourceVersion:MIGRATION_VERSION,name:MIGRATION_NAME,path:MIGRATION_PATH,sha256:MIGRATION_SHA256,remoteHistoryVersion:MIGRATION_VERSION},
    versionPreservingCliContract:{tool:'Supabase CLI db push',projectRef:BETA_PROJECT_REF,workdir:'<ABSOLUTE_ARTIFACT>/migration-workdir',dryRunArgs:['db','push','--dry-run','--skip-vault','--project-ref',BETA_PROJECT_REF,'--workdir','<ABSOLUTE_ARTIFACT>/migration-workdir'],applyArgs:['db','push','--skip-vault','--project-ref',BETA_PROJECT_REF,'--workdir','<ABSOLUTE_ARTIFACT>/migration-workdir'],authenticationMode:'EXISTING_SUPABASE_DB_PASSWORD_ENV',temporaryLoginRoleForbidden:true,interactiveAuthForbidden:true,passwordOnCommandLineForbidden:true,expectedOnlyPendingMigration:MIGRATION_VERSION},
    remoteMigrationCount:history.versions.length,candidateMigrationPresent:present,candidateHistory:{candidateRows,exactRows},baselineCount:phase==='pre'?table.workoutSetCount:baselineCount,
    remoteMutations:0,limitations:['This verifier never applies SQL. Re-run with a fresh read-only inventory immediately before and after a separately authorized version-preserving isolated db push. Never retry an ambiguous timeout before inspecting migration history and schema.']
  };
}

function argumentsOf(values){const result={};for(let i=0;i<values.length;i+=2){assert.ok(values[i]?.startsWith('--')&&values[i+1]!==undefined,'ARGUMENT_PAIRS_REQUIRED');result[values[i].slice(2)]=values[i+1];}return result;}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=argumentsOf(process.argv.slice(2));
  assert.ok(args.target&&args.inventory,'USAGE: --target <beta-ref> --inventory <absolute-json> [--phase inventory|pre|post] [--baseline-count N] [--baseline-inventory <absolute-json>]');
  assert.ok(path.isAbsolute(args.inventory),'ABSOLUTE_INVENTORY_PATH_REQUIRED');
  const inventory=JSON.parse(await readFile(args.inventory,'utf8'));
  if(args['baseline-inventory'])assert.ok(path.isAbsolute(args['baseline-inventory']),'ABSOLUTE_BASELINE_INVENTORY_PATH_REQUIRED');
  const baselineInventory=args['baseline-inventory']?JSON.parse(await readFile(args['baseline-inventory'],'utf8')):null;
  const result=await verifyCoreReleaseMigration({targetProjectRef:args.target,inventory,phase:args.phase??'inventory',baselineCount:args['baseline-count']===undefined?null:Number(args['baseline-count']),baselineInventory});
  console.log(JSON.stringify(result,null,2));
}
