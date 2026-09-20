import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createLocalPostgres,subjects} from './local-engine-postgres.mjs';

const output=process.env.ENTITLEMENT_ADMIN_EVIDENCE_DIR;
if(!output||!path.resolve(output).toLowerCase().startsWith('d:\\dev\\evidence\\'))throw Error('D_DRIVE_EVIDENCE_REQUIRED');
await mkdir(output,{recursive:true});
let pg;
try{
  pg=await createLocalPostgres({port:57485,release:'AB'});
  const user=subjects.A.canonical;
  let normalUserDenied=false,unknownUserDenied=false;
  try{
    await pg.admin.begin(async tx=>{
      await tx.unsafe('set local role authenticated');
      await tx.unsafe(`select * from public.beta_admin_set_entitlement('${user}'::uuid,'REVOKED',null)`);
    });
  }catch(error){normalUserDenied=error.code==='42501';}
  try{
    await pg.admin.begin(async tx=>{
      await tx.unsafe('set local role service_role');
      await tx.unsafe(`select * from public.beta_admin_get_entitlement('${randomUUID()}'::uuid)`);
    });
  }catch(error){unknownUserDenied=String(error.message).includes('ENTITLEMENT_USER_NOT_FOUND');}
  const revoke=await pg.admin.begin(async tx=>{
    await tx.unsafe('set local role service_role');
    return tx.unsafe(`select * from public.beta_admin_set_entitlement('${user}'::uuid,'REVOKED',null)`);
  });
  const revokeRead=await pg.admin.begin(async tx=>{
    await tx.unsafe('set local role service_role');
    return tx.unsafe(`select * from public.beta_admin_get_entitlement('${user}'::uuid)`);
  });
  const grant=await pg.admin.begin(async tx=>{
    await tx.unsafe('set local role service_role');
    return tx.unsafe(`select * from public.beta_admin_set_entitlement('${user}'::uuid,'BETA',now()+interval '30 days')`);
  });
  const grantRead=await pg.admin.begin(async tx=>{
    await tx.unsafe('set local role service_role');
    return tx.unsafe(`select * from public.beta_admin_get_entitlement('${user}'::uuid)`);
  });
  const pass=normalUserDenied&&unknownUserDenied&&revoke[0]?.access_status==='REVOKED'&&revokeRead[0]?.access_status==='REVOKED'&&grant[0]?.access_status==='BETA'&&grantRead[0]?.access_status==='BETA';
  const report={status:pass?'PASS':'FAIL',classification:'LOCAL_PG17_11_SYNTHETIC_ONLY',normal_user_grant_revoke:normalUserDenied?'DENIED':'FAIL',unknown_user:unknownUserDenied?'FAIL_CLOSED':'FAIL',revoke:revokeRead[0]?.access_status,grant:grantRead[0]?.access_status,read_after_write:pass?'PASS':'FAIL',remote_writes:0,production_writes:0,measured_at:new Date().toISOString()};
  await writeFile(path.join(output,'entitlement-admin-pg17.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
  if(!pass)process.exitCode=1;
}finally{await pg?.close();}
