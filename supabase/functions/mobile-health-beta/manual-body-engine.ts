// Input adapter only. Manual observations remain MANUAL_WEB, never mobile ingestion.
// The record is date-only; midnight is a deterministic Taipei date anchor, not a
// claimed measurement timestamp. No height, target, calorie or score is invented.
type Json = Record<string, any>;
export function manualBodyEngineRecords(rows: Json[], user: string): Json[] {
  return rows.flatMap(row => {
    const b=row.body, weight=Number(b.weight), fat=b.bodyFat;
    if(!Number.isFinite(weight)||weight<20||weight>500)throw Error('INVALID_STORED_BODY_INPUT');
    if(fat!==null&&fat!==undefined&&(typeof fat!=='number'||!Number.isFinite(fat)||fat<0||fat>100))throw Error('INVALID_STORED_BODY_INPUT');
    const base={subject_ref:user,source:'MANUAL_WEB',revision:Number(row.revision),
      recorded_at:b.date+'T00:00:00+08:00',updated_at:new Date(row.updated_at).toISOString(),source_quality:'UNKNOWN'};
    const values:[string,string,number][]=[['weight','kg',weight]];
    if(fat!==null&&fat!==undefined){values.push(['body_fat','percent',fat],['fat_mass','kg',weight*fat/100]);}
    return values.map(([domain,unit,value])=>({...base,record_id:row.record_id+':'+domain,domain,unit,value}));
  });
}
