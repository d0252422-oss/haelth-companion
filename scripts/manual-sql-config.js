// Public, non-secret deployment configuration. Only explicit separate authorization may enable.
// Existing login remains Apps Script; manual data never falls back after SQL is selected.
globalThis.HEALTH_MANUAL_SQL_CONFIG=Object.freeze({enabled:true,release:'AB',schemaVersion:'manual-sql-v1',projectRef:'uavimjgccigpbwqmfkhh',endpoint:'https://uavimjgccigpbwqmfkhh.supabase.co/functions/v1/mobile-health-beta/v1/engine/web'});
