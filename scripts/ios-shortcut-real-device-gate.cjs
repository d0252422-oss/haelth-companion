'use strict';
// Offline preparation only. This command cannot query Health or grant a device PASS.
const {buildSpec}=require('./ios-shortcut-build-spec.cjs');
function prepareGate(at){
 const spec=buildSpec(at);
 return {schema_version:'IOS_SHORTCUT_REAL_DEVICE_GATE_PREPARATION_V1',status:'PENDING_OWNER_DEVICE',template_only:true,
  device_execution:'NOT_RUN',network_operations:0,production_writes:0,windows:spec.windows,
  prerequisites:['Inspect actual Shortcut actions/version/hash','Authorized dedicated Beta account and exact target','Existing user-scoped setup/session flow; no credentials in evidence'],
  cases:spec.windows.map(w=>({domain:w.domain,status:'NOT_RUN',required_evidence:['actual Health query field/unit/window mapping','permission/error/empty distinction','stable record IDs and exact retry bytes','bounded HTTP and user-scoped receipt','SQL row and fresh Web read-back','analysis state separate from ingestion']})),
  cross_domain_cases:['invalid/expired session rejected','A/B tenant isolation','partial acceptance and unchanged-batch retry','duplicate/stale/tombstone behavior','no unexpected health upload destination'],
  acceptance:'Offline template and reported booleans never prove a physical device. Inspect sanitized per-request/SQL/browser evidence before a separately reviewed device result.',
  next_action:'Owner device session only after Beta prerequisites and importable Shortcut are verified; do not execute during non-device run.'};
}
if(require.main===module){try{const args=process.argv.slice(2);if(args.length!==3||args[0]!=='--prepare'||args[1]!=='--at')throw Error('USAGE: --prepare --at YYYY-MM-DDTHH:mm:ss.sssZ');process.stdout.write(JSON.stringify(prepareGate(args[2]),null,2)+'\n');}catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}}
module.exports={prepareGate};
