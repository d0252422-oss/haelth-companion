// Project only verified, published daily metrics into the existing Web read contract.
// No new aggregation, score mapping, source fallback or target assumptions.
import { localReadRange, rejectClientIdentity } from './manual-body-local.ts';
import { manualPrivilegedRead, prepareManualRead } from './manual-web-identity.ts';
type Json = Record<string, any>;
const pgDay = (v: any) => v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
export async function readPublishedDaily(sql: any, identity: Json, domain: 'sleep' | 'activity', input: Json = {}) {
  rejectClientIdentity(input);
  const range = localReadRange(input);
  return await manualPrivilegedRead(sql, identity, async (tx: any) => {
    const queue = await tx`select score_date,status,generation,engine_published_generation from private.beta_score_recompute_queue
      where canonical_user_id=${identity.canonical} and score_date between ${range.start}::date and ${range.end}::date`;
    await prepareManualRead(tx, identity);
    const rows = await tx`select h.calculation_date,h.payload from public.engine_output_heads p join public.engine_output_history h
      using(canonical_user_id,calculation_date,output_kind,engine_version,input_fingerprint)
      where p.canonical_user_id=${identity.canonical} and p.calculation_date between ${range.start}::date and ${range.end}::date
      and p.output_kind=${domain} and p.engine_version=${domain+'-score-v1.0'} order by p.calculation_date limit 367`;
    if (rows.length > 366) throw Error('READ_BOUND_EXCEEDED');
    const publication = new Map(queue.map((q: Json) => [pgDay(q.score_date), q]));
    return rows.map((row: Json) => {
      const date = pgDay(row.calculation_date), q = publication.get(date) as Json | undefined, out = row.payload;
      const current = q?.status === 'COMPLETE' && BigInt(q.engine_published_generation) > 0n && String(q.engine_published_generation) === String(q.generation)
        && !['STALE', 'ERROR'].includes(out.score_status);
      const metric = (key: string) => current && typeof out.metrics?.daily?.[key] === 'number' && Number.isFinite(out.metrics.daily[key]) ? out.metrics.daily[key] : null;
      return {
        date, dataStatus: current ? 'CURRENT' : 'STALE',
        source: 'SQL_PUBLISHED_DAILY_METRICS', engineVersion: out.engine_version,
        calculatedAt: out.calculated_at, inputFingerprint: out.input_fingerprint,
        ...(domain === 'sleep'
          // Legacy UI sleepScore is not the experimental/frozen sleepSystemScore.
          ? {totalSleepMinutes: metric('sleep_minutes'), sleepScore: null}
          // Generic canonical energy does not specify active vs total calories.
          : {steps: metric('steps'), activeMinutes: metric('active_minutes'), activeCalories: null, totalCalories: null}),
      };
    });
  }, true);
}
