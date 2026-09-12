// Local opt-in adapter; not mobile ingestion and not a second identity system.
type Json = Record<string, any>;
export const localToday = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
export function manualDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error("INVALID_DATE");
  const time = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw Error("INVALID_DATE");
  return value;
}
export function localReadRange(input: Json = {}) {
  const end = manualDate(input.endDate ?? input.date ?? localToday());
  const start = manualDate(input.startDate ?? input.date ?? new Date(Date.parse(end) - 27 * 86400000).toISOString().slice(0, 10));
  if (end > localToday() || start > end || Date.parse(end) - Date.parse(start) > 365 * 86400000) throw Error("INVALID_DATE_RANGE");
  return { start, end };
}
export function rejectClientIdentity(input: Json) {
  for (const field of ["user_id", "userId", "canonical_user_id", "canonicalUserId", "owner_id", "subject_ref", "auth_user_id"]) {
    if (field in input) throw Error("CLIENT_IDENTITY_FORBIDDEN");
  }
}
const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const sha = async (input: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(input))))).map(b => b.toString(16).padStart(2, "0")).join("");

export class ManualBodyLocalStore {
  constructor(private sql: any) {}
  async read(identity: Json, input: Json = {}) {
    rejectClientIdentity(input);
    const { start, end } = localReadRange(input);
    return await this.sql.begin(async (tx: any) => {
      await tx.unsafe("set local role authenticated");
      await tx`select set_config('request.jwt.claim.sub',${identity.auth},true)`;
      const rows = await tx`select body,revision from public.engine_manual_body_records
        where canonical_user_id=${identity.canonical} and not deleted and local_date between ${start}::date and ${end}::date order by local_date,record_id limit 367`;
      if (rows.length > 366) throw Error("READ_BOUND_EXCEEDED");
      return rows.map((r: Json) => ({ ...r.body, revision: Number(r.revision) }));
    });
  }
  async write(identity: Json, input: Json, remove = false) {
    rejectClientIdentity(input);
    if (!uuid(input.clientRequestId) || (input.recordId && !uuid(input.recordId))) throw Error("INVALID_MUTATION_ID");
    if (remove && !input.recordId) throw Error("BODY_RECORD_NOT_FOUND");
    // Hash the original request, not a server-generated record ID or normalized owner.
    const inputHash = await sha({ input, remove });
    return await this.sql.begin(async (tx: any) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${identity.canonical},0))`;
      const receipt = (await tx`select input_hash,response from private.engine_body_mutation_receipts where canonical_user_id=${identity.canonical} and request_id=${input.clientRequestId}`)[0];
      if (receipt) {
        if (receipt.input_hash !== inputHash) throw Error("REQUEST_ID_CONFLICT");
        return { ...receipt.response, replayed: true };
      }
      const id = input.recordId || crypto.randomUUID();
      const old = (await tx`select * from public.engine_manual_body_records where canonical_user_id=${identity.canonical} and record_id=${id} for update`)[0];
      if (input.recordId && !old) throw Error("BODY_RECORD_NOT_FOUND");
      if (old && old.deleted) throw Error("BODY_RECORD_DELETED");
      if (old && (!Number.isSafeInteger(input.revision) || input.revision !== Number(old.revision))) throw Error("STALE_REVISION");
      const date = remove ? old.body.date : manualDate(input.date);
      if (date > localToday()) throw Error("FUTURE_BODY_UNSUPPORTED");
      let weight = old?.body.weight, bodyFat = old?.body.bodyFat ?? null;
      if (!remove) {
        if ((typeof input.weight !== "number" && typeof input.weight !== "string") || String(input.weight).trim() === "") throw Error("INVALID_WEIGHT");
        weight = Number(input.weight);
        if (!Number.isFinite(weight) || weight < 20 || weight > 500) throw Error("INVALID_WEIGHT");
        bodyFat = input.bodyFat === null || input.bodyFat === undefined || (typeof input.bodyFat === "string" && input.bodyFat.trim() === "") ? null : Number(input.bodyFat);
        if (bodyFat !== null && ((typeof input.bodyFat !== "number" && typeof input.bodyFat !== "string") || !Number.isFinite(bodyFat) || bodyFat < 0 || bodyFat > 100)) throw Error("INVALID_BODY_FAT");
        const collision = await tx`select record_id from public.engine_manual_body_records where canonical_user_id=${identity.canonical} and local_date=${date} and not deleted and record_id<>${id}`;
        if (collision.length) throw Error("BODY_DATE_CONFLICT");
      }
      const revision = old ? Number(old.revision) + 1 : 1;
      const body = { recordId: id, date, weight, bodyFat, revision, source: "MANUAL_WEB", analysisStatus: "ANALYSIS_PENDING" };
      await tx`insert into public.engine_manual_body_records(canonical_user_id,record_id,revision,local_date,deleted,body)
        values(${identity.canonical},${id},${revision},${date},${remove},${tx.json(body)})
        on conflict(canonical_user_id,record_id) do update set revision=excluded.revision,local_date=excluded.local_date,deleted=excluded.deleted,body=excluded.body,updated_at=now()`;
      const result = { record: body, recordId: id, deleted: remove, status: "SAVED", analysisStatus: "ANALYSIS_PENDING" };
      await tx`insert into private.engine_body_mutation_receipts values(${identity.canonical},${input.clientRequestId},${inputHash},${tx.json(result)})`;
      return result;
    });
  }
  async status(identity: Json, input: Json) {
    rejectClientIdentity(input);
    if (!uuid(input.clientRequestId)) throw Error("INVALID_MUTATION_ID");
    const rows = await this.sql`select response from private.engine_body_mutation_receipts where canonical_user_id=${identity.canonical} and request_id=${input.clientRequestId}`;
    return { exists: rows.length === 1, ...rows[0]?.response };
  }
}
