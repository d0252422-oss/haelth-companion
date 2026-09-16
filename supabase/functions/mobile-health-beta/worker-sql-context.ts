import { AsyncLocalStorage } from "node:async_hooks";
type Session = { kind: "app" | "shortcut"; session: string; digest: string };
type Job = {
  canonical_user_id: string;
  score_date: string;
  generation: string | number;
  token: string;
};
export function scopedWorkerSql(
  raw: any,
  role: "health_native_ingest" | "health_recompute_worker",
) {
  const contexts = new AsyncLocalStorage<Session | Job>();
  const begin = (option: any, callback?: any) => {
    const work = callback ?? option,
      options = typeof option === "string" ? option : undefined;
    if (
      typeof work !== "function" ||
      options && options !== "isolation level repeatable read read only"
    ) throw Error("INVALID_WORKER_TRANSACTION");
    const context: any = contexts.getStore();
    const run = async (tx: any) => {
      const [actual] =
        await tx`select session_user::text as login,current_user::text as effective,rolsuper,rolbypassrls,rolinherit,rolcreatedb,rolcreaterole,rolreplication,
    exists(select 1 from pg_auth_members where member=(select oid from pg_roles where rolname=session_user)) as member from pg_roles where rolname=session_user`;
      if (
        !actual || actual.login !== role || actual.effective !== role ||
        [
          "rolsuper",
          "rolbypassrls",
          "rolinherit",
          "rolcreatedb",
          "rolcreaterole",
          "rolreplication",
          "member",
        ].some((k) => actual[k])
      ) throw Error("WORKER_DATABASE_ROLE_REJECTED");
      await tx`select set_config('health.worker.kind',${
        context?.kind || ""
      },true),set_config('health.worker.session',${
        context?.session || ""
      },true),set_config('health.worker.digest',${context?.digest || ""},true),
    set_config('health.job.user',${
        context?.canonical_user_id || ""
      },true),set_config('health.job.date',${
        context?.score_date || ""
      },true),set_config('health.job.generation',${
        String(context?.generation ?? "")
      },true),set_config('health.job.token',${context?.token || ""},true),
    set_config('health.engine.experimental','on',true),set_config('lock_timeout','2000',true),set_config('statement_timeout','10000',true),set_config('idle_in_transaction_session_timeout','10000',true),set_config('transaction_timeout','15000',true)`;
      if (context) {
        const [identity] = role === "health_native_ingest"
          ? await tx`select private.delegated_worker_user() as id`
          : await tx`select private.recompute_worker_user() as id`;
        if (!identity?.id) {
          throw Error(
            role === "health_native_ingest"
              ? "INVALID_WORKER_SESSION"
              : "STALE_SCORE_LEASE",
          );
        }
      }
      return work(tx);
    };
    return options ? raw.begin(options, run) : raw.begin(run);
  };
  const sql: any = (...args: any[]) => begin((tx: any) => tx(...args));
  sql.begin = begin;
  sql.unsafe = (...args: any[]) => begin((tx: any) => tx.unsafe(...args));
  sql.json = (v: any) => raw.json(v);
  sql.end = () => raw.end();
  sql.withSession = (c: Session, work: () => Promise<any>) => {
    if (
      role !== "health_native_ingest" ||
      !["app", "shortcut"].includes(c.kind) ||
      !/^[0-9a-f-]{36}$/.test(c.session) || !/^[0-9a-f]{64}$/.test(c.digest)
    ) throw Error("INVALID_WORKER_SESSION");
    return contexts.run(Object.freeze({ ...c }), work);
  };
  sql.withJob = (job: Job, work: () => Promise<any>) => {
    if (
      role !== "health_recompute_worker" ||
      !/^[0-9a-f-]{36}$/.test(job.canonical_user_id) ||
      !/^[0-9a-f-]{36}$/.test(job.token) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(job.score_date) ||
      !/^\d+$/.test(String(job.generation))
    ) throw Error("INVALID_SCORE_SCOPE");
    return contexts.run(Object.freeze({ ...job }), work);
  };
  return sql;
}
