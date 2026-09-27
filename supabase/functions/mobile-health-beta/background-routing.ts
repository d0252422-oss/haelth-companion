type Env = (key: string) => string | undefined;

const BACKGROUND_MUTATION_PATHS = new Set([
  "/v1/health/ingestion/batches",
  "/v1/connectors/ios-shortcut/ingest",
  "/v1/mobile/connectors/status",
  "/internal/score-recompute/drain",
]);

/**
 * Manual Web SQL and native/background ingestion use different least-privilege
 * database roles. Enabling the manual provider must never implicitly route
 * mobile ingestion into an unconfigured background provider.
 */
export function shouldRouteBackgroundMutation(
  path: string,
  method: string,
  env: Env,
): boolean {
  return method !== "GET" && BACKGROUND_MUTATION_PATHS.has(path) &&
    env("HEALTH_BACKGROUND_SQL_ENABLED") === "1";
}
