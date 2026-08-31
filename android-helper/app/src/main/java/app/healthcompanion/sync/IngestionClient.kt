package app.healthcompanion.sync

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

data class UploadSummary(val batchesCompleted: Int, val batchesTotal: Int, val recordsUploaded: Int)
class AuthenticationRequired : IOException("AUTHENTICATION_REQUIRED")
class OversizedBatchRejected : IOException("OVERSIZED_BATCH_REJECTED")
class BatchUploadFailed(val statusCode: Int) : IOException("BATCH_UPLOAD_FAILED")

class IngestionClient(private val baseUrl: String) {
    fun upload(
        session: BackendSession,
        records: List<CanonicalHealthRecord>,
        checkpoints: CheckpointRepository,
        onProgress: (completed: Int, total: Int) -> Unit = { _, _ -> },
    ): UploadSummary {
        requireConfigured()
        val plan = BatchPlanner.plan(session.canonicalUserId, records)
        if (plan.batches.isEmpty()) {
            checkpoints.clear()
            return UploadSummary(0, 0, 0)
        }
        val saved = checkpoints.load()
        val startIndex = BatchPlanner.resumeIndex(plan, saved)
        var uploaded = plan.batches.take(startIndex).sumOf { it.recordCount }
        for (index in startIndex until plan.batches.size) {
            postBatch(session, plan.batches[index].body)
            uploaded += plan.batches[index].recordCount
            checkpoints.save(SyncCheckpoint(plan.fingerprint, index + 1))
            onProgress(index + 1, plan.batches.size)
        }
        checkpoints.clear()
        return UploadSummary(plan.batches.size, plan.batches.size, uploaded)
    }

    private fun postBatch(session: BackendSession, body: String) {
        var attempt = 0
        while (true) {
            attempt += 1
            val status = try { execute(session, body) } catch (error: IOException) {
                if (attempt >= MAX_ATTEMPTS) throw error
                sleepBackoff(attempt)
                continue
            }
            when (RetryPolicy.action(status, attempt)) {
                RetryAction.SUCCESS -> return
                RetryAction.AUTH_FAIL -> throw AuthenticationRequired()
                RetryAction.OVERSIZE_FAIL -> throw OversizedBatchRejected()
                RetryAction.RETRY -> sleepBackoff(attempt)
                RetryAction.FAIL -> throw BatchUploadFailed(status)
            }
        }
    }

    private fun execute(session: BackendSession, body: String): Int {
        val connection = (URL("$baseUrl/v1/health/ingestion/batches").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; connectTimeout = 15_000; readTimeout = 30_000; doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Authorization", "Bearer ${session.accessToken}")
            session.legacySessionId?.let { setRequestProperty("X-App-Session-Id", it) }
        }
        return try {
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            connection.responseCode
        } finally { connection.disconnect() }
    }

    fun reportStatus(session: BackendSession, records: List<CanonicalHealthRecord>, result: String, permissionState: String): Int {
        requireConfigured()
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
            .put("permission_state_if_known", permissionState)
            .toString()
        val connection = (URL("$baseUrl/v1/mobile/connectors/status").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; connectTimeout = 15_000; readTimeout = 15_000; doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Authorization", "Bearer ${session.accessToken}")
            session.legacySessionId?.let { setRequestProperty("X-App-Session-Id", it) }
        }
        return try {
            connection.outputStream.use { it.write(body.toByteArray()) }
            connection.responseCode
        } finally { connection.disconnect() }
    }

    private fun requireConfigured() = require(baseUrl.startsWith("https://") && !baseUrl.contains(".invalid")) { "STAGING_ENDPOINT_NOT_CONFIGURED" }
    private fun sleepBackoff(attempt: Int) = Thread.sleep(250L * (1L shl (attempt - 1).coerceAtMost(2)))

    companion object {
        const val MAX_ATTEMPTS = 3

        fun mutation(user: String, record: CanonicalHealthRecord): JSONObject {
            val canonical = JSONObject().put("schema_version", "hdl-v2.health-ingestion.v1").put("canonical_user_id", user).put("platform", "android").put("domain", record.domain).put("source_app", record.sourceApp).put("source_record_id", record.sourceRecordId).put("recorded_at", record.recordedAt).put("started_at", record.startedAt).put("ended_at", record.endedAt).put("timezone", record.timezone).put("local_date", record.localDate).put("value", record.value).put("unit", record.unit).put("stage", record.stage)
            val idempotency = CanonicalIdentity.idempotencyKey(user, record)
            canonical.put("idempotency_key", idempotency)
            val revision = java.time.Instant.parse(record.sourceUpdatedAt).toEpochMilli().coerceAtLeast(1)
            return JSONObject().put("canonical_user_id", user).put("platform", "android").put("domain", record.domain).put("source_app", record.sourceApp).put("source_record_id", record.sourceRecordId).put("source_revision", revision).put("source_updated_at", record.sourceUpdatedAt).put("source_content_hash", CanonicalIdentity.sha256(canonical.toString())).put("operation", "UPSERT").put("affected_local_dates", JSONArray().put(record.localDate)).put("idempotency_key", idempotency).put("record", canonical)
        }
    }
}

enum class RetryAction { SUCCESS, AUTH_FAIL, OVERSIZE_FAIL, RETRY, FAIL }
object RetryPolicy {
    fun action(status: Int, attempt: Int): RetryAction = when {
        status in 200..299 -> RetryAction.SUCCESS
        status == 401 || status == 403 -> RetryAction.AUTH_FAIL
        status == 413 -> RetryAction.OVERSIZE_FAIL
        (status == 429 || status in 500..599) && attempt < IngestionClient.MAX_ATTEMPTS -> RetryAction.RETRY
        else -> RetryAction.FAIL
    }
}
