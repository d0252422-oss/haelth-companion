import assert from 'node:assert/strict';
import {manualBodyEngineRecords} from '../supabase/functions/mobile-health-beta/manual-body-engine.ts';
import {PortableEngineRuntime} from '../supabase/functions/mobile-health-beta/engine-portable.ts';
import {exerciseCategory} from '../supabase/functions/mobile-health-beta/manual-training-local.ts';
const user='11111111-1111-4111-8111-111111111111';
const row=(date:string,weight=80,fat:number|null=20)=>({record_id:'record-'+date,revision:2,updated_at:'2026-09-13T00:00:00Z',body:{date,weight,bodyFat:fat}});
Deno.test('manual body adapter keeps source/units/date/revision; fat mass is same-row percentage arithmetic',()=>{
 const records=manualBodyEngineRecords([row('2026-09-13')],user);
 assert.deepEqual(records.map(r=>[r.domain,r.unit,r.value]),[['weight','kg',80],['body_fat','percent',20],['fat_mass','kg',16]]);
 assert.ok(records.every(r=>r.source==='MANUAL_WEB'&&r.subject_ref===user&&r.revision===2&&r.recorded_at==='2026-09-13T00:00:00+08:00'));
 assert.equal(new Set(records.map(r=>r.record_id)).size,3);
});
Deno.test('missing body fat remains missing while zero stays zero; corrupt stored data is rejected',()=>{
 assert.equal(manualBodyEngineRecords([row('2026-09-13',80,null)],user).length,1);
 assert.deepEqual(manualBodyEngineRecords([row('2026-09-13',80,0)],user).map(r=>r.value),[80,0,0]);
 for(const r of [row('2026-09-13',NaN),row('2026-09-13',80,101)])assert.throws(()=>manualBodyEngineRecords([r],user));
});
Deno.test('existing body engine is insufficient without baseline/target; adapter does not invent personal targets',async()=>{
 const runtime=new PortableEngineRuntime();await runtime.start();
 try{const result=await runtime.execute({algorithm_id:'multi-domain-bundle',algorithm_version:'health-score-v1.0',domain:'multi_domain',subject_ref:user,period_start:'2026-09-13T00:00:00+08:00',period_end:'2026-09-13T23:59:59+08:00',timezone:'Asia/Taipei',canonical_inputs:{date:'2026-09-13',records:manualBodyEngineRecords([row('2026-09-13')],user),calculated_at:'2026-09-13T16:00:00Z'}});
 const body=result.normalized.bundle.outputs.body;assert.equal(body.score,null);assert.equal(body.score_status,'INSUFFICIENT_DATA');assert.equal(body.metrics.BMI,null);assert.equal(body.metrics.derived.weight_7d_avg,80);
 }finally{await runtime.close();}
});
Deno.test('seven prior days feed unchanged body formula; source collision stays ambiguous instead of averaging devices with manual',async()=>{
 const runtime=new PortableEngineRuntime();await runtime.start();
 const rows=Array.from({length:8},(_,i)=>row('2026-09-'+String(6+i).padStart(2,'0'))),records=manualBodyEngineRecords(rows,user);
 const request:any={algorithm_id:'multi-domain-bundle',algorithm_version:'health-score-v1.0',domain:'multi_domain',subject_ref:user,period_start:'2026-09-13T00:00:00+08:00',period_end:'2026-09-13T23:59:59+08:00',timezone:'Asia/Taipei',canonical_inputs:{date:'2026-09-13',records,calculated_at:'2026-09-13T16:00:00Z'}};
 try{const body=(await runtime.execute(request)).normalized.bundle.outputs.body;
 const frozen=(globalThis as any).HEALTH_SCORE_V1_RUNTIME.calculateBodyCompositionScore({weight:80,weightBaseline:80,fatMass:16,fatMassBaseline:16,baselineSampleCount:7});
 assert.equal(body.score,frozen.score);assert.equal(body.metrics.derived.weight_baseline_count,7);assert.equal(body.metrics.BMI,null);
 request.canonical_inputs.records=[...records,...records.filter(r=>r.domain==='weight').map(r=>({...r,source:'HEALTH_CONNECT',record_id:'other-'+r.record_id,value:120}))];
 const ambiguous=(await runtime.execute(request)).normalized.bundle.outputs.body;
 assert.equal(ambiguous.metrics.derived.weight_7d_avg,null);assert.ok(ambiguous.explanations.includes('AMBIGUOUS_SOURCE:weight'));
 }finally{await runtime.close();}
});
Deno.test('exercise category reuses name normalization but has its own forty-character bound',()=>{
 assert.equal(exerciseCategory(' 腿 '),'腿');for(const v of ['',null,'x'.repeat(41),'a\u202eb'])assert.throws(()=>exerciseCategory(v));
});
