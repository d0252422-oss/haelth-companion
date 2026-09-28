package app.healthcompanion.sync

import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject
import java.io.Closeable
import java.io.IOException
import java.time.Instant
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.util.concurrent.TimeUnit

data class UploadSummary(
    val batchesCompleted: Int,
    val batchesTotal: Int,
    val recordsUploaded: Int,
    val reconciliationPending: Boolean = false,
)
class AuthenticationRequired : IOException("AUTHENTICATION_REQUIRED")
class OversizedBatchRejected : IOException("OVERSIZED_BATCH_REJECTED")
class BatchUploadFailed(val statusCode: Int) : IOException("BATCH_UPLOAD_FAILED")
class BackfillCatchUpRequired : IOException("BACKFILL_CATCH_UP_REQUIRED")

internal data class IngestionHttpResult(val statusCode: Int, val errorCode: String? = null)

internal fun interface IngestionTransport : Closeable {
    suspend fun post(path: String, session: BackendSession, body: String): IngestionHttpResult
    override fun close() = Unit
}

internal class OkHttpIngestionTransport(
    private val baseUrl: String,
    connectTimeoutMs: Long = IngestionClient.CONNECT_TIMEOUT_MS,
    socketTimeoutMs: Long = IngestionClient.SOCKET_TIMEOUT_MS,
    callTimeoutMs: Long = IngestionClient.CALL_TIMEOUT_MS,
) : IngestionTransport {
    private val client = HttpClient(OkHttp) {
        engine {
            config {
                retryOnConnectionFailure(false)
                connectTimeout(connectTimeoutMs, TimeUnit.MILLISECONDS)
                readTimeout(socketTimeoutMs, TimeUnit.MILLISECONDS)
                writeTimeout(socketTimeoutMs, TimeUnit.MILLISECONDS)
                callTimeout(callTimeoutMs, TimeUnit.MILLISECONDS)
            }
        }
        install(HttpTimeout) {
            connectTimeoutMillis = connectTimeoutMs
            socketTimeoutMillis = socketTimeoutMs
            requestTimeoutMillis = callTimeoutMs
        }
    }

    override suspend fun post(path: String, session: BackendSession, body: String): IngestionHttpResult {
        val response = client.post("$baseUrl$path") {
            contentType(ContentType.Application.Json)
            header(HttpHeaders.Authorization, "Bearer ${session.accessToken}")
            session.legacySessionId?.let { header("X-App-Session-Id", it) }
            setBody(body)
        }
        // Consume every response so the connection can be reused across hundreds
        // of bounded backfill requests. Only a small, allowlisted error code is kept.
        val responseBody = response.bodyAsText()
        return IngestionHttpResult(
            response.status.value,
            response.status.value.takeIf { it >= 400 }?.let {
                sanitizedServerError(responseBody.take(IngestionClient.MAX_ERROR_BODY_CHARS))
            },
        )
    }

    override fun close() {
        client.close()
    }
}

internal fun sanitizedServerError(body: String): String? = runCatching {
    JSONObject(body).optString("error").takeIf { it.matches(Regex("[A-Z][A-Z0-9_]{0,63}")) }
}.getOrNull()

internal class IngestionClient(
    private val baseUrl: String,
    private val transport: IngestionTransport = OkHttpIngestionTransport(baseUrl),
    private val backoff: suspend (Long) -> Unit = { delay(it) },
    private val onHttpResult: (IngestionHttpResult) -> Unit = {},
) : Closeable {
    suspend fun upload(
        session: BackendSession,
        records: List<CanonicalHealthRecord>,
        checkpoints: CheckpointRepository,
        onProgress: (completed: Int, total: Int) -> Unit = { _, _ -> },
    ): UploadSummary {
        requireConfigured()
        val plan = BatchPlanner.streamingPlan(session.canonicalUserId, records, checkpoints.load())
        var nextRecordIndex = plan.nextRecordIndex
        var completedBatches = plan.nextBatchIndex
        while (nextRecordIndex < plan.orderedRecords.size) {
            val batch = BatchPlanner.nextStreamingBatch(session.canonicalUserId, plan.orderedRecords, nextRecordIndex)
                ?: break
            postBatch(session, batch.body)
            nextRecordIndex = batch.nextRecordIndex
            completedBatches += 1
            checkpoints.save(SyncCheckpoint(
                planFingerprint = plan.fingerprint,
                nextBatchIndex = completedBatches,
                nextRecordIndex = nextRecordIndex,
                lastRecordKey = BatchPlanner.encodedRecordKey(plan.orderedRecords[nextRecordIndex - 1]),
                reconciliationPass = plan.reconciliationPass,
                datasetChanged = plan.datasetChanged,
            ))
            onProgress(
                completedBatches,
                BatchPlanner.estimatedTotalBatches(completedBatches, plan.orderedRecords.size - nextRecordIndex),
            )
        }
        if (plan.datasetChanged && plan.reconciliationPass < MAX_RECONCILIATION_PASSES) {
            checkpoints.save(SyncCheckpoint(
                planFingerprint = plan.currentFingerprint,
                nextBatchIndex = 0,
                nextRecordIndex = 0,
                reconciliationPass = plan.reconciliationPass + 1,
            ))
            throw BackfillCatchUpRequired()
        }
        if (plan.datasetChanged) {
            // Keep a durable, clean-pass cursor for a later attempt. Returning a
            // partial receipt must never strand an EOF checkpoint whose dirty bit
            // can no longer converge.
            checkpoints.save(SyncCheckpoint(
                planFingerprint = plan.currentFingerprint,
                nextBatchIndex = 0,
                nextRecordIndex = 0,
                reconciliationPass = MAX_RECONCILIATION_PASSES,
            ))
        }
        return UploadSummary(
            completedBatches,
            completedBatches,
            nextRecordIndex,
            reconciliationPending = plan.datasetChanged,
        )
    }

    private suspend fun postBatch(session: BackendSession, body: String) {
        var attempt = 0
        while (true) {
            attempt += 1
            val status = try { execute(session, body) } catch (error: IOException) {
                if (!RetryPolicy.isRetryable(error) || attempt >= MAX_ATTEMPTS) throw error
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

    private suspend fun execute(session: BackendSession, body: String): Int {
        val result = transport.post("/v1/health/ingestion/batches", session, body)
        onHttpResult(result)
        return result.statusCode
    }

    suspend fun reportStatus(session: BackendSession, records: List<CanonicalHealthRecord>, result: String, permissionState: String) {
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
        val httpResult = transport.post("/v1/mobile/connectors/status", session, body)
        onHttpResult(httpResult)
        when (RetryPolicy.action(httpResult.statusCode, 1)) {
            RetryAction.SUCCESS -> Unit
            RetryAction.AUTH_FAIL -> throw AuthenticationRequired()
            RetryAction.OVERSIZE_FAIL -> throw OversizedBatchRejected()
            RetryAction.RETRY, RetryAction.FAIL -> throw BatchUploadFailed(httpResult.statusCode)
        }
    }

    private fun requireConfigured() = require(baseUrl.startsWith("https://") && !baseUrl.contains(".invalid")) { "STAGING_ENDPOINT_NOT_CONFIGURED" }
    private suspend fun sleepBackoff(attempt: Int) = backoff(250L * (1L shl (attempt - 1).coerceAtMost(2)))
    override fun close() = transport.close()

    companion object {
        const val MAX_ATTEMPTS = 3
        const val CONNECT_TIMEOUT_MS = 15_000L
        const val SOCKET_TIMEOUT_MS = 30_000L
        const val CALL_TIMEOUT_MS = 45_000L
        const val MAX_ERROR_BODY_CHARS = 1_024
        const val MAX_RECONCILIATION_PASSES = 2

        fun mutation(user: String, record: CanonicalHealthRecord): JSONObject {
            val canonical = JSONObject().put("schema_version", "hdl-v2.health-ingestion.v1").put("canonical_user_id", user).put("platform", "android").put("domain", record.domain).put("source_app", record.sourceApp).put("source_record_id", record.sourceRecordId).put("recorded_at", record.recordedAt).put("started_at", record.startedAt).put("ended_at", record.endedAt).put("timezone", record.timezone).put("local_date", record.localDate).put("value", record.value).put("unit", record.unit).put("stage", record.stage)
            val idempotency = CanonicalIdentity.idempotencyKey(user, record)
            canonical.put("idempotency_key", idempotency)
            val revision = java.time.Instant.parse(record.sourceUpdatedAt).toEpochMilli().coerceAtLeast(1)
            return JSONObject().put("canonical_user_id", user).put("platform", "android").put("domain", record.domain).put("source_app", record.sourceApp).put("source_record_id", record.sourceRecordId).put("source_revision", revision).put("source_updated_at", record.sourceUpdatedAt).put("source_content_hash", CanonicalIdentity.sha256(canonical.toString())).put("operation", "UPSERT").put("affected_local_dates", affectedLocalDates(record)).put("idempotency_key", idempotency).put("record", canonical)
        }

        private fun affectedLocalDates(record: CanonicalHealthRecord): JSONArray {
            if (record.domain != "total_energy") return JSONArray().put(record.localDate)
            val start = Instant.parse(requireNotNull(record.startedAt))
            val end = Instant.parse(requireNotNull(record.endedAt))
            require(end.isAfter(start)) { "INVALID_TOTAL_ENERGY_INTERVAL" }
            val zone = ZoneId.of(record.timezone)
            var date = start.atZone(zone).toLocalDate()
            val lastCoveredDate = end.minusNanos(1).atZone(zone).toLocalDate()
            val dates = linkedSetOf<String>()
            // Dates are invalidation markers, not per-day kcal. A later source
            // reconciliation gate must decide how overlapping origins are used.
            val coveredDays = ChronoUnit.DAYS.between(date, lastCoveredDate) + 1
            val endOwnerIsExtra = record.localDate != lastCoveredDate.toString()
            if (coveredDays + (if (endOwnerIsExtra) 1 else 0) > 32) {
                // The Edge accepts at most 32 markers. Preserve the entire raw interval
                // and its boundary markers; do not fail a mixed-domain sync or imply that
                // the omitted intermediate dates have calculated daily kcal values.
                return JSONArray(linkedSetOf(date.toString(), lastCoveredDate.toString(), record.localDate).sorted())
            }
            while (!date.isAfter(lastCoveredDate)) {
                dates += date.toString()
                date = date.plusDays(1)
            }
            dates += record.localDate // Existing interval ownership uses the end date.
            return JSONArray(dates.sorted())
        }
    }
}

enum class RetryAction { SUCCESS, AUTH_FAIL, OVERSIZE_FAIL, RETRY, FAIL }
object RetryPolicy {
    fun isRetryable(error: Throwable): Boolean = error is IOException &&
        error !is AuthenticationRequired &&
        error !is OversizedBatchRejected &&
        error !is BatchUploadFailed

    fun action(status: Int, attempt: Int): RetryAction = when {
        status == 207 -> RetryAction.FAIL
        status in 200..299 -> RetryAction.SUCCESS
        status == 401 || status == 403 -> RetryAction.AUTH_FAIL
        status == 413 -> RetryAction.OVERSIZE_FAIL
        (status == 429 || status in 500..599) && attempt < IngestionClient.MAX_ATTEMPTS -> RetryAction.RETRY
        else -> RetryAction.FAIL
    }

    fun shouldRetryWorker(error: Throwable, runAttemptCount: Int, maxAttempts: Int): Boolean {
        if (runAttemptCount >= maxAttempts - 1) return false
        return when (error) {
            is AuthenticationRequired, is OversizedBatchRejected -> false
            is BatchUploadFailed -> error.statusCode == 429 || error.statusCode in 500..599
            is IOException -> true
            else -> false
        }
    }
}
