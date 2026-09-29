/** Client-reported provenance is observability only, never an auth or owner claim. */
const SOURCES = new Set([
  "PERIODIC_WORKER", "APP_START", "MANUAL_SYNC", "BACKFILL",
  "BOOT_RECOVERY", "RETRY", "UNKNOWN",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_INSTANT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/;

function safeSource(value: unknown): string {
  return typeof value === "string" && SOURCES.has(value) ? value : "UNKNOWN";
}

function safeUuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}

function safeInstant(value: unknown): string | null {
  return typeof value === "string" && ISO_INSTANT.test(value) &&
      Number.isFinite(Date.parse(value)) ? value : null;
}

function safeAttempt(value: unknown, minimum: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= 100
    ? value : null;
}

export function safeSyncTriggerDiagnostic(raw: unknown) {
  const value = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {};
  return {
    trigger_source: safeSource(value.trigger_source),
    origin_trigger_source: safeSource(value.origin_trigger_source),
    flow_id: safeUuid(value.flow_id),
    worker_id: safeUuid(value.worker_id),
    attempt: safeAttempt(value.attempt, 1),
    worker_attempt: safeAttempt(value.worker_attempt, 0),
    started_at: safeInstant(value.started_at),
  };
}

/** Call only after the ingestion/status transaction has committed successfully. */
export function logPersistedSyncReceipt(
  kind: "ingestion" | "connector_status",
  diagnostic: unknown,
  httpStatus: number,
  receipt: Record<string, unknown>,
  verifiedContext: { platform: "android" | "ios" | null; auth_kind: "native_bearer" | "app_session" | "shortcut_credential" },
): void {
  if (!diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic)) return;
  const count = (key: string) => Array.isArray(receipt[key]) ? (receipt[key] as unknown[]).length : 0;
  const result = typeof receipt.last_result === "string" &&
      /^(SYNCED|SYNCED_RECENT|SYNCED_PARTIAL|NO_DATA|FAILED|RETRY_PENDING)$/.test(receipt.last_result)
    ? receipt.last_result : null;
  console.info("HEALTH_SYNC_RECEIPT " + JSON.stringify({
    kind,
    verified_platform: verifiedContext.platform,
    verified_auth_kind: verifiedContext.auth_kind,
    ...safeSyncTriggerDiagnostic(diagnostic),
    http_status: httpStatus,
    accepted_count: kind === "ingestion" ? count("accepted_idempotency_keys") : null,
    duplicate_count: kind === "ingestion" ? count("duplicate_idempotency_keys") : null,
    rejected_count: kind === "ingestion" ? count("rejected") : null,
    last_result: kind === "connector_status" ? result : null,
    completed_at: new Date().toISOString(),
  }));
}
