import postgres from "npm:postgres@3.4.8";
import { HOSTED_DATABASE_CA } from "./hosted-database-ca.ts";
import {
  createDelegatedIngestion,
  createRecomputeWorker,
} from "./background-runtime.ts";
import { readManualRequest } from "./manual-request-body.ts";
type Env = (key: string) => string | undefined;
export function backgroundConfig(env: Env, system: boolean) {
  if (env("HEALTH_BACKGROUND_SQL_ENABLED") !== "1") {
    throw Error("BACKGROUND_PROVIDER_DISABLED");
  }
  const role = system ? "health_recompute_worker" : "health_native_ingest";
  if (env("HEALTH_ENGINE_LOCAL_ONLY") === "1" && !env("DENO_DEPLOYMENT_ID")) {
    const cfg = JSON.parse(env("HEALTH_BACKGROUND_LOCAL_CONFIG") || "{}");
    if (
      !["127.0.0.1", "host.docker.internal"].includes(cfg.host) ||
      cfg.port !== 57485 || !/^health_engine_[a-f0-9]{32}$/.test(cfg.database)
    ) throw Error("INVALID_LOCAL_WORKER_TARGET");
    return {
      role,
      connection: {
        host: cfg.host,
        port: cfg.port,
        database: cfg.database,
        username: role,
      },
      origin: "http://127.0.0.1:57841",
    };
  }
  const project = env("HEALTH_MANUAL_EXPECTED_PROJECT_REF"),
    host = env("HEALTH_MANUAL_EXPECTED_DB_HOST"),
    origin = env("HEALTH_MANUAL_ALLOWED_ORIGIN");
  if (
    !project || !/^[a-z]{20}$/.test(project) ||
    env("SUPABASE_URL") !== `https://${project}.supabase.co` || !host ||
    !/^aws-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)
  ) throw Error("INVALID_WORKER_TARGET");
  const url = new URL(
    env(
      system ? "HEALTH_RECOMPUTE_DATABASE_URL" : "HEALTH_NATIVE_DATABASE_URL",
    ) || "",
  );
  const web = new URL(origin || "");
  if (
    url.protocol !== "postgresql:" || url.hostname !== host ||
    url.port !== "6543" || url.pathname !== "/postgres" ||
    decodeURIComponent(url.username) !== role + "." + project ||
    !url.password || url.search || url.hash || web.protocol !== "https:" ||
    web.origin !== origin
  ) throw Error("INVALID_WORKER_TARGET");
  return {
    role,
    connection: url.href,
    origin: origin!,
    ssl: { rejectUnauthorized: true, ca: HOSTED_DATABASE_CA },
  };
}
const runtimes = new Map<string, Promise<any>>();
export async function backgroundBootstrap(request: Request, admin?: any) {
  const system = new URL(request.url).pathname.endsWith(
    "/internal/score-recompute/drain",
  );
  let config;
  try {
    config = backgroundConfig((k) => Deno.env.get(k), system);
  } catch {
    return Response.json({ error: "BACKGROUND_PROVIDER_NOT_CONFIGURED" }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== config.origin) {
    return Response.json({ error: "ORIGIN_REJECTED" }, { status: 403 });
  }
  const headers = {
    "cache-control": "no-store",
    "access-control-allow-origin": config.origin,
    vary: "Origin",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers":
      "authorization, content-type, x-app-session-id, x-shortcut-session-id",
  };
  if (request.method === "OPTIONS") {
    return new Response(null, { status: origin ? 204 : 403, headers });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "METHOD_NOT_ALLOWED" }, {
      status: 405,
      headers,
    });
  }
  if (system) {
    const expected = Deno.env.get("HEALTH_RECOMPUTE_TRIGGER_SECRET") || "",
      provided = request.headers.get("x-score-worker-secret") || "";
    const digest = async (v: string) =>
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)),
      );
    const a = await digest(expected), b = await digest(provided);
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
    if (expected.length < 32 || mismatch !== 0) {
      return Response.json({ error: "WORKER_AUTH_REJECTED" }, {
        status: 401,
        headers,
      });
    }
  }
  try {
    const key = JSON.stringify(config);
    let runtime = runtimes.get(key);
    if (!runtime) {
      if (runtimes.size >= 2) throw Error("WORKER_CONFIGURATION_CHANGED");
      const raw = typeof config.connection === "string"
        ? postgres(config.connection, {
          ssl: config.ssl,
          prepare: false,
          max: 2,
          connect_timeout: 5,
          idle_timeout: 20,
        })
        : postgres({
          ...config.connection,
          prepare: false,
          max: 2,
          connect_timeout: 5,
          idle_timeout: 20,
        });
      runtime = system
        ? createRecomputeWorker(raw)
        : Promise.resolve(createDelegatedIngestion(raw));
      runtimes.set(key, runtime);
      runtime.catch(() => {
        runtimes.delete(key);
        raw.end();
      });
    }
    const engine = await runtime;
    if (system) {
      const body = await readManualRequest(request);
      return Response.json(await engine.drain(body.limit ?? 3), { headers });
    }
    const response = await engine.handle(request, admin);
    return new Response(response.body, {
      status: response.status,
      headers: { ...Object.fromEntries(response.headers), ...headers },
    });
  } catch {
    return Response.json({
      error: "BACKGROUND_RUNTIME_UNAVAILABLE",
      retryable: true,
    }, { status: 503, headers });
  }
}
