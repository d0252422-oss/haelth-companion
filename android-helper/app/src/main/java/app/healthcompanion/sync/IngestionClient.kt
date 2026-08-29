package app.healthcompanion.sync

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class IngestionClient(private val baseUrl: String) {
    fun upload(session: AppSession, records: List<CanonicalHealthRecord>): Int {
        require(baseUrl.startsWith("https://") && !baseUrl.endsWith(".invalid")) { "STAGING_ENDPOINT_NOT_CONFIGURED" }
        val mutations = JSONArray(records.map { record -> mutation(session.canonicalUserId, record) })
        val body = JSONObject().put("environment", "beta").put("canonical_user_id", session.canonicalUserId).put("mutations", mutations).toString()
        val connection = (URL("$baseUrl/v1/health/ingestion/batches").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; connectTimeout = 15_000; readTimeout = 30_000; doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Authorization", "Bearer ${session.accessToken}")
            setRequestProperty("X-App-Session-Id", session.sessionId)
        }
        connection.outputStream.use { it.write(body.toByteArray()) }
        return connection.responseCode
    }

    fun reportStatus(session: AppSession, records: List<CanonicalHealthRecord>, result: String): Int {
        require(baseUrl.startsWith("https://") && !baseUrl.endsWith(".invalid")) { "STAGING_ENDPOINT_NOT_CONFIGURED" }
        val now = java.time.Instant.now().toString()
        val body = JSONObject()
            .put("canonical_user_id", session.canonicalUserId)
            .put("platform", "android")
            .put("connector_type", "android_helper")
            .put("connector_version", BuildConfig.VERSION_NAME)
            .put("last_attempt_at", now)
            .put("last_success_at", if (result == "SYNCED") now else JSONObject.NULL)
            .put("last_result", result)
            .put("available_domains", JSONArray(records.map { it.domain }.distinct()))
            .put("permission_state_if_known", "GRANTED")
            .toString()
        val connection = (URL("$baseUrl/v1/mobile/connectors/status").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; connectTimeout = 15_000; readTimeout = 15_000; doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Authorization", "Bearer ${session.accessToken}")
            setRequestProperty("X-App-Session-Id", session.sessionId)
        }
        connection.outputStream.use { it.write(body.toByteArray()) }
        return connection.responseCode
    }

    private fun mutation(user: String, record: CanonicalHealthRecord): JSONObject {
        val canonical = JSONObject().put("schema_version", "hdl-v2.health-ingestion.v1").put("canonical_user_id", user).put("platform", "android").put("domain", record.domain).put("source_app", record.sourceApp).put("source_record_id", record.sourceRecordId).put("recorded_at", record.recordedAt).put("started_at", record.startedAt).put("ended_at", record.endedAt).put("timezone", record.timezone).put("local_date", record.localDate).put("value", record.value).put("unit", record.unit).put("stage", record.stage)
        val idempotency = CanonicalIdentity.idempotencyKey(user, record)
        canonical.put("idempotency_key", idempotency)
        val revision = java.time.Instant.parse(record.sourceUpdatedAt).toEpochMilli().coerceAtLeast(1)
        return JSONObject().put("canonical_user_id", user).put("platform", "android").put("domain", record.domain).put("source_app", record.sourceApp).put("source_record_id", record.sourceRecordId).put("source_revision", revision).put("source_updated_at", record.sourceUpdatedAt).put("source_content_hash", CanonicalIdentity.sha256(canonical.toString())).put("operation", "UPSERT").put("affected_local_dates", JSONArray().put(record.localDate)).put("idempotency_key", idempotency).put("record", canonical)
    }
}
