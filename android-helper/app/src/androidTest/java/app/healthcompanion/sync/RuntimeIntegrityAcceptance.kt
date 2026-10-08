package app.healthcompanion.sync

import android.content.Context
import android.os.Bundle
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** Test APK only. Production reader/mapper/planner/transport; no fake records.
 * Backfill requires an independently SQL-verified, identity-scoped local plan.
 * Does not start an Activity, enqueue a worker or advance normal sync status.
 */
internal object RuntimeIntegrityAcceptance {
    suspend fun run(context: Context, args: Bundle): JSONObject {
        val start = LocalDate.parse(requireNotNull(args.getString("start_date")))
        val end = LocalDate.parse(requireNotNull(args.getString("end_date")))
        require(!end.isBefore(start) && end.toEpochDay() - start.toEpochDay() < 31)
        val zone = ZoneId.of("Asia/Taipei")
        val from = start.atStartOfDay(zone).toInstant()
        val until = end.plusDays(1).atStartOfDay(zone).toInstant()
        val report = JSONObject().put("mode",args.getString("mode"))
            .put("range_start",start.toString()).put("range_end",end.toString())
            .put("started_at",Instant.now().toString()).put("health_values_included",false)
            .put("background_acceptance",false).put("status","READING")
        fun save() { File(context.filesDir,"health-runtime-integrity.json").writeText(report.toString()) }
        save()
        try {
            val read = withTimeout(300_000L) { HealthConnectGateway(context).readBounded(from,until) }
            val traces = JSONObject()
            read.domainTraces.forEach { (domain, trace) ->
                traces.put(domain,JSONObject().put("source_count",trace.sourceCount ?: JSONObject.NULL)
                    .put("mapped_count",trace.mappedCount).put("pages",trace.pages).put("status",trace.status)
                    .put("drop_reasons",JSONObject(trace.dropReasons)).put("recovery_attempts",trace.recoveryAttempts))
            }
            report.put("traces",traces).put("reader_partial",read.isPartial).put("status","RESTORING_EXISTING_SESSION")
            // Preserve every record returned by the production time filter.
            // Source offsets may give interval records a different canonical date.
            val records = read.records
            val ledger = JSONArray()
            records.forEach { r -> ledger.put(JSONObject().put("domain",r.domain).put("date",r.localDate)
                .put("source_app",r.sourceApp).put("id_hash",CanonicalIdentity.sha256(r.sourceRecordId))
                .put("source_updated_at",r.sourceUpdatedAt).put("revision",SleepStageRevisionPolicy.revision(r.domain,r.sourceUpdatedAt).toString())) }
            report.put("mapped_ledger",ledger)
            save()
            require(BuildConfig.API_BASE_URL == "https://uavimjgccigpbwqmfkhh.supabase.co/functions/v1/mobile-health-beta")
            val auth = NativeGoogleAuth(context,BuildConfig.SUPABASE_URL,BuildConfig.SUPABASE_PUBLISHABLE_KEY,
                BuildConfig.GOOGLE_WEB_CLIENT_ID,BuildConfig.API_BASE_URL)
            val session = withTimeout(60_000L) { auth.restore() } ?: error("EXISTING_SESSION_UNAVAILABLE")
            val scope = CanonicalIdentity.sha256(session.canonicalUserId).take(16)
            report.put("canonical_scope_hash",scope).put("identity_source","SERVER_SESSION_RESOLUTION")
            records.forEachIndexed { index, record ->
                ledger.getJSONObject(index).put("content_hash",IngestionClient.mutation(session.canonicalUserId,record).getString("source_content_hash"))
            }
            val plan = BatchPlanner.plan(session.canonicalUserId,records)
            report.put("batch_count",plan.batches.size).put("planned_count",plan.batches.sumOf { it.recordCount })
                .put("largest_batch_count",plan.batches.maxOfOrNull { it.recordCount } ?: 0)
                .put("largest_batch_bytes",plan.batches.maxOfOrNull { it.body.toByteArray(Charsets.UTF_8).size } ?: 0)
                .put("status","RUNTIME_READ_COMPLETE")
            save()
            if (args.getString("mode") != "verified_backfill") return report
            check(!read.isPartial) { "PARTIAL_READ_NO_BACKFILL" }
            val verified = JSONObject(File(context.filesDir,"verified-backfill-plan.json").readText())
            require(verified.getString("canonical_scope_hash") == scope)
            require(verified.getString("range_start") == start.toString() && verified.getString("range_end") == end.toString())
            val reason = verified.getString("reason")
            require(reason in setOf("SOURCE_PRESENT_SQL_MISSING", "SOURCE_REVISION_NEWER_SQL_STALE"))
            val entries = verified.getJSONArray("records")
            require(entries.length() in 1..2000)
            fun key(domain: String, app: String, hash: String) = "$domain|$app|$hash"
            val expected = (0 until entries.length()).associate { i -> val r=entries.getJSONObject(i)
                key(r.getString("domain"),r.getString("source_app"),r.getString("id_hash")) to r.getString("source_updated_at") }
            require(expected.size == entries.length())
            val selected = records.filter { r -> expected[key(r.domain,r.sourceApp,CanonicalIdentity.sha256(r.sourceRecordId))] == r.sourceUpdatedAt }
            check(selected.size == expected.size) { "VERIFIED_PLAN_STALE" }
            if (reason == "SOURCE_REVISION_NEWER_SQL_STALE") {
                val previous = (0 until entries.length()).associate { i -> val r=entries.getJSONObject(i)
                    key(r.getString("domain"),r.getString("source_app"),r.getString("id_hash")) to r.getString("sql_revision").toLong() }
                require(selected.all { r -> SleepStageRevisionPolicy.revision(r.domain,r.sourceUpdatedAt) >
                    previous.getValue(key(r.domain,r.sourceApp,CanonicalIdentity.sha256(r.sourceRecordId))) })
            }
            report.put("backfill_selected_count",selected.size).put("backfill_domains",JSONObject(selected.groupingBy { it.domain }.eachCount()))
            val http = JSONArray()
            IngestionClient(BuildConfig.API_BASE_URL,onHttpResult={ response ->
                http.put(JSONObject().put("status",response.statusCode).put("accepted",response.acceptedCount ?: JSONObject.NULL)
                    .put("duplicate",response.duplicateCount ?: JSONObject.NULL).put("rejected",response.rejectedCount ?: JSONObject.NULL)
                    .put("reasons",JSONObject(response.rejectionReasons)))
                report.put("http",http); save()
            }).use { client ->
                val diagnostic = SyncTriggerDiagnostic(SyncTriggerSource.BACKFILL)
                report.put("flow_id",diagnostic.flowId).put("status","VERIFIED_BACKFILL_UPLOADING"); save()
                val result = withTimeout(300_000L) { client.upload(session,selected,MemoryCheckpoint(),diagnostic) }
                check(!result.reconciliationPending)
                report.put("persisted_count",result.recordsUploaded).put("persisted_domains",JSONObject(result.persistedDomainCounts))
                    .put("status","VERIFIED_BACKFILL_COMPLETE"); save()
                if (args.getString("verify_replay") == "true") {
                    val replay = withTimeout(300_000L) { client.upload(session,selected,MemoryCheckpoint(),diagnostic) }
                    report.put("replay_confirmed_count",replay.recordsUploaded).put("replay_complete",!replay.reconciliationPending)
                }
            }
        } catch (e: Exception) {
            report.put("status","INCOMPLETE").put("error_class",e.javaClass.simpleName)
            // Only locally-defined, uppercase reason codes; never exception text/health values.
            e.message?.takeIf { it.matches(Regex("[A-Z][A-Z0-9_]{0,63}")) }?.let { report.put("error_code",it) }
        }
        report.put("finished_at",Instant.now().toString()); save()
        return report
    }
    private class MemoryCheckpoint : CheckpointRepository {
        private var current: SyncCheckpoint? = null
        override fun load() = current
        override fun save(checkpoint: SyncCheckpoint) { current = checkpoint }
        override fun clear() { current = null }
    }
}
