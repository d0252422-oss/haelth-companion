// Extends existing Web action names. Synthetic/local feature remains OFF by default.
import { localReadRange, localToday, manualDate, rejectClientIdentity } from './manual-body-local.ts';
import {prepareManualRead,prepareManualWrite,manualPrivilegedRead} from './manual-web-identity.ts';
type Json = Record<string, any>;
const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const analysis = { analysisStatus: 'ANALYSIS_PENDING', analysisReason: 'MANUAL_WORKOUT_ADAPTER_NOT_CONNECTED', analysisJobScheduled: false };
const sha = async (v: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v))))).map(b=>b.toString(16).padStart(2,'0')).join('');
export function exerciseName(v: unknown) {
  if (typeof v !== 'string') throw Error('INVALID_EXERCISE_NAME');
  const normalized=v.trim().normalize('NFC');
  if (!normalized || /[\p{Cc}\p{Cf}]/u.test(normalized)) throw Error('INVALID_EXERCISE_NAME');
  const name=normalized.replace(/\s+/gu,' ');
  if ([...name].length>80) throw Error('INVALID_EXERCISE_NAME');
  return name; // Output always rendered with textContent / escapeHtml, never interpreted as HTML.
}
export function exerciseCategory(v:unknown){
  const value=exerciseName(v);
  if([...value].length>40)throw Error('INVALID_EXERCISE_CATEGORY');
  return value;
}
const publicBodyPart=(r:Json)=>({bodyPartId:r.body_part_id,canonicalKey:r.canonical_key??null,
  displayName:r.display_name,source:r.source,custom:r.source==='USER'});
function setValues(v: Json) {
  const weight=v.weight, reps=v.reps;
  if (typeof weight!=='number'||!Number.isFinite(weight)||weight<0||weight>1000||!Number.isSafeInteger(reps)||reps<1||reps>10000) throw Error('INVALID_WORKOUT_SET');
  return {weight,reps,totalVolume:Math.round(weight*reps*1000000)/1000000,totalSets:1};
}
const publicExercise = (r: Json) => ({exerciseId:r.exercise_id, exerciseName:r.alias??r.exercise_name, originalName:r.exercise_name,
  muscleGroup:r.muscle_group,bodyPartId:r.body_part_id,bodyPartName:r.body_part_display_name,
  bodyPartKey:r.body_part_canonical_key??null,bodyPartSource:r.body_part_source,
  active:!r.archived, archived:r.archived===true, revision:Number(r.revision??0), custom:r.owner_user_id!==null});

export class ManualTrainingLocalStore {
  constructor(private sql: any) {}
  async catalog(identity: Json) {
    return await this.sql.begin(async (tx: any)=>{
      await prepareManualRead(tx,identity);
      const rows=await tx`select c.*,b.display_name as body_part_display_name,b.canonical_key as body_part_canonical_key,
        b.source as body_part_source,p.alias,p.archived,p.revision from public.manual_exercise_catalog c
        join public.manual_exercise_body_parts b on b.body_part_id=c.body_part_id
        left join public.manual_exercise_preferences p on p.exercise_id=c.exercise_id and p.canonical_user_id=${identity.canonical}
        where c.owner_user_id is null or c.owner_user_id=${identity.canonical} order by c.exercise_id limit 1001`;
      if(rows.length>1000)throw Error('READ_BOUND_EXCEEDED');
      return rows.map(publicExercise);
    });
  }
  async bodyParts(identity:Json){
    return await this.sql.begin(async(tx:any)=>{
      await prepareManualRead(tx,identity);
      const rows=await tx`select body_part_id,canonical_key,display_name,source
        from public.manual_exercise_body_parts
        where source='SYSTEM' or owner_user_id=${identity.canonical}
        order by case source when 'SYSTEM' then 0 else 1 end,
          case canonical_key when 'CHEST' then 1 when 'BACK' then 2 when 'SHOULDERS' then 3
            when 'BICEPS' then 4 when 'TRICEPS' then 5 when 'LEGS' then 6 when 'GLUTES' then 7
            when 'CORE' then 8 when 'FULL_BODY' then 9 when 'CARDIO' then 10 when 'OTHER' then 11 else 99 end,
          display_name
        limit 201`;
      if(rows.length>200)throw Error('READ_BOUND_EXCEEDED');
      return rows.map(publicBodyPart);
    });
  }
  async workouts(identity: Json,input: Json={}) {
    const {start,end}=localReadRange(input);
    return await this.sql.begin(async(tx:any)=>{
      await prepareManualRead(tx,identity);
      const rows=await tx`select s.body,s.revision,snapshot_part.body_part_id,
        snapshot_part.display_name as body_part_display_name,
        snapshot_part.canonical_key as body_part_canonical_key
        from public.manual_workout_sets s
        left join lateral (
          select b.body_part_id,b.display_name,b.canonical_key
          from public.manual_exercise_body_parts b
          where case
            when nullif(s.body->>'bodyPartId','') is not null
              then b.body_part_id=s.body->>'bodyPartId'
            else (
              b.source='SYSTEM' and (
                lower(b.canonical_key)=lower(btrim(s.body->>'muscleGroup'))
                or lower(btrim(regexp_replace(normalize(b.display_name, NFC),'[[:space:]]+',' ','g')))
                  =lower(btrim(regexp_replace(normalize(s.body->>'muscleGroup', NFC),'[[:space:]]+',' ','g')))
              )
            ) or (
              b.source='USER' and b.owner_user_id=s.canonical_user_id
              and lower(btrim(regexp_replace(normalize(b.display_name, NFC),'[[:space:]]+',' ','g')))
                =lower(btrim(regexp_replace(normalize(s.body->>'muscleGroup', NFC),'[[:space:]]+',' ','g')))
            )
          end
          order by case b.source when 'SYSTEM' then 0 else 1 end
          limit 1
        ) snapshot_part on true
        where s.canonical_user_id=${identity.canonical}
        and not deleted and local_date between ${start}::date and ${end}::date order by local_date,record_id limit 5001`;
      if(rows.length>5000)throw Error('READ_BOUND_EXCEEDED');
      const records=rows.map((r:Json)=>({...r.body,bodyPartId:r.body.bodyPartId??r.body_part_id,
        bodyPartName:r.body.bodyPartName??r.body_part_display_name,
        bodyPartKey:r.body.bodyPartKey??r.body_part_canonical_key??null,revision:Number(r.revision)}));
      const sessions=new Map<string,number>(),muscles=new Map<string,Json>();
      for(const r of records){
        sessions.set(r.sessionId,Math.max(sessions.get(r.sessionId)||0,r.durationMinutes));
        const key=r.bodyPartId||r.muscleGroup,current=muscles.get(key);
        muscles.set(key,{bodyPartId:r.bodyPartId,bodyPartName:r.bodyPartName,muscleGroup:r.bodyPartKey??r.muscleGroup,totalSets:(current?.totalSets||0)+1});
      }
      return {records,totalSets:records.length,totalVolume:records.length?records.reduce((n:number,r:Json)=>n+r.totalVolume,0):null,
        sessionCount:sessions.size,durationMinutes:records.length?[...sessions.values()].reduce((a,b)=>a+b,0):null,
        muscleDistribution:[...muscles.values()],...analysis};
    });
  }
  async status(identity: Json,input: Json) {
    if(!uuid(input.clientRequestId))throw Error('INVALID_MUTATION_ID');
    const rows=await manualPrivilegedRead(this.sql,identity,tx=>tx`select response from private.manual_training_receipts where canonical_user_id=${identity.canonical} and request_id=${input.clientRequestId}`);
    return {exists:rows.length===1,...rows[0]?.response};
  }
  async selected(tx:any,user:string,id:unknown,allowArchived=false) {
    if(typeof id!=='string'||!id||id.length>128)throw Error('INVALID_EXERCISE_ID');
    let c=(await tx`select c.*,b.display_name as body_part_display_name,b.canonical_key as body_part_canonical_key,
      b.source as body_part_source from public.manual_exercise_catalog c
      join public.manual_exercise_body_parts b on b.body_part_id=c.body_part_id
      where c.exercise_id=${id} and (c.owner_user_id is null or c.owner_user_id=${user})`)[0];
    // Shared catalog is immutable to the runtime role. SELECT FOR KEY SHARE would
    // apply its owner-only UPDATE policy and hide shared exercises. The FK locks
    // the referenced key on insertion; retain the explicit lock for owned rows.
    if(c?.owner_user_id!==null&&c)c=(await tx`select c.*,b.display_name as body_part_display_name,
      b.canonical_key as body_part_canonical_key,b.source as body_part_source
      from public.manual_exercise_catalog c join public.manual_exercise_body_parts b on b.body_part_id=c.body_part_id
      where c.exercise_id=${id} and c.owner_user_id=${user} for key share of c`)[0];
    if(!c)throw Error('EXERCISE_NOT_FOUND');
    await tx`insert into public.manual_exercise_preferences(canonical_user_id,exercise_id) values(${user},${id}) on conflict do nothing`;
    const p=(await tx`select * from public.manual_exercise_preferences where canonical_user_id=${user} and exercise_id=${id} for update`)[0];
    if(p.archived&&!allowArchived)throw Error('EXERCISE_ARCHIVED');
    return {...c,...p};
  }
  async resolveBodyPart(tx:any,user:string,input:Json){
    const explicitId=input.bodyPartId,explicitName=input.newBodyPartName;
    if(explicitId!==undefined&&explicitName!==undefined)throw Error('AMBIGUOUS_BODY_PART_MODE');
    if(explicitId!==undefined){
      if(typeof explicitId!=='string'||!explicitId||explicitId.length>128)throw Error('INVALID_BODY_PART_ID');
      const row=(await tx`select * from public.manual_exercise_body_parts where body_part_id=${explicitId}
        and (source='SYSTEM' or owner_user_id=${user})`)[0];
      if(!row)throw Error('BODY_PART_NOT_FOUND');
      return {...row,reused:true};
    }
    const legacyName=explicitName===undefined?input.muscleGroup:explicitName;
    const name=exerciseCategory(legacyName);
    const existing=(await tx`select * from public.manual_exercise_body_parts
      where (source='SYSTEM' or owner_user_id=${user})
        and private.manual_body_part_normalized_name(display_name)=private.manual_body_part_normalized_name(${name})
      order by case source when 'SYSTEM' then 0 else 1 end limit 1`)[0];
    if(existing)return {...existing,reused:true};
    const count=(await tx`select count(*)::int as n from public.manual_exercise_body_parts where owner_user_id=${user}`)[0].n;
    if(count>=100)throw Error('CUSTOM_BODY_PART_BOUND_EXCEEDED');
    const id=`custom:${crypto.randomUUID()}`;
    await tx`insert into public.manual_exercise_body_parts(body_part_id,canonical_key,display_name,source,owner_user_id)
      values(${id},null,${name},'USER',${user})`;
    return {body_part_id:id,canonical_key:null,display_name:name,source:'USER',owner_user_id:user,reused:false};
  }
  async cleanupUnusedBodyPart(tx:any,user:string,bodyPartId:string){
    await tx`delete from public.manual_exercise_body_parts b
      where b.body_part_id=${bodyPartId} and b.source='USER' and b.owner_user_id=${user}
        and not exists(
          select 1 from public.manual_exercise_catalog c where c.body_part_id=b.body_part_id
        )
        and not exists(
          select 1 from public.manual_workout_sets s
          where s.canonical_user_id=${user}
            and (
              s.body->>'bodyPartId'=b.body_part_id
              or (
                nullif(s.body->>'bodyPartId','') is null
                and private.manual_body_part_normalized_name(s.body->>'muscleGroup')
                  =private.manual_body_part_normalized_name(b.display_name)
              )
            )
        )`;
  }
  async write(identity:Json,action:string,input:Json) {
    rejectClientIdentity(input);
    if(!uuid(input.clientRequestId))throw Error('INVALID_MUTATION_ID');
    const hash=await sha({action,input}),user=identity.canonical;
    const writeStarted=performance.now(),result=await this.sql.begin(async(tx:any)=>{
      await prepareManualWrite(tx,identity);
      // Same canonical lock as body/meals; serializes absent preference rows as well.
      await tx`select pg_advisory_xact_lock(hashtextextended(${user},0))`;
      const receipt=(await tx`select input_hash,response from private.manual_training_receipts where canonical_user_id=${user} and request_id=${input.clientRequestId}`)[0];
      if(receipt){if(receipt.input_hash!==hash)throw Error('REQUEST_ID_CONFLICT');return {...receipt.response,replayed:true};}
      let result:Json;
      if(action==='manageExercise'&&input.operation==='create') {
        const name=exerciseName(input.name),part=await this.resolveBodyPart(tx,user,input);
        if(input.exerciseId!==undefined||input.revision!==undefined)throw Error('SERVER_EXERCISE_ID_REQUIRED');
        if((await tx`select 1 from public.manual_exercise_catalog where owner_user_id=${user}
          and private.exercise_normalized_name(exercise_name)=private.exercise_normalized_name(${name}) limit 1`).length)throw Error('DUPLICATE_CUSTOM_EXERCISE_NAME');
        const count=(await tx`select count(*)::int as n from public.manual_exercise_catalog where owner_user_id is null or owner_user_id=${user}`)[0].n;
        if(count>=1000)throw Error('EXERCISE_CATALOG_BOUND_EXCEEDED');
        const id=crypto.randomUUID();
        const category=part.canonical_key??part.display_name;
        await tx`insert into public.manual_exercise_catalog(exercise_id,owner_user_id,exercise_name,muscle_group,body_part_id)
          values(${id},${user},${name},${category},${part.body_part_id})`;
        await tx`insert into public.manual_exercise_preferences(canonical_user_id,exercise_id,revision) values(${user},${id},1)`;
        result={exerciseId:id,exerciseName:name,muscleGroup:category,bodyPartId:part.body_part_id,
          bodyPartName:part.display_name,bodyPartKey:part.canonical_key??null,bodyPartSource:part.source,
          bodyPartReused:part.reused,revision:1,operation:'create',status:'SAVED'};
      } else if(action==='manageExercise') {
        const row=await this.selected(tx,user,input.exerciseId,true);
        if(!Number.isSafeInteger(input.revision)||input.revision!==Number(row.revision))throw Error('STALE_REVISION');
        const revision=Number(row.revision)+1,operation=input.operation;
        if(operation==='rename') {
          const name=exerciseName(input.name);
          if(row.owner_user_id===user)await tx`update public.manual_exercise_catalog set exercise_name=${name} where exercise_id=${row.exercise_id} and owner_user_id=${user}`;
          else await tx`update public.manual_exercise_preferences set alias=${name} where canonical_user_id=${user} and exercise_id=${row.exercise_id}`;
        } else if(operation==='classify') {
          if(row.owner_user_id!==user)throw Error('SYSTEM_EXERCISE_CATEGORY_READ_ONLY');
          const part=await this.resolveBodyPart(tx,user,input);
          await tx`update public.manual_exercise_catalog set body_part_id=${part.body_part_id}
            where exercise_id=${row.exercise_id} and owner_user_id=${user}`;
          await this.cleanupUnusedBodyPart(tx,user,row.body_part_id);
        } else if(operation==='archive'||operation==='restore') {
          await tx`update public.manual_exercise_preferences set archived=${operation==='archive'} where canonical_user_id=${user} and exercise_id=${row.exercise_id}`;
        } else if(operation==='delete') {
          if(row.owner_user_id!==user)throw Error('SYSTEM_EXERCISE_CANNOT_DELETE');
          if((await tx`select 1 from public.manual_workout_sets where canonical_user_id=${user} and exercise_id=${row.exercise_id} limit 1`).length)throw Error('EXERCISE_REFERENCED');
          // A concurrent FK reference cannot slip between checking and deleting.
          await tx`delete from public.manual_exercise_preferences where canonical_user_id=${user} and exercise_id=${row.exercise_id}`;
          await tx`delete from public.manual_exercise_catalog where exercise_id=${row.exercise_id} and owner_user_id=${user}`;
          if(row.body_part_source==='USER')await this.cleanupUnusedBodyPart(tx,user,row.body_part_id);
        } else throw Error('INVALID_EXERCISE_OPERATION');
        if(operation!=='delete')await tx`update public.manual_exercise_preferences set revision=${revision} where canonical_user_id=${user} and exercise_id=${row.exercise_id}`;
        result={exerciseId:row.exercise_id,revision,operation,deleted:operation==='delete',status:'SAVED',previous:publicExercise(row)};
      } else if(action==='addWorkoutRecord') {
        const date=manualDate(input.date);
        if(date>localToday())throw Error('FUTURE_WORKOUT_UNSUPPORTED');
        const start=Date.parse(input.startTime),end=Date.parse(input.endTime);
        if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||end-start>86400000)throw Error('INVALID_WORKOUT_TIME');
        const durationMinutes=Math.max(1,Math.round((end-start)/60000));
        if(!Array.isArray(input.exercises)||!input.exercises.length||input.exercises.length>50)throw Error('INVALID_WORKOUT_EXERCISES');
        const seen=new Set(),records:Json[]=[],sessionId=crypto.randomUUID();
        for(const exercise of input.exercises) {
          rejectClientIdentity(exercise);
          if(seen.has(exercise.exerciseId))throw Error('DUPLICATE_EXERCISE_ID');seen.add(exercise.exerciseId);
           const selected=await this.selected(tx,user,exercise.exerciseId);
          if(!Array.isArray(exercise.sets))throw Error('INVALID_WORKOUT_SET');
          for(const set of exercise.sets){rejectClientIdentity(set);records.push({recordId:crypto.randomUUID(),sessionId,date,exerciseId:selected.exercise_id,
            exerciseName:selected.alias??selected.exercise_name,muscleGroup:selected.muscle_group,bodyPartId:selected.body_part_id,
            bodyPartName:selected.body_part_display_name,bodyPartKey:selected.body_part_canonical_key??null,
            ...setValues(set),durationMinutes,revision:1,source:'MANUAL_WEB',...analysis});}
        }
        if(!records.length||records.length>200)throw Error('WORKOUT_SET_BOUND_EXCEEDED');
        for(const body of records) await tx`insert into public.manual_workout_sets(canonical_user_id,record_id,exercise_id,session_id,local_date,revision,body)
          values(${user},${body.recordId},${body.exerciseId},${sessionId},${date},1,${tx.json(body)})`;
        result={records,sessionId,status:'SAVED',...analysis};
      } else if(action==='updateWorkoutSet'||action==='deleteWorkoutSet') {
        if(!uuid(input.recordId))throw Error('INVALID_MUTATION_ID');
        const old=(await tx`select * from public.manual_workout_sets where canonical_user_id=${user} and record_id=${input.recordId} for update`)[0];
        if(!old)throw Error('WORKOUT_NOT_FOUND');
        if(old.deleted)throw Error('WORKOUT_DELETED');
        if(!Number.isSafeInteger(input.revision)||input.revision!==Number(old.revision))throw Error('STALE_REVISION');
        const remove=action==='deleteWorkoutSet',revision=Number(old.revision)+1;
        let body={...old.body,revision};
        if(!remove){
          const date=manualDate(input.date);if(date>localToday())throw Error('FUTURE_WORKOUT_UNSUPPORTED');
          const exerciseId=input.exerciseId??old.exercise_id;
          const selected=await this.selected(tx,user,exerciseId,exerciseId===old.exercise_id);
          body={...body,date,...setValues(input),exerciseId};
          // Weight-only edits retain the historical snapshot, including archived IDs.
          if(exerciseId!==old.exercise_id)body={...body,exerciseName:selected.alias??selected.exercise_name,
            muscleGroup:selected.muscle_group,bodyPartId:selected.body_part_id,
            bodyPartName:selected.body_part_display_name,bodyPartKey:selected.body_part_canonical_key??null};
        }
        await tx`update public.manual_workout_sets set exercise_id=${body.exerciseId},local_date=${body.date},revision=${revision},deleted=${remove},body=${tx.json(body)},updated_at=now()
          where canonical_user_id=${user} and record_id=${input.recordId}`;
        result={record:body,recordId:input.recordId,deleted:remove,status:'SAVED',invalidatedDates:[...new Set([old.body.date,body.date])],...analysis};
      } else throw Error('INVALID_TRAINING_ACTION');
      await tx`insert into private.manual_training_receipts values(${user},${input.clientRequestId},${hash},${tx.json(result)})`;
      return result;
    });
    return {...result,timing:{requestId:input.clientRequestId,dbCommitMs:Number((performance.now()-writeStarted).toFixed(2)),committedAt:new Date().toISOString()}};
  }
}
