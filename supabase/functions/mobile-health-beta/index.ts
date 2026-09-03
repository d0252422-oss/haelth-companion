import { withSupabase } from "@supabase/server";
import { readBetaScores, recomputeBetaScore } from "./score-bridge.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const webAuthVerifyUrl = Deno.env.get("BETA_WEB_AUTH_VERIFY_URL") ?? "";
const allowedOrigin = Deno.env.get("BETA_ALLOWED_ORIGIN") ?? "";
const androidCallbackUri = Deno.env.get("BETA_ANDROID_CALLBACK_URI") ?? "";
const encoder = new TextEncoder();
const MAX_BODY_BYTES = 1024 * 1024;
const DOMAINS = new Set([
  "steps", "heart_rate", "resting_heart_rate", "sleep", "sleep_stage",
  "weight", "workout", "hrv", "spo2",
]);
const UNITS: Record<string, Set<string>> = {
  steps: new Set(["count"]), heart_rate: new Set(["bpm"]), resting_heart_rate: new Set(["bpm"]),
  sleep: new Set(["minute"]), sleep_stage: new Set(["minute"]), weight: new Set(["kg"]),
  workout: new Set(["minute"]), hrv: new Set(["ms"]), spo2: new Set(["percent"]),
};
type Json = Record<string, unknown>;

export default {
  fetch: withSupabase({ auth: "none" }, async (request, ctx) => {
    const origin = request.headers.get("origin") ?? "";
    if (request.method === "OPTIONS") {
      if (!origin || origin !== allowedOrigin) return json(403, { error: "ORIGIN_REJECTED" });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    try {
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
  const canonicalUserId = uuidFromHash(subjectHash);
  const { data, error } = await admin.rpc("beta_link_native_auth_identity", {
    p_auth_user_id: nativeUser.auth_user_id,
    p_canonical_user_id: canonicalUserId,
    p_external_subject_hash: subjectHash,
    p_provider: "google",
  });
  if (error) throw databaseFailure(error);
  if (String(data) !== canonicalUserId) throw failure("CANONICAL_IDENTITY_CONFLICT", 409);
  return { canonical_user_id: canonicalUserId, provider: "google", environment: "beta" };
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
  const subject = await verifyWebSession(bearer(request));
  const subjectHash = await sha256(subject);
  const claim = randomToken(32);
  const { error } = await admin.rpc("beta_issue_install_claim", {
    p_canonical_user_id: uuidFromHash(subjectHash),
    p_external_subject_hash: subjectHash,
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
  if (body.canonical_user_id !== session.canonical_user_id) throw failure("CROSS_USER_UPLOAD", 403);
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

async function shortcutRecordToMutation(record: Json, userId: string): Promise<Json> {
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
  if (body.canonical_user_id !== session.canonical_user_id) throw failure("CROSS_USER_UPLOAD", 403);
  if (!Array.isArray(body.mutations) || body.mutations.length > 250) throw failure("INVALID_BATCH", 400);
  const mutations: Json[] = [];
  for (const candidate of body.mutations) {
    const mutation = validateMutation(candidate as Json, String(session.canonical_user_id));
    mutations.push(mutation);
  }
  const { data: receipt, error } = await admin.rpc("beta_ingest_health_mutation_batch", {
    p_canonical_user_id: session.canonical_user_id,
    p_mutations: mutations,
  });
  if (error) throw databaseFailure(error);
  if (!receipt || !Array.isArray(receipt.rejected)) throw failure("INVALID_INGESTION_RECEIPT", 500);
  return json((receipt.rejected as unknown[]).length ? 207 : 200, receipt, origin);
}

async function reportStatus(request: Request, admin: any, origin: string): Promise<Response> {
  const body = await readJson(request);
  const session = await authorizeSession(request, admin);
  if (body.canonical_user_id !== session.canonical_user_id) throw failure("CROSS_USER_UPLOAD", 403);
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
  if (successfulSync) scheduleScoreRecompute(admin, String(session.canonical_user_id));
  return json(200, { status: "RECORDED", score_recompute: successfulSync ? "QUEUED" : "NOT_QUEUED" }, origin);
}

function scheduleScoreRecompute(admin: any, userId: string): void {
  EdgeRuntime.waitUntil(processScoreQueue(admin, userId, 3).catch(() => {
    // Postgres keeps the item retryable; logs intentionally exclude identity and health data.
    console.error("SCORE_BACKGROUND_RECOMPUTE_FAILED");
  }));
}

async function getStatus(request: Request, admin: any, origin: string): Promise<Response> {
  const subject = await verifyWebSession(bearer(request));
  const userId = uuidFromHash(await sha256(subject));
  const { data, error } = await admin.from("beta_connector_status")
    .select("platform,connector_type,connector_version,last_attempt_at,last_success_at,last_result,available_domains,permission_state")
    .eq("canonical_user_id", userId);
  if (error) throw databaseFailure(error);
  return json(200, { connectors: data ?? [] }, origin);
}

async function getScores(request: Request, admin: any, origin: string): Promise<Response> {
  const subject = await verifyWebSession(bearer(request));
  const userId = uuidFromHash(await sha256(subject));
  const date = new URL(request.url).searchParams.get("date") ?? undefined;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw failure("INVALID_SCORE_DATE", 400);
  const scores = await readBetaScores(admin, userId, date);
  return json(200, { ...scores, recompute_status: scores.score_freshness === "UPDATING" ? "QUEUED" : "CURRENT" }, origin);
}

async function getLatestHealth(request: Request, admin: any, origin: string): Promise<Response> {
  const subject = await verifyWebSession(bearer(request));
  const userId = uuidFromHash(await sha256(subject));
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
  return json(200, await processScoreQueue(admin, null, limit), origin);
}

async function processScoreQueue(admin: any, userId: string | null, limit: number): Promise<Json> {
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
      await recomputeBetaScore(admin, String(row.canonical_user_id), String(row.score_date));
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

async function listDirtyScoreDates(admin: any, userId: string): Promise<string[]> {
  const { data, error } = await admin.rpc("beta_list_dirty_score_dates", {
    p_canonical_user_id: userId, p_limit: 7,
  });
  if (error) throw databaseFailure(error);
  return (Array.isArray(data) ? data : []).map((row: Json) => String(row.score_date));
}

async function recomputeDates(admin: any, userId: string, dates: Set<string>): Promise<void> {
  if (dates.size > 31) throw failure("SCORE_RECOMPUTE_BOUND_EXCEEDED", 400);
  for (const date of [...dates].sort()) await recomputeBetaScore(admin, userId, date);
}

function scoreErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return message.includes("SCORE_INPUT_BOUND_EXCEEDED") ? "SCORE_INPUT_BOUND_EXCEEDED" :
    message.includes("STALE_SCORE_INPUT") ? "STALE_SCORE_INPUT" : "SCORE_RECOMPUTE_FAILED";
}

async function authorizeSession(request: Request, admin: any): Promise<Json> {
  const sessionId = request.headers.get("x-app-session-id") ?? "";
  if (!sessionId) {
    const nativeUser = await authenticateNativeUser(request, admin);
    const identity = await resolveNativeIdentity(admin, String(nativeUser.auth_user_id), true);
    if (!identity) throw failure("NATIVE_IDENTITY_NOT_LINKED", 401);
    return identity;
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

async function authenticateNativeUser(request: Request, admin: any): Promise<Json> {
  const token = bearer(request);
  const { data, error } = await admin.auth.getUser(token);
  const user = data?.user;
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

async function resolveNativeIdentity(admin: any, authUserId: string, required = true): Promise<Json | null> {
  const { data, error } = await admin.rpc("beta_resolve_native_auth_identity", {
    p_auth_user_id: authUserId,
  });
  if (error) throw databaseFailure(error);
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

async function verifyWebSession(token: string): Promise<string> {
  return (await verifyWebIdentity(token)).subject;
}

async function verifyWebIdentity(token: string): Promise<{ subject: string; email: string }> {
  if (!webAuthVerifyUrl.startsWith("https://")) throw failure("WEB_AUTH_NOT_CONFIGURED", 503);
  const upstream = await fetch(webAuthVerifyUrl, {
    method: "POST",
    headers: { "content-type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "getCurrentUser", sessionToken: token, payload: {} }),
  });
  if (!upstream.ok) throw failure("WEB_SESSION_REQUIRED", 401);
  const raw = await upstream.json().catch(() => null) as Json | null;
  const data = (raw?.data ?? raw?.result ?? raw) as Json | null;
  const profile = (data?.profile ?? data) as Json | null;
  const subject = profile?.UserID ?? profile?.userId ?? profile?.id;
  if (typeof subject !== "string" || subject.length < 1 || subject.length > 256) throw failure("WEB_SESSION_REQUIRED", 401);
  const rawEmail = profile?.Email ?? profile?.email;
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (email.length > 320) throw failure("WEB_IDENTITY_EMAIL_REQUIRED", 401);
  return { subject, email };
}

function validateMutation(mutation: Json, userId: string): Json {
  if (mutation.canonical_user_id !== userId) throw failure("CROSS_USER_UPLOAD", 403);
  if (!["android", "ios"].includes(String(mutation.platform))) throw failure("PLATFORM_MISMATCH", 400);
  if (!DOMAINS.has(String(mutation.domain))) throw failure("UNSUPPORTED_DOMAIN", 400);
  if (!["UPSERT", "DELETE"].includes(String(mutation.operation))) throw failure("INVALID_OPERATION", 400);
  if (!Number.isSafeInteger(mutation.source_revision) || Number(mutation.source_revision) < 1) throw failure("INVALID_SOURCE_REVISION", 400);
  for (const field of ["source_content_hash", "idempotency_key"]) {
    if (!/^[0-9a-f]{64}$/.test(String(mutation[field] ?? ""))) throw failure("INVALID_HASH", 400);
  }
  requiredString(mutation.source_app, "MISSING_SOURCE_IDENTITY");
  requiredString(mutation.source_record_id, "MISSING_SOURCE_IDENTITY");
  if (mutation.operation === "UPSERT") validateRecord(mutation.record as Json, userId);
  if (mutation.operation === "DELETE" && mutation.record != null) throw failure("DELETE_CONTAINS_RECORD", 400);
  return mutation;
}

function validateRecord(record: Json, userId: string): void {
  if (!record || record.canonical_user_id !== userId) throw failure("CROSS_USER_UPLOAD", 403);
  if (record.schema_version !== "hdl-v2.health-ingestion.v1") throw failure("SCHEMA_VERSION_MISMATCH", 400);
  if (!Number.isFinite(Date.parse(String(record.recorded_at)))) throw failure("MALFORMED_TIMESTAMP", 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(record.local_date ?? ""))) throw failure("MALFORMED_LOCAL_DATE", 400);
  if (typeof record.timezone !== "string" || !record.timezone) throw failure("MISSING_TIMEZONE", 400);
  if (typeof record.value !== "number" || !Number.isFinite(record.value)) throw failure("MALFORMED_VALUE", 400);
}

async function readJson(request: Request): Promise<Json> {
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
