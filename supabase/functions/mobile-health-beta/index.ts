import { withSupabase } from "@supabase/server";
import { boundedSdkFetch } from "./bounded-auth-fetch.ts";
import { shouldRouteBackgroundMutation } from "./background-routing.ts";
import { readBetaScores, recomputeBetaScore } from "./score-bridge.ts";
import { canonicalScoreDate, scoreRecomputeStatus } from "./score-read-contract.ts";
import { sameCanonicalUserId } from "./canonical-user-id.ts";
import { logPersistedSyncReceipt } from "./sync-trigger-diagnostic.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const webAuthVerifyUrl = Deno.env.get("BETA_WEB_AUTH_VERIFY_URL") ?? "";
const allowedOrigin = Deno.env.get("BETA_ALLOWED_ORIGIN") ?? "";
const androidCallbackUri = Deno.env.get("BETA_ANDROID_CALLBACK_URI") ?? "";
const encoder = new TextEncoder();
const MAX_BODY_BYTES = 1024 * 1024;
const DOMAINS = new Set([
  "steps", "heart_rate", "resting_heart_rate", "sleep", "sleep_stage",
  "weight", "workout", "hrv", "spo2", "total_energy",
]);
const UNITS: Record<string, Set<string>> = {
  steps: new Set(["count"]), heart_rate: new Set(["bpm"]), resting_heart_rate: new Set(["bpm"]),
  sleep: new Set(["minute"]), sleep_stage: new Set(["minute"]), weight: new Set(["kg"]),
  workout: new Set(["minute"]), hrv: new Set(["ms"]), spo2: new Set(["percent"]),
  total_energy: new Set(["kcal"]),
};
const MAX_VALUE_BY_DOMAIN: Record<string, number> = {
  steps: 10_000_000, heart_rate: 1_000, resting_heart_rate: 1_000,
  sleep: 10_080, sleep_stage: 10_080, weight: 2_000,
  workout: 10_080, hrv: 100_000, spo2: 100, total_energy: 1_000_000,
};
type Json = Record<string, unknown>;

// Explicit local host injection only; default Edge and remote routes remain unchanged.
let localEngineHandler: ((request: Request) => Promise<Response>) | null = null;
export function registerLocalEngineHandler(handler: (request: Request) => Promise<Response>): void {
  if (Deno.env.get("HEALTH_ENGINE_LOCAL_ONLY") !== "1" || Deno.env.get("DENO_DEPLOYMENT_ID")) throw new Error("LOCAL_ENGINE_DISABLED");
  localEngineHandler = handler;
}
export async function dispatchLocalEngine(request: Request): Promise<Response | null> {
  if (Deno.env.get("HEALTH_ENGINE_LOCAL_ONLY") !== "1" || Deno.env.get("DENO_DEPLOYMENT_ID")) return null;
  const url = new URL(request.url);
  if (!localEngineHandler || !["127.0.0.1", "localhost"].includes(url.hostname)
      || relativePath(url.pathname) !== "/v1/engine/web") return null;
  return await localEngineHandler(request);
}

export default {
  fetch: withSupabase({ auth: "none", cors: "disabled", supabaseOptions:{global:{fetch:boundedSdkFetch}} }, async (request, ctx) => {
    const origin = request.headers.get("origin") ?? "";
    const workerPath=relativePath(new URL(request.url).pathname);
    if (shouldRouteBackgroundMutation(workerPath, request.method, (key) => Deno.env.get(key))) {
      return await(await import('./background-bootstrap.ts')).backgroundBootstrap(request, ctx.supabaseAdmin);
    }
    // Manual Web has an independent, default-OFF provider; never uses the mobile auth callback guard.
    if(relativePath(new URL(request.url).pathname)==='/v1/engine/web'&&Deno.env.get('HEALTH_ENGINE_LOCAL_ONLY')!=='1'){
      return await(await import('./hosted-manual-bootstrap.ts')).hostedManualBootstrap(request);
    }
    const localManual = Deno.env.get("HEALTH_ENGINE_LOCAL_ONLY") === "1" && !Deno.env.get("DENO_DEPLOYMENT_ID")
      && relativePath(new URL(request.url).pathname) === "/v1/engine/web";
    if (localManual) {
      const expected = Deno.env.get("HEALTH_MANUAL_LOCAL_ORIGIN") || "http://127.0.0.1:57841";
      if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(expected) || (origin && origin !== expected)) return json(403, {error:"ORIGIN_REJECTED"});
      const headers = {"access-control-allow-origin":expected,"access-control-allow-methods":"POST, OPTIONS","access-control-allow-headers":"authorization, content-type, apikey, x-client-info, x-health-session-kind","vary":"Origin","cache-control":"no-store"};
      if (request.method === "OPTIONS") return new Response(null,{status:origin?204:403,headers});
      try {
        const response = await dispatchLocalEngine(request) ?? await (await import('./local-manual-bootstrap.ts')).localManualBootstrap(request,ctx.supabaseAdmin);
        if (response) {const combined=new Headers(response.headers);for(const [k,v] of Object.entries(headers))combined.set(k,v);return new Response(response.body,{status:response.status,headers:combined});}
        return Response.json({error:"LOCAL_MANUAL_NOT_CONFIGURED"},{status:503,headers});
      } catch {return Response.json({error:"LOCAL_MANUAL_CONFIGURATION_FAILED"},{status:503,headers});}
    }
    if (request.method === "OPTIONS") {
      if (!origin || origin !== allowedOrigin) return json(403, { error: "ORIGIN_REJECTED" });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    try {
      const experimental = await dispatchLocalEngine(request);
      if (experimental) return experimental;
      assertConfigured();
      if (origin && origin !== allowedOrigin) throw failure("ORIGIN_REJECTED", 403);
      const path = relativePath(new URL(request.url).pathname);
      if (request.method === "GET" && path === "/health") {
        return json(200, { status: "ok", environment: "beta" }, origin);
      }
      if (request.method === "POST" && path === "/v1/mobile/install-claims") {
        return await issueClaim(request, ctx.supabaseAdmin, origin);
      }
      if (request.method === "POST" && path === "/v1/mobile/native-auth/link") {
        return await linkNativeIdentity(request, ctx.supabaseAdmin, origin);
      }
      if (request.method === "GET" && path === "/v1/mobile/native-auth/session") {
        return await getNativeIdentity(request, ctx.supabaseAdmin, origin);
      }
      if (request.method === "POST" && path === "/v1/mobile/install-claims/exchange") {
        return await exchangeClaim(request, ctx.supabaseAdmin, origin);
      }
      if (request.method === "POST" && path === "/v1/mobile/sessions/refresh") {
        return await refreshSession(request, ctx.supabaseAdmin, origin);
      }
      if (request.method === "DELETE" && path === "/v1/mobile/sessions/current") {
        return await revokeSession(request, ctx.supabaseAdmin, origin);
      }
      if (request.method === "POST" && path === "/v1/connectors/ios-shortcut/session") {
        return await exchangeShortcutClaim(request, ctx.supabaseAdmin, origin);
      }
      if (request.method === "POST" && path === "/v1/connectors/ios-shortcut/ingest") {
        return await ingestShortcut(request, ctx.supabaseAdmin, origin);
      }
      if (request.method === "POST" && path === "/v1/health/ingestion/batches") {
        return await ingest(request, ctx.supabaseAdmin, origin);
      }
      if (request.method === "POST" && path === "/v1/mobile/connectors/status") {
        return await reportStatus(request, ctx.supabaseAdmin, origin);
      }
      if (request.method === "GET" && path === "/v1/mobile/connectors/status") {
        return await getStatus(request, ctx.supabaseAdmin, origin);
      }
      if (request.method === "GET" && path === "/v1/scores/daily") {
        return await getScores(request, ctx.supabaseAdmin, origin);
      }
      if (request.method === "GET" && path === "/v1/health/latest") {
        return await getLatestHealth(request, ctx.supabaseAdmin, origin);
      }
      if (request.method === "POST" && path === "/internal/score-recompute/drain") {
        return await drainScoreQueue(request, ctx.supabaseAdmin, origin);
      }
      throw failure("NOT_FOUND", 404);
    } catch (error) {
      const safe = error instanceof SafeError ? error : failure("INTERNAL_ERROR", 500);
      return json(safe.status, { error: safe.code }, origin);
    }
  }),
};

async function linkNativeIdentity(request: Request, admin: any, origin: string): Promise<Response> {
  const nativeUser = await authenticateNativeUser(request, admin);
  const body = await readJson(request);
  for (const forbidden of ["canonical_user_id", "user_id", "owner_id", "external_subject", "email", "web_session_token"]) {
    if (body[forbidden] != null) throw failure("CLIENT_IDENTITY_FORBIDDEN", 400);
  }
  const identity = await ensureNativeIdentity(admin, nativeUser);
  return json(200, identity, origin);
}

async function ensureNativeIdentity(admin: any, nativeUser: Json): Promise<Json> {
  const existing = await resolveNativeIdentity(admin, String(nativeUser.auth_user_id), false);
  if (existing) return existing;
  const subjectHash = await sha256(String(nativeUser.google_subject));
  const emailHash = await sha256(String(nativeUser.auth_email));
  const canonicalUserId = uuidFromHash(subjectHash);
  const { data, error } = await admin.rpc("beta_link_native_auth_identity_v2", {
    p_auth_user_id: nativeUser.auth_user_id,
    p_candidate_canonical_user_id: canonicalUserId,
    p_google_subject_hash: subjectHash,
    p_verified_email_hash: emailHash,
  });
  if (error) throw databaseFailure(error);
  if (!/^[0-9a-f-]{36}$/i.test(String(data))) throw failure("CANONICAL_IDENTITY_CONFLICT", 409);
  return { canonical_user_id: String(data), provider: "google", environment: "beta" };
}

async function getNativeIdentity(request: Request, admin: any, origin: string): Promise<Response> {
  const nativeUser = await authenticateNativeUser(request, admin);
  const identity = await resolveNativeIdentity(admin, String(nativeUser.auth_user_id), true);
  if (!identity) throw failure("NATIVE_IDENTITY_NOT_LINKED", 401);
  return json(200, identity, origin);
}

async function issueClaim(request: Request, admin: any, origin: string): Promise<Response> {
  const body = await readJson(request);
  const bindingMethod = String(body.binding_method ?? "");
  const fingerprint = typeof body.installation_key_fingerprint === "string" ? body.installation_key_fingerprint : null;
  if (body.environment !== "beta" || !["ONE_TIME_CODE", "VERIFIED_APP_LINK"].includes(bindingMethod)
      || !["android", "ios"].includes(String(body.platform))
      || (bindingMethod === "VERIFIED_APP_LINK" && !/^[0-9a-f]{64}$/.test(fingerprint ?? ""))
      || (bindingMethod === "ONE_TIME_CODE" && fingerprint !== null)) {
    throw failure("INVALID_INSTALL_BINDING", 400);
  }
  const webIdentity = await resolveCanonicalWebIdentity(request, admin);
  const claim = randomToken(32);
  const { error } = await admin.rpc("beta_issue_install_claim", {
    p_canonical_user_id: webIdentity.canonical_user_id,
    p_external_subject_hash: webIdentity.web_subject_hash,
    p_platform: body.platform,
    p_claim_digest: await sha256(claim),
    p_expires_at: new Date(Date.now() + 300_000).toISOString(),
    p_binding_method: bindingMethod,
    p_installation_key_fingerprint: fingerprint,
  });
  if (error) throw databaseFailure(error);
  return json(201, {
    claim_code: bindingMethod === "ONE_TIME_CODE" ? claim : undefined,
    continuation_url: bindingMethod === "VERIFIED_APP_LINK" ? `${androidCallbackUri}#claim=${encodeURIComponent(claim)}` : undefined,
    expires_in: 300, environment: "beta",
  }, origin);
}

async function exchangeShortcutClaim(request: Request, admin: any, origin: string): Promise<Response> {
  const body = await readJson(request);
  if (body.environment !== "beta") throw failure("WRONG_ENVIRONMENT", 400);
  const claim = requiredString(body.claim, "INVALID_CLAIM");
  const accessToken = randomToken(32);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const { data, error } = await admin.rpc("beta_exchange_shortcut_claim", {
    p_claim_digest: await sha256(claim),
    p_access_token_digest: await sha256(accessToken),
    p_expires_at: expiresAt,
  });
  if (error) throw databaseFailure(error);
  const session = Array.isArray(data) ? data[0] as Json : null;
  if (!session) throw failure("INVALID_CLAIM", 400);
  return json(200, {
    canonical_user_id: session.canonical_user_id,
    session_id: session.session_id,
    access_token: accessToken,
    expires_at: expiresAt,
    environment: "beta",
  }, origin);
}

async function ingestShortcut(request: Request, admin: any, origin: string): Promise<Response> {
  const body = await readJson(request);
  if (body.environment !== "beta") throw failure("WRONG_ENVIRONMENT", 400);
  if (body.schema_version !== "hdl-v2.connector-ingestion.v1"
      || body.provider !== "apple_health" || body.connector_type !== "ios_shortcut") {
    throw failure("SCHEMA_VERSION_MISMATCH", 400);
  }
  if (!Number.isFinite(Date.parse(String(body.sync_window_start)))
      || !Number.isFinite(Date.parse(String(body.sync_window_end)))) throw failure("BAD_SYNC_WINDOW", 400);
  const session = await authorizeShortcutSession(request, admin);
  if (!sameCanonicalUserId(body.canonical_user_id, session.canonical_user_id)) throw failure("CROSS_USER_UPLOAD", 403);
  if (!Array.isArray(body.records) || body.records.length > 250) throw failure("INVALID_BATCH", 400);

  const receipt: Json = { accepted_idempotency_keys: [], duplicate_idempotency_keys: [], rejected: [] };
  const affectedDates = new Set<string>();
  for (const candidate of body.records) {
    const mutation = await shortcutRecordToMutation(candidate as Json, String(session.canonical_user_id));
    const { data, error } = await admin.rpc("beta_ingest_health_mutation", {
      p_canonical_user_id: session.canonical_user_id,
      p_platform: "ios",
      p_domain: mutation.domain,
      p_source_app: mutation.source_app,
      p_source_record_id: mutation.source_record_id,
      p_source_revision: mutation.source_revision,
      p_source_updated_at: mutation.source_updated_at || null,
      p_source_content_hash: mutation.source_content_hash,
      p_operation: "UPSERT",
      p_idempotency_key: mutation.idempotency_key,
      p_record: mutation.record,
      p_affected_local_dates: mutation.affected_local_dates,
    });
    if (error) throw databaseFailure(error);
    for (const date of mutation.affected_local_dates as string[]) affectedDates.add(date);
    const action = String(data);
    if (["CREATED", "UPDATED"].includes(action)) {
      (receipt.accepted_idempotency_keys as unknown[]).push(mutation.idempotency_key);
    } else if (action === "REPLAYED") {
      (receipt.duplicate_idempotency_keys as unknown[]).push(mutation.idempotency_key);
    } else {
      (receipt.rejected as unknown[]).push({ idempotency_key: mutation.idempotency_key, error_code: action });
    }
  }
  await recomputeDates(admin, String(session.canonical_user_id), affectedDates);
  return json((receipt.rejected as unknown[]).length ? 207 : 200, receipt, origin);
}

export async function shortcutRecordToMutation(record: Json, userId: string): Promise<Json> {
  const domain = String(record.domain ?? "");
  const unit = String(record.unit ?? "");
  if (!DOMAINS.has(domain)) throw failure("UNSUPPORTED_DOMAIN", 400);
  if (!UNITS[domain]?.has(unit)) throw failure("INVALID_UNIT", 400);
  if (typeof record.value !== "number" || !Number.isFinite(record.value) || record.value < 0) throw failure("MALFORMED_VALUE", 400);
  if (!Number.isFinite(Date.parse(String(record.recorded_at)))) throw failure("MALFORMED_TIMESTAMP", 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(record.local_date ?? "")) || !record.timezone) throw failure("MALFORMED_CIVIL_TIME", 400);
  const sourceApp = requiredString(record.source_app, "MISSING_SOURCE_IDENTITY");
  const nativeId = typeof record.native_record_id === "string" && record.native_record_id ? record.native_record_id : "";
  const sourceRecordId = nativeId || await sha256(stableJson({
    provider: "apple_health", connector_type: "ios_shortcut", domain, source_app: sourceApp,
    recorded_at: record.recorded_at, started_at: record.started_at ?? "", ended_at: record.ended_at ?? "",
    timezone: record.timezone, local_date: record.local_date, unit, stage: record.stage ?? "",
  }));
  const sourceContentHash = await sha256(stableJson({
    source_record_id: sourceRecordId, value: record.value, unit, recorded_at: record.recorded_at,
    started_at: record.started_at ?? "", ended_at: record.ended_at ?? "", stage: record.stage ?? "",
  }));
  const revision = Number.isSafeInteger(record.source_revision) && Number(record.source_revision) > 0
    ? Number(record.source_revision) : 1;
  const canonicalRecord: Json = {
    ...record, schema_version: "hdl-v2.health-ingestion.v1", canonical_user_id: userId,
    platform: "ios", provider: "apple_health", connector_type: "ios_shortcut",
    source_record_id: sourceRecordId,
    source_record_id_kind: nativeId ? "NATIVE" : "DERIVED_FINGERPRINT",
    source_fingerprint: sourceContentHash, sync_method: "USER_AUTOMATION",
  };
  validateRecord(canonicalRecord, userId);
  return {
    domain, source_app: sourceApp, source_record_id: sourceRecordId, source_revision: revision,
    source_updated_at: record.source_updated_at ?? null, source_content_hash: sourceContentHash,
    idempotency_key: await sha256(stableJson({ userId, domain, sourceApp, sourceRecordId, revision, sourceContentHash, operation: "UPSERT" })),
    record: canonicalRecord, affected_local_dates: [record.local_date],
  };
}

async function exchangeClaim(request: Request, admin: any, origin: string): Promise<Response> {
  const body = await readJson(request);
  const claim = requiredString(body.claim, "INVALID_CLAIM");
  const publicKeyBytes = decodeBase64(requiredString(body.installation_public_key, "INVALID_PUBLIC_KEY"));
  const signatureDer = decodeBase64(requiredString(body.signature, "INVALID_SIGNATURE"));
  const publicKey = await crypto.subtle.importKey(
    "spki", arrayBuffer(publicKeyBytes), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"],
  ).catch(() => { throw failure("INVALID_PUBLIC_KEY", 400); });
  const verified = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, publicKey, arrayBuffer(derEcdsaToRaw(signatureDer, 32)), arrayBuffer(encoder.encode(claim)),
  ).catch(() => false);
  if (!verified) throw failure("INVALID_SIGNATURE", 400);

  const accessToken = randomToken(32);
  const refreshToken = randomToken(48);
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const { data, error } = await admin.rpc("beta_exchange_install_claim", {
    p_claim_digest: await sha256(claim),
    p_installation_key_fingerprint: await sha256(publicKeyBytes),
    p_installation_public_key_spki: `\\x${bytesToHex(publicKeyBytes)}`,
    p_access_token_digest: await sha256(accessToken),
    p_refresh_token_digest: await sha256(refreshToken),
    p_access_expires_at: expiresAt,
    p_refresh_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
  });
  if (error) throw databaseFailure(error);
  const session = Array.isArray(data) ? data[0] as Json : null;
  if (!session) throw failure("INVALID_CLAIM", 400);
  return json(200, {
    canonical_user_id: session.canonical_user_id,
    session_id: session.session_id,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    environment: "beta",
  }, origin);
}

async function refreshSession(request: Request, admin: any, origin: string): Promise<Response> {
  const body = await readJson(request);
  const sessionId = requiredString(body.session_id, "INVALID_SESSION");
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw failure("INVALID_SESSION", 401);
  const refreshToken = requiredString(body.refresh_token, "INVALID_REFRESH_TOKEN");
  const signatureDer = decodeBase64(requiredString(body.signature, "INVALID_SIGNATURE"));
  const { data: materialData, error: materialError } = await admin.rpc("beta_get_app_session_refresh_material", { p_session_id: sessionId });
  if (materialError) throw databaseFailure(materialError);
  const material = Array.isArray(materialData) ? materialData[0] as Json : null;
  if (!material) throw failure("INVALID_REFRESH_TOKEN", 401);
  const publicKeyBytes = decodePostgresBytea(requiredString(material.installation_public_key_spki, "INVALID_SESSION"));
  const publicKey = await crypto.subtle.importKey(
    "spki", arrayBuffer(publicKeyBytes), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"],
  ).catch(() => { throw failure("INVALID_SESSION", 401); });
  const verified = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, publicKey, arrayBuffer(derEcdsaToRaw(signatureDer, 32)), arrayBuffer(encoder.encode(`${sessionId}\u001f${refreshToken}`)),
  ).catch(() => false);
  if (!verified) throw failure("INVALID_SIGNATURE", 401);

  const accessToken = randomToken(32);
  const newRefreshToken = randomToken(48);
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const { data, error } = await admin.rpc("beta_rotate_app_session", {
    p_session_id: sessionId,
    p_refresh_token_digest: await sha256(refreshToken),
    p_new_access_token_digest: await sha256(accessToken),
    p_new_refresh_token_digest: await sha256(newRefreshToken),
    p_access_expires_at: expiresAt,
    p_refresh_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
  });
  if (error) throw databaseFailure(error);
  const session = Array.isArray(data) ? data[0] as Json : null;
  if (!session) throw failure("INVALID_REFRESH_TOKEN", 401);
  return json(200, {
    canonical_user_id: session.canonical_user_id, session_id: session.session_id,
    access_token: accessToken, refresh_token: newRefreshToken, expires_at: expiresAt, environment: "beta",
  }, origin);
}

async function revokeSession(request: Request, admin: any, origin: string): Promise<Response> {
  const sessionId = request.headers.get("x-app-session-id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw failure("INVALID_SESSION", 401);
  const { data, error } = await admin.rpc("beta_revoke_app_session", {
    p_session_id: sessionId, p_access_token_digest: await sha256(bearer(request)),
  });
  if (error) throw databaseFailure(error);
  if (data !== true) throw failure("INVALID_SESSION", 401);
  return new Response(null, { status: 204, headers: { "cache-control": "no-store", ...corsHeaders(origin) } });
}

async function ingest(request: Request, admin: any, origin: string): Promise<Response> {
  const body = await readJson(request);
  if (body.environment !== "beta") throw failure("WRONG_ENVIRONMENT", 400);
  const session = await authorizeSession(request, admin);
  if (!sameCanonicalUserId(body.canonical_user_id, session.canonical_user_id)) throw failure("CROSS_USER_UPLOAD", 403);
  if (!Array.isArray(body.mutations) || body.mutations.length > 100) throw failure("INVALID_BATCH", 400);
  const mutations: Json[] = [];
  for (const candidate of body.mutations) {
    const mutation = validateMutation(
      candidate as Json,
      String(session.canonical_user_id),
      String(session.platform),
    );
    mutations.push(mutation);
  }
  const { data: receipt, error } = await admin.rpc("beta_ingest_health_mutation_batch", {
    p_canonical_user_id: session.canonical_user_id,
    p_mutations: mutations,
  });
  if (error) throw databaseFailure(error);
  if (!receipt || !Array.isArray(receipt.rejected)) throw failure("INVALID_INGESTION_RECEIPT", 500);
  const status = (receipt.rejected as unknown[]).length ? 207 : 200;
  logPersistedSyncReceipt("ingestion", body.sync_diagnostic, status, receipt,
    { platform: session.platform === "android" ? "android" : session.platform === "ios" ? "ios" : null,
      auth_kind: request.headers.get("x-app-session-id") ? "app_session" : "native_bearer" });
  return json(status, receipt, origin);
}

async function reportStatus(request: Request, admin: any, origin: string): Promise<Response> {
  const body = await readJson(request);
  const session = await authorizeSession(request, admin);
  if (!sameCanonicalUserId(body.canonical_user_id, session.canonical_user_id)) throw failure("CROSS_USER_UPLOAD", 403);
  if (body.platform !== session.platform) throw failure("PLATFORM_MISMATCH", 400);
  const lastResult = String(body.last_result || "UNKNOWN");
  const successfulSync = ["SYNCED", "SYNCED_RECENT", "SYNCED_PARTIAL", "NO_DATA"].includes(lastResult);
  const lastAttemptAt = body.last_attempt_at || new Date().toISOString();
  const { error } = await admin.rpc("beta_report_connector_status", {
    p_canonical_user_id: session.canonical_user_id,
    p_platform: body.platform,
    p_connector_type: body.connector_type,
    p_connector_version: body.connector_version,
    p_last_attempt_at: lastAttemptAt,
    p_last_success_at: body.last_success_at || (successfulSync ? lastAttemptAt : null),
    p_last_result: lastResult,
    p_available_domains: Array.isArray(body.available_domains) ? body.available_domains : [],
    p_permission_state: body.permission_state_if_known || "UNKNOWN",
  });
  if (error) throw databaseFailure(error);
  logPersistedSyncReceipt("connector_status", body.sync_diagnostic, 200, { last_result: lastResult },
    { platform: session.platform === "android" ? "android" : session.platform === "ios" ? "ios" : null,
      auth_kind: request.headers.get("x-app-session-id") ? "app_session" : "native_bearer" });
  if (successfulSync) scheduleScoreRecompute(admin, String(session.canonical_user_id), scoreWorkerIdentityContext(session));
  return json(200, { status: "RECORDED", score_recompute: successfulSync ? "QUEUED" : "NOT_QUEUED" }, origin);
}

function scheduleScoreRecompute(admin: any, userId: string, identityContext: Json | null): void {
  EdgeRuntime.waitUntil(processScoreQueuePages(admin, userId, identityContext).catch(() => {
    // Postgres keeps the item retryable; logs intentionally exclude identity and health data.
    console.error("SCORE_BACKGROUND_RECOMPUTE_FAILED");
  }));
}

// Two bounded pages cover the seven-day real-device acceptance window without
// turning one connector status request into an unbounded queue drain.
async function processScoreQueuePages(admin:any,userId:string,identityContext:Json|null):Promise<Json>{
  const total={claimed:0,completed:0,failed:0};
  for(let page=0;page<2;page++){
    const result=await processScoreQueue(admin,userId,5,identityContext);
    total.claimed+=Number(result.claimed||0);total.completed+=Number(result.completed||0);total.failed+=Number(result.failed||0);
    if(result.deferred)return {...total,deferred:result.deferred};
    if(Number(result.claimed||0)<5)break;
  }
  return total;
}

async function getStatus(request: Request, admin: any, origin: string): Promise<Response> {
  const identity = await resolveCanonicalWebIdentity(request, admin);
  const userId = String(identity.canonical_user_id);
  const { data, error } = await admin.from("beta_connector_status")
    .select("platform,connector_type,connector_version,last_attempt_at,last_success_at,last_result,available_domains,permission_state")
    .eq("canonical_user_id", userId);
  if (error) throw databaseFailure(error);
  return json(200, { connectors: data ?? [] }, origin);
}

async function getScores(request: Request, admin: any, origin: string): Promise<Response> {
  const identity = await resolveCanonicalWebIdentity(request, admin);
  const userId = String(identity.canonical_user_id);
  const date = new URL(request.url).searchParams.get("date") ?? undefined;
  if (date) {
    try { canonicalScoreDate(date); } catch { throw failure("INVALID_SCORE_DATE", 400); }
  }
  const scores = await readBetaScores(admin, userId, date);
  return json(200, { ...scores, recompute_status: scoreRecomputeStatus(scores.score_freshness) }, origin);
}

async function getLatestHealth(request: Request, admin: any, origin: string): Promise<Response> {
  const identity = await resolveCanonicalWebIdentity(request, admin);
  const userId = String(identity.canonical_user_id);
  const { data, error } = await admin.rpc("beta_get_health_freshness", { p_canonical_user_id: userId });
  if (error) throw databaseFailure(error);
  const freshness = Array.isArray(data) ? data[0] ?? {} : {};
  return json(200, { ...freshness, environment: "beta" }, origin);
}

async function drainScoreQueue(request: Request, admin: any, origin: string): Promise<Response> {
  const { data: authorized, error: authError } = await admin.rpc("beta_authorize_score_worker", {
    p_secret: request.headers.get("x-score-worker-secret") ?? "",
  });
  if (authError || authorized !== true) {
    throw failure("WORKER_AUTH_REJECTED", 401);
  }
  const body = await readJson(request);
  const limit = Number.isSafeInteger(body.limit) ? Math.min(Math.max(Number(body.limit), 1), 5) : 3;
  return json(200, await processScoreQueue(admin, null, limit, null), origin);
}

export function scoreWorkerIdentityContext(session:Json):Json|null{
  const webSubjectHash=session?.score_worker_web_subject_hash,emailHash=session?.score_worker_email_hash;
  return [webSubjectHash,emailHash].every(value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value))
    ?{webSubjectHash,emailHash}:null;
}

export async function processScoreQueue(admin: any, userId: string | null, limit: number, identityContext:Json|null=null): Promise<Json> {
  const hosted=Deno.env.get('HEALTH_MANUAL_SQL_HOSTED_ENABLED')==='1';
  // The manual SQL role is owner-scoped by two server-verified Google hashes.
  // Never claim first and discover afterwards that the RLS context is absent.
  if(hosted){
    if(!userId||!identityContext)return {claimed:0,completed:0,failed:0,deferred:'VERIFIED_IDENTITY_CONTEXT_REQUIRED'};
    await(await import('./hosted-manual-bootstrap.ts')).validateHostedManualScoreContext(userId,identityContext);
  }
  const workerToken = crypto.randomUUID();
  const { data, error } = await admin.rpc("beta_claim_score_recompute", {
    p_worker_token: workerToken, p_canonical_user_id: userId, p_limit: limit,
  });
  if (error) throw databaseFailure(error);
  const claimed = Array.isArray(data) ? data : [];
  let completed = 0;
  let failed = 0;
  for (const row of claimed as Json[]) {
    try {
      const result = hosted
        ? await(await import('./hosted-manual-bootstrap.ts')).processHostedClaimedScoreJob(row,workerToken,identityContext!)
        : await recomputeBetaScore(admin, String(row.canonical_user_id), String(row.score_date));
      if(['SUPERSEDED','NOT_DIRTY'].includes(String(result.status)))continue; // Not our completion credit.
      if(!['PERSISTED','REPLAYED'].includes(String(result.status)))throw Error('STALE_SCORE_INPUT');
      completed += 1;
    } catch (error) {
      failed += 1;
      const errorCode = scoreErrorCode(error);
      const { error: releaseError } = await admin.rpc("beta_fail_score_recompute", {
        p_canonical_user_id: row.canonical_user_id, p_score_date: row.score_date,
        p_generation: row.generation, p_worker_token: workerToken,
        p_error_code: errorCode, p_retryable: errorCode !== "SCORE_INPUT_BOUND_EXCEEDED",
      });
      if (releaseError) console.error("SCORE_QUEUE_RELEASE_FAILED");
    }
  }
  return { claimed: claimed.length, completed, failed };
}

async function recomputeDates(admin: any, userId: string, dates: Set<string>): Promise<void> {
  if (dates.size > 31) throw failure("SCORE_RECOMPUTE_BOUND_EXCEEDED", 400);
  if(Deno.env.get('HEALTH_MANUAL_SQL_HOSTED_ENABLED')==='1'){
    if(dates.size)await processScoreQueue(admin,userId,Math.min(dates.size,5),null);
    return; // Remaining durable work is owned by the existing scheduled drain.
  }
  for (const date of [...dates].sort()) await recomputeBetaScore(admin, userId, date);
}

export function scoreErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const sqlState = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  return message.includes("SCORE_INPUT_BOUND_EXCEEDED") ? "SCORE_INPUT_BOUND_EXCEEDED" :
    message.includes("STALE_SCORE_INPUT") ? "STALE_SCORE_INPUT" :
    message.includes("SCORE_STAGE_ENGINE_COMPUTE") ? "SCORE_STAGE_ENGINE_COMPUTE" :
    message.includes("SCORE_STAGE_ENGINE_PUBLICATION") ? "SCORE_STAGE_ENGINE_PUBLICATION" :
    message.includes("SCORE_STAGE_FROZEN_SCORE") ? "SCORE_STAGE_FROZEN_SCORE" :
    message.includes("ENGINE_PUBLICATION_REQUIRED") || sqlState === "55000" ? "SCORE_PUBLICATION_GUARD" :
    /row-level security/i.test(message) ? "SCORE_SQL_RLS_REJECTED" :
    /permission denied/i.test(message) || sqlState === "42501" ? "SCORE_SQL_PERMISSION_DENIED" :
    /statement timeout|transaction timeout|canceling statement/i.test(message) || sqlState === "57014" ? "SCORE_SQL_TIMEOUT" :
    /INVALID_SCORE_BUNDLE|INVALID_SCORE_RESULT/.test(message) ? "SCORE_RESULT_CONTRACT_REJECTED" :
    ["22P02", "42804", "42883", "42P18"].includes(sqlState) ||
      /malformed array|operator does not exist|could not determine data type/i.test(message)
      ? "SCORE_SQL_QUERY_CONTRACT" :
    ["23503", "23505", "23514"].includes(sqlState) ? "SCORE_SQL_CONSTRAINT_REJECTED" :
    "SCORE_RECOMPUTE_FAILED";
}

export async function authorizeSession(request: Request, admin: any): Promise<Json> {
  const sessionId = request.headers.get("x-app-session-id") ?? "";
  if (!sessionId) {
    const nativeUser = await authenticateNativeUser(request, admin);
    const identity = await resolveNativeIdentity(admin, String(nativeUser.auth_user_id), true);
    if (!identity) throw failure("NATIVE_IDENTITY_NOT_LINKED", 401);
    // Native Supabase/Google bearer auth is currently an Android-only client path.
    // Bind the platform at this trusted boundary; never infer it from the upload body.
    return {
      ...identity,
      platform: "android",
      score_worker_web_subject_hash: await sha256(String(nativeUser.google_subject)),
      score_worker_email_hash: await sha256(String(nativeUser.auth_email)),
    };
  }
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw failure("INVALID_SESSION", 401);
  const { data, error } = await admin.rpc("beta_authorize_app_session", {
    p_session_id: sessionId,
    p_access_token_digest: await sha256(bearer(request)),
  });
  if (error) throw databaseFailure(error);
  const session = Array.isArray(data) ? data[0] as Json : null;
  if (!session) throw failure("INVALID_SESSION", 401);
  return session;
}

export async function authenticateNativeUser(request: Request, admin: any): Promise<Json> {
  const token = bearer(request);
  const { data, error } = await admin.auth.getUser(token);
  const user = data?.user;
  if (error && (error.status === 0 || error.status >= 500 || error.code === "AUTH_SERVICE_UNAVAILABLE")) throw failure("AUTH_SERVICE_UNAVAILABLE", 503);
  if (error || !user?.id) throw failure("INVALID_SUPABASE_SESSION", 401);
  const providers = new Set<string>();
  if (typeof user.app_metadata?.provider === "string") providers.add(user.app_metadata.provider);
  if (Array.isArray(user.app_metadata?.providers)) {
    for (const provider of user.app_metadata.providers) if (typeof provider === "string") providers.add(provider);
  }
  let googleSubject = "";
  for (const identity of user.identities ?? []) {
    if (typeof identity?.provider === "string") providers.add(identity.provider);
    if (identity?.provider === "google") {
      const identityData = identity.identity_data as Json | undefined;
      const candidate = identityData?.sub ?? identity.id;
      if (typeof candidate === "string" && candidate.length >= 1 && candidate.length <= 256) googleSubject = candidate;
    }
  }
  if (!providers.has("google")) throw failure("GOOGLE_AUTH_REQUIRED", 403);
  if (!googleSubject) throw failure("GOOGLE_SUBJECT_REQUIRED", 403);
  const authEmail = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
  if (!authEmail || authEmail.length > 320) throw failure("GOOGLE_AUTH_REQUIRED", 403);
  return { auth_user_id: user.id, auth_email: authEmail, google_subject: googleSubject, provider: "google", environment: "beta" };
}

export async function resolveNativeIdentity(admin: any, authUserId: string, required = true): Promise<Json | null> {
  const { data, error } = await admin.rpc("beta_resolve_native_auth_identity", {
    p_auth_user_id: authUserId,
  });
  if (error) throw databaseFailure(error);
  if (Array.isArray(data) && data.length > 1) throw failure("CANONICAL_IDENTITY_CONFLICT", 409);
  const identity = Array.isArray(data) ? data[0] as Json : null;
  if (!identity || identity.environment !== "beta" || identity.provider !== "google") {
    if (!required) return null;
    throw failure("NATIVE_IDENTITY_NOT_LINKED", 401);
  }
  return identity;
}

async function authorizeShortcutSession(request: Request, admin: any): Promise<Json> {
  const sessionId = request.headers.get("x-shortcut-session-id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw failure("INVALID_SESSION", 401);
  const { data, error } = await admin.rpc("beta_authorize_shortcut_session", {
    p_session_id: sessionId,
    p_access_token_digest: await sha256(bearer(request)),
  });
  if (error) throw databaseFailure(error);
  const session = Array.isArray(data) ? data[0] as Json : null;
  if (!session) throw failure("INVALID_SESSION", 401);
  return session;
}

async function resolveCanonicalWebIdentity(request: Request, admin: any): Promise<Json> {
  const verified = await verifyWebIdentity(bearer(request));
  if (!verified.email) throw failure("WEB_IDENTITY_EMAIL_REQUIRED", 401);
  const webSubjectHash = await sha256(verified.subject);
  const emailHash = await sha256(verified.email);
  const { data, error } = await admin.rpc("beta_resolve_web_canonical_identity", {
    p_web_subject_hash: webSubjectHash,
    p_verified_email_hash: emailHash,
    p_candidate_canonical_user_id: uuidFromHash(emailHash),
  });
  if (error) throw databaseFailure(error);
  const identity = Array.isArray(data) ? data[0] as Json : null;
  if (!identity || identity.environment !== "beta" || identity.provider !== "google") {
    throw failure("WEB_IDENTITY_NOT_LINKED", 401);
  }
  return { ...identity, web_subject_hash: webSubjectHash };
}

export async function verifyWebIdentity(token: string): Promise<{ subject: string; email: string }> {
  if (!webAuthVerifyUrl.startsWith("https://")) throw failure("WEB_AUTH_NOT_CONFIGURED", 503);
  const signal = AbortSignal.timeout(10000);
  const upstream = await fetch(webAuthVerifyUrl, {
    method: "POST",
    headers: { "content-type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "getCurrentUser", sessionToken: token, payload: {} }),
    signal,
  }).catch(() => { throw failure("WEB_SESSION_VERIFICATION_UNAVAILABLE", 503); });
  if (!upstream.ok) throw failure("WEB_SESSION_REQUIRED", 401);
  const raw = await upstream.json().catch(() => { if (signal.aborted) throw failure("WEB_SESSION_VERIFICATION_UNAVAILABLE", 503); return null; }) as Json | null;
  const data = (raw?.data ?? raw?.result ?? raw) as Json | null;
  const profile = (data?.profile ?? data) as Json | null;
  const subject = profile?.UserID ?? profile?.userId ?? profile?.id;
  if (typeof subject !== "string" || subject.length < 1 || subject.length > 256) throw failure("WEB_SESSION_REQUIRED", 401);
  const rawEmail = profile?.Email ?? profile?.email;
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (email.length > 320) throw failure("WEB_IDENTITY_EMAIL_REQUIRED", 401);
  return { subject, email };
}

export function validateMutation(mutation: Json, userId: string, expectedPlatform: string): Json {
  if (!mutation || typeof mutation !== "object" || Array.isArray(mutation)) throw failure("INVALID_MUTATION", 400);
  if (!sameCanonicalUserId(mutation.canonical_user_id, userId)) throw failure("CROSS_USER_UPLOAD", 403);
  if (!["android", "ios"].includes(String(mutation.platform))) throw failure("PLATFORM_MISMATCH", 400);
  if (!["android", "ios"].includes(expectedPlatform) || mutation.platform !== expectedPlatform) throw failure("PLATFORM_MISMATCH", 400);
  if (!DOMAINS.has(String(mutation.domain))) throw failure("UNSUPPORTED_DOMAIN", 400);
  if (!["UPSERT", "DELETE"].includes(String(mutation.operation))) throw failure("INVALID_OPERATION", 400);
  if (!Number.isSafeInteger(mutation.source_revision) || Number(mutation.source_revision) < 1) throw failure("INVALID_SOURCE_REVISION", 400);
  for (const field of ["source_content_hash", "idempotency_key"]) {
    if (!/^[0-9a-f]{64}$/.test(String(mutation[field] ?? ""))) throw failure("INVALID_HASH", 400);
  }
  if (mutation.source_updated_at != null && mutation.source_updated_at !== ""
      && !Number.isFinite(Date.parse(String(mutation.source_updated_at)))) throw failure("MALFORMED_TIMESTAMP", 400);
  const sourceApp = boundedIdentity(mutation.source_app);
  const sourceRecordId = boundedIdentity(mutation.source_record_id);
  const affectedDates = validateAffectedDates(mutation.affected_local_dates);
  if (mutation.operation === "UPSERT") {
    const record = mutation.record as Json;
    validateRecord(record, userId);
    if (record.platform !== mutation.platform || record.domain !== mutation.domain
        || record.source_app !== sourceApp || record.source_record_id !== sourceRecordId) {
      throw failure("MUTATION_RECORD_MISMATCH", 400);
    }
    if (!affectedDates.includes(String(record.local_date))) throw failure("AFFECTED_DATE_MISMATCH", 400);
  }
  if (mutation.operation === "DELETE" && mutation.record != null) throw failure("DELETE_CONTAINS_RECORD", 400);
  return { ...mutation, affected_local_dates: affectedDates };
}

function validateRecord(record: Json, userId: string): void {
  if (!record || !sameCanonicalUserId(record.canonical_user_id, userId)) throw failure("CROSS_USER_UPLOAD", 403);
  if (record.schema_version !== "hdl-v2.health-ingestion.v1") throw failure("SCHEMA_VERSION_MISMATCH", 400);
  const platform = String(record.platform);
  const domain = String(record.domain);
  if (!["android", "ios"].includes(platform)) throw failure("PLATFORM_MISMATCH", 400);
  if (!DOMAINS.has(domain)) throw failure("UNSUPPORTED_DOMAIN", 400);
  boundedIdentity(record.source_app);
  boundedIdentity(record.source_record_id);
  if (!UNITS[domain]?.has(String(record.unit))) throw failure("INVALID_UNIT", 400);
  if (!Number.isFinite(Date.parse(String(record.recorded_at)))) throw failure("MALFORMED_TIMESTAMP", 400);
  try { canonicalScoreDate(record.local_date); } catch { throw failure("MALFORMED_LOCAL_DATE", 400); }
  if (typeof record.timezone !== "string" || !record.timezone || record.timezone.length > 64) throw failure("MISSING_TIMEZONE", 400);
  try { new Intl.DateTimeFormat("en-US", { timeZone: record.timezone }).format(0); } catch { throw failure("INVALID_TIMEZONE", 400); }
  if (typeof record.value !== "number" || !Number.isFinite(record.value) || record.value < 0
      || record.value > MAX_VALUE_BY_DOMAIN[domain]) throw failure("MALFORMED_VALUE", 400);
  if (domain === "total_energy") {
    const start = Date.parse(String(record.started_at));
    const end = Date.parse(String(record.ended_at));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw failure("MALFORMED_INTERVAL", 400);
    }
  }
}

function validateAffectedDates(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) throw failure("INVALID_AFFECTED_DATES", 400);
  const dates = value.map((item) => {
    if (typeof item !== "string") throw failure("INVALID_AFFECTED_DATES", 400);
    try { return canonicalScoreDate(item); } catch { throw failure("INVALID_AFFECTED_DATES", 400); }
  });
  if (new Set(dates).size !== dates.length) throw failure("INVALID_AFFECTED_DATES", 400);
  return dates;
}

function boundedIdentity(value: unknown): string {
  const result = requiredString(value, "MISSING_SOURCE_IDENTITY");
  if (!result.trim()) throw failure("MISSING_SOURCE_IDENTITY", 400);
  if (result.length > 512) throw failure("SOURCE_IDENTITY_TOO_LONG", 400);
  return result;
}

export async function readJson(request: Request): Promise<Json> {
  const content = await request.text();
  if (encoder.encode(content).byteLength > MAX_BODY_BYTES) throw failure("BODY_TOO_LARGE", 413);
  try { return JSON.parse(content || "{}") as Json; } catch { throw failure("MALFORMED_JSON", 400); }
}

function bearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ") || header.length < 16) throw failure("AUTH_REQUIRED", 401);
  return header.slice(7);
}

function relativePath(pathname: string): string {
  const marker = "/mobile-health-beta";
  const index = pathname.indexOf(marker);
  return index >= 0 ? pathname.slice(index + marker.length) || "/" : pathname;
}

function json(status: number, body: Json, origin = ""): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...corsHeaders(origin) },
  });
}

function corsHeaders(origin: string): Record<string, string> {
  return origin && origin === allowedOrigin ? {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type, x-app-session-id, x-shortcut-session-id, x-canonical-user-id",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "vary": "Origin",
  } : {};
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Json).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function assertConfigured(): void {
  if (!allowedOrigin.startsWith("https://") || !webAuthVerifyUrl.startsWith("https://")
      || androidCallbackUri !== "healthcompanion-beta://auth/bootstrap") {
    throw failure("BETA_RUNTIME_NOT_CONFIGURED", 503);
  }
}

async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", arrayBuffer(bytes))));
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function uuidFromHash(hash: string): string {
  const chars = hash.slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((parseInt(chars[16], 16) & 3) | 8).toString(16);
  const value = chars.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function randomToken(size: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let binary = "";
  bytes.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeBase64(value: string): Uint8Array {
  try { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }
  catch { throw failure("MALFORMED_BASE64", 400); }
}

function decodePostgresBytea(value: string): Uint8Array {
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) throw failure("INVALID_SESSION", 401);
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (pair) => parseInt(pair, 16));
}

function derEcdsaToRaw(der: Uint8Array, width: number): Uint8Array {
  if (der.length < 8 || der[0] !== 0x30) throw failure("INVALID_SIGNATURE", 400);
  let offset = der[1] & 0x80 ? 2 + (der[1] & 0x7f) : 2;
  if (der[offset++] !== 0x02) throw failure("INVALID_SIGNATURE", 400);
  const rLength = der[offset++];
  const r = der.slice(offset, offset + rLength); offset += rLength;
  if (der[offset++] !== 0x02) throw failure("INVALID_SIGNATURE", 400);
  const sLength = der[offset++];
  const s = der.slice(offset, offset + sLength);
  const raw = new Uint8Array(width * 2);
  raw.set(r.slice(Math.max(0, r.length - width)), width - Math.min(width, r.length));
  raw.set(s.slice(Math.max(0, s.length - width)), width * 2 - Math.min(width, s.length));
  return raw;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || !value) throw failure(code, 400);
  return value;
}

function databaseFailure(error: { message?: string }): SafeError {
  const message = String(error?.message ?? "");
  for (const code of ["INVALID_CLAIM", "REPLAYED_CLAIM", "EXPIRED_CLAIM", "REVOKED_CLAIM", "WRONG_ENVIRONMENT", "CANONICAL_IDENTITY_CONFLICT", "INVALID_NATIVE_IDENTITY", "INSTALLATION_KEY_MISMATCH"]) {
    if (message.includes(code)) return failure(code, code === "REPLAYED_CLAIM" || code === "CANONICAL_IDENTITY_CONFLICT" ? 409 : code === "EXPIRED_CLAIM" ? 410 : 400);
  }
  return failure("DATABASE_OPERATION_FAILED", 500);
}

class SafeError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
function failure(code: string, status: number): SafeError { return new SafeError(code, status); }
