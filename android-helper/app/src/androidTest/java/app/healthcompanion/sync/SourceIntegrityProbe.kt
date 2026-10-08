package app.healthcompanion.sync

import android.app.Instrumentation
import android.os.Bundle
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.reflect.KClass

/** Default is read-only source capture. Explicit runtime/backfill modes use the
 * production pipeline and independently verified plans; never schedule workers. */
class SourceIntegrityProbe : Instrumentation() {
    private lateinit var arguments: Bundle
    private val zone = ZoneId.of("Asia/Taipei")
    override fun onCreate(arguments: Bundle?) { this.arguments = arguments ?: Bundle(); start() }
    override fun onStart() {
        val result = Bundle()
        try {
            val runtime = arguments.getString("mode") in setOf("runtime", "verified_backfill")
            val extras = arguments.getString("mode") == "verify_sql_extras"
            val report = runBlocking {
                if (runtime) RuntimeIntegrityAcceptance.run(targetContext, arguments)
                else if (extras) verifySqlExtras() else snapshot()
            }
            val filename = if (runtime) "health-runtime-integrity.json"
                else if (extras) "health-extra-integrity.json" else "health-source-integrity.json"
            File(targetContext.filesDir, filename).writeText(report.toString())
            result.putString("stream", "INTEGRITY_REPORT_SAVED; HEALTH_VALUES_EXCLUDED")
            finish(0, result)
        } catch (e: Exception) {
            result.putString("stream", "SOURCE_SNAPSHOT_FAILED:" + e.javaClass.simpleName)
            finish(1, result)
        }
    }
    /** By-ID source lookup distinguishes deleted/replaced IDs from range omissions. */
    private suspend fun verifySqlExtras(): JSONObject {
        val plan = JSONObject(File(targetContext.filesDir,"extra-source-read-plan.json").readText()).getJSONArray("records")
        require(plan.length() in 1..300)
        val client = HealthConnectClient.getOrCreate(targetContext)
        val rows = JSONArray()
        withTimeout(300_000L) {
            for (i in 0 until plan.length()) {
                val item=plan.getJSONObject(i)
                val id=item.getString("source_record_id")
                require(hash(id)==item.getString("id_hash"))
                val domain=item.getString("domain")
                val row=JSONObject().put("domain",domain).put("id_hash",hash(id))
                try {
                    val record: Record = withTimeout<Record>(15_000L) {
                        when(domain) {
                            "steps" -> readOne(client,StepsRecord::class,id)
                            "total_energy" -> readOne(client,TotalCaloriesBurnedRecord::class,id)
                            else -> error("UNSUPPORTED_EXTRA_DOMAIN")
                        }
                    }
                    require(record.metadata.dataOrigin.packageName==item.getString("source_app"))
                    val time=bounds(record)
                    row.put("status","SOURCE_PRESENT").put("start",time.first.toString()).put("end",time.second.toString())
                        .put("taipei_date",time.second.atZone(zone).toLocalDate().toString())
                } catch (e: android.os.RemoteException) {
                    // connect-client 1.1.0 emits exactly this only for an empty
                    // platform ReadRecordsRequestUsingIds response.
                    row.put("status",if(e.message=="No records") "SOURCE_RECORD_NOT_FOUND" else "UNKNOWN")
                        .put("error_class",e.javaClass.simpleName)
                } catch(e: Exception) {
                    row.put("status","UNKNOWN").put("error_class",e.javaClass.simpleName)
                }
                rows.put(row)
            }
        }
        return JSONObject().put("captured_at",Instant.now().toString()).put("rows",rows).put("health_values_included",false)
    }
    private suspend fun <T : Record> readOne(client: HealthConnectClient, type: KClass<T>, id: String): Record =
        client.readRecord(type,id).record
    private suspend fun snapshot(): JSONObject {
        val start = LocalDate.parse(arguments.getString("start_date") ?: "2026-10-01")
        val end = LocalDate.parse(arguments.getString("end_date") ?: "2026-10-08")
        require(!end.isBefore(start) && end.toEpochDay() - start.toEpochDay() < 31)
        val from = start.atStartOfDay(zone).toInstant()
        val until = end.plusDays(1).atStartOfDay(zone).toInstant()
        val client = HealthConnectClient.getOrCreate(targetContext)
        val granted = client.permissionController.getGrantedPermissions()
        val domains = JSONArray()
        val ledger = JSONArray()
        val types = listOf(
            "steps" to StepsRecord::class, "heart_rate" to HeartRateRecord::class,
            "resting_heart_rate" to RestingHeartRateRecord::class, "sleep" to SleepSessionRecord::class,
            "weight" to WeightRecord::class, "workout" to ExerciseSessionRecord::class,
            "hrv" to HeartRateVariabilityRmssdRecord::class, "spo2" to OxygenSaturationRecord::class,
            "total_energy" to TotalCaloriesBurnedRecord::class,
        )
        for ((domain, type) in types) {
            val entry = JSONObject().put("domain", domain).put("granted", HealthPermission.getReadPermission(type) in granted)
            domains.put(entry)
            if (!entry.getBoolean("granted")) { entry.put("status", "PERMISSION_NOT_GRANTED"); continue }
            val records = mutableListOf<Record>()
            try {
                val pages = withTimeout(120_000L) { readAll(client, type, from, until, records) }
                val sourceRows = JSONArray()
                for (record in records) {
                    val bounds = bounds(record)
                    val owner = bounds.second.atZone(zone).toLocalDate().toString()
                    val sourceHash = hash(record.metadata.id)
                    sourceRows.put(JSONObject().put("id_hash", sourceHash).put("date", owner)
                        .put("start", bounds.first.toString()).put("end", bounds.second.toString())
                        .put("source_app", record.metadata.dataOrigin.packageName)
                        .put("source_updated_at", record.metadata.lastModifiedTime.toString()))
                    fun expected(d: String, id: String, date: String) {
                        ledger.put(JSONObject().put("domain", d).put("id_hash", hash(id)).put("source_id_hash", sourceHash)
                            .put("date", date).put("source_app", record.metadata.dataOrigin.packageName)
                            .put("source_updated_at", record.metadata.lastModifiedTime.toString()))
                    }
                    when (record) {
                        is HeartRateRecord -> record.samples.forEach { sample ->
                            expected(domain, record.metadata.id + ":" + sample.time, sample.time.atZone(zone).toLocalDate().toString())
                        }
                        is SleepSessionRecord -> {
                            expected(domain, record.metadata.id, owner)
                            record.stages.forEach { stage -> expected("sleep_stage",
                                "${record.metadata.id}:${stage.startTime}:${stage.endTime}:${stage.stage}", owner) }
                        }
                        else -> expected(domain, record.metadata.id, owner)
                    }
                }
                entry.put("status", "COMPLETE").put("pages", pages).put("source_count", records.size).put("records", sourceRows)
            } catch (e: Exception) {
                entry.put("status", "UNKNOWN").put("error_code", e.javaClass.simpleName)
                    .put("partial_source_count", records.size)
            }
        }
        return JSONObject().put("schema_version", "health-source-integrity-v1").put("timezone", zone.id)
            .put("range_start", start.toString()).put("range_end", end.toString())
            .put("captured_at", Instant.now().toString()).put("synthetic", false)
            .put("source", "DIRECT_HEALTH_CONNECT_READ").put("health_values_included", false)
            .put("domains", domains).put("expected_canonical_ledger", ledger)
    }
    private suspend fun <T : Record> readAll(client: HealthConnectClient, type: KClass<T>, from: Instant, until: Instant, out: MutableList<Record>): Int {
        var token: String? = null
        val seen = mutableSetOf<String>()
        var pages = 0
        do {
            val response = client.readRecords(ReadRecordsRequest(type, TimeRangeFilter.between(from, until), pageSize = 500, pageToken = token))
            out.addAll(response.records)
            pages++
            token = response.pageToken?.takeIf { it.isNotBlank() }
            check(token == null || seen.add(token)) { "REPEATED_PAGE_TOKEN" }
            check(token == null || pages < 50) { "SOURCE_PAGE_CAP" }
        } while (token != null)
        return pages
    }
    private fun bounds(record: Record): Pair<Instant, Instant> = when (record) {
        is StepsRecord -> record.startTime to record.endTime
        is HeartRateRecord -> record.startTime to record.endTime
        is SleepSessionRecord -> record.startTime to record.endTime
        is ExerciseSessionRecord -> record.startTime to record.endTime
        is TotalCaloriesBurnedRecord -> record.startTime to record.endTime
        is RestingHeartRateRecord -> record.time to record.time
        is WeightRecord -> record.time to record.time
        is HeartRateVariabilityRmssdRecord -> record.time to record.time
        is OxygenSaturationRecord -> record.time to record.time
        else -> error("UNSUPPORTED_RECORD")
    }
    private fun hash(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}
