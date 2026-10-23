package app.healthcompanion.sync

import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.time.Instant
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream
import org.json.JSONArray
import org.json.JSONObject

/** One immutable HC read page plus a verified-page ledger; never a credential store. */
internal data class PendingSyncPage(
    val window: SyncWindow,
    val page: Int = 0,
    val remaining: Set<String>? = null,
    val cursors: Map<String, String> = emptyMap(),
    val totals: Map<String, DomainReadTrace> = emptyMap(),
    val read: HealthReadResult? = null,
    val starts: Map<String, String> = emptyMap(),
    val cursorRestarts: Map<String, Int> = emptyMap(),
) {
    val segment: String? get() = if (page == 0) null else "${window.start}|${window.end}|$page"
    val complete: Boolean get() = remaining?.isEmpty() == true && read == null

    /** Called only after every mutation in this page has an exact SQL receipt. */
    fun verified(persisted: Map<String, Int>): PendingSyncPage {
        val input = requireNotNull(read)
        require(input.records.groupingBy { it.domain }.eachCount() == persisted.filterValues { it > 0 }) { "PAGE_RECEIPTS_INCOMPLETE" }
        val nextTotals = totals.toMutableMap()
        input.domainTraces.forEach { (domain, trace) ->
            if (trace.status in setOf("COMPLETE", "CAPPED") && trace.dropReasons.isEmpty()) {
                val old = nextTotals[domain]
                nextTotals[domain] = trace.copy(
                    sourceCount = if (old == null) trace.sourceCount else old.sourceCount?.let { a -> trace.sourceCount?.let { a + it } },
                    mappedCount = (old?.mappedCount ?: 0) + trace.mappedCount,
                    pages = (old?.pages ?: 0) + trace.pages,
                )
            }
        }
        val failed = input.failedDomains + (input.cappedDomains - input.nextPageTokens.keys) +
            (remaining.orEmpty() - input.domainTraces.keys)
        val nextDomains = input.nextPageTokens.keys + failed
        val nextCursors = (input.nextPageTokens + cursors.filterKeys { it in failed }).toMutableMap()
        val restarts = cursorRestarts.toMutableMap()
        // A rejected/expired opaque cursor gets one fixed-range idempotent replay,
        // never a timestamp jump or an unbounded restart loop.
        failed.filter { it in cursors && (restarts[it] ?: 0) < 1 }.forEach { domain ->
            nextCursors.remove(domain)
            restarts[domain] = 1
            nextTotals.remove(domain)
            if (domain == "sleep") nextTotals.remove("sleep_stage")
        }
        return copy(page = page + 1, remaining = nextDomains, cursors = nextCursors, totals = nextTotals, read = null, cursorRestarts = restarts)
    }

    fun summary(): HealthReadResult = HealthReadResult(emptyList(), emptySet(), emptySet(),
        totals.values.sumOf { it.pages }, totals)
}

/** Atomic, fsynced, app-private/no-backup storage; account + environment + mode are bound twice. */
internal class PendingSyncPageStore(directory: File, api: String, user: String, mode: BackgroundSyncMode) {
    private val scope = CanonicalIdentity.sha256("pending-hc-v1|$api|$user|$mode")
    private val directory = directory.apply { check(isDirectory || mkdirs()) }
    private val file = File(directory, "$scope.jsonl.gz")

    fun load(window: SyncWindow): PendingSyncPage? {
        if (!file.exists()) return null
        GZIPInputStream(file.inputStream()).bufferedReader().use { reader ->
            val header = JSONObject(reader.readLine() ?: throw PendingScopeMismatch())
            if (header.getString("scope") != scope || header.getInt("version") != 1 ||
                header.getString("start") != window.start.toString() || header.getString("end") != window.end.toString()) throw PendingScopeMismatch()
            val readMeta = header.optJSONObject("read")
            val records = reader.lineSequence().map { line ->
                val a = JSONArray(line)
                CanonicalHealthRecord(a.getString(0), a.getString(1), a.getString(2), a.getString(3), a.getString(4),
                    a.nullString(5), a.nullString(6), a.getString(7), a.getString(8), a.getDouble(9), a.getString(10), a.nullString(11), a.nullString(12))
            }.toList()
            return PendingSyncPage(window, header.getInt("page"), header.optJSONArray("remaining")?.strings()?.toSet(),
                header.getJSONObject("cursors").stringMap(), header.getJSONObject("totals").traces(),
                readMeta?.let { HealthReadResult(records, it.getJSONArray("failed").strings().toSet(),
                    it.getJSONArray("capped").strings().toSet(), it.getInt("pages"), it.getJSONObject("traces").traces(),
                    it.getJSONObject("starts").stringMap(), it.getJSONObject("next").stringMap()) }, header.getJSONObject("starts").stringMap(),
                header.getJSONObject("restarts").let { m -> m.keys().asSequence().associateWith { m.getInt(it) } })
        }
    }

    fun save(page: PendingSyncPage) {
        val temp = File(directory, "$scope.tmp")
        val header = JSONObject().put("version", 1).put("scope", scope)
            .put("start", page.window.start.toString()).put("end", page.window.end.toString()).put("page", page.page)
            .put("remaining", page.remaining?.let { JSONArray(it.sorted()) } ?: JSONObject.NULL)
            .put("cursors", JSONObject(page.cursors)).put("totals", tracesJson(page.totals))
            .put("starts", JSONObject(page.starts))
            .put("restarts", JSONObject(page.cursorRestarts))
        page.read?.let { r -> header.put("read", JSONObject().put("failed", JSONArray(r.failedDomains.sorted()))
            .put("capped", JSONArray(r.cappedDomains.sorted())).put("pages", r.pagesRead).put("traces", tracesJson(r.domainTraces))
            .put("starts", JSONObject(r.domainRangeStarts)).put("next", JSONObject(r.nextPageTokens))) }
        FileOutputStream(temp).use { stream ->
            val gzip = GZIPOutputStream(stream)
            val writer = gzip.bufferedWriter()
            writer.appendLine(header.toString())
            page.read?.records?.forEach { r ->
                writer.appendLine(JSONArray(listOf(r.domain, r.sourceApp, r.sourceRecordId, r.sourceUpdatedAt,
                    r.recordedAt, r.startedAt, r.endedAt, r.timezone, r.localDate, r.value, r.unit, r.stage, r.uploadSortAt)).toString())
            }
            writer.flush()
            gzip.finish()
            gzip.flush()
            stream.fd.sync()
            gzip.close()
        }
        Files.move(temp.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    }

    fun clear() { Files.deleteIfExists(file.toPath()) }

    private fun tracesJson(traces: Map<String, DomainReadTrace>) = JSONObject().apply {
        traces.forEach { (name, t) -> put(name, JSONObject().put("source", t.sourceCount ?: JSONObject.NULL)
            .put("mapped", t.mappedCount).put("pages", t.pages).put("status", t.status)
            .put("drops", JSONObject(t.dropReasons)).put("recoveries", t.recoveryAttempts)) }
    }
    private fun JSONObject.traces(): Map<String, DomainReadTrace> = keys().asSequence().associateWith { name ->
        val t = getJSONObject(name)
        DomainReadTrace(if (t.isNull("source")) null else t.getInt("source"), t.getInt("mapped"), t.getInt("pages"),
            t.getString("status"), t.getJSONObject("drops").let { d -> d.keys().asSequence().associateWith { d.getInt(it) } }, t.getInt("recoveries"))
    }
    private fun JSONObject.stringMap(): Map<String, String> = keys().asSequence().associateWith { getString(it) }
    private fun JSONArray.strings() = List(length()) { getString(it) }
    private fun JSONArray.nullString(index: Int): String? = if (isNull(index)) null else getString(index)
}
