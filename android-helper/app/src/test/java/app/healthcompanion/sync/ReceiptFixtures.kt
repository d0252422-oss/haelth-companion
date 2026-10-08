package app.healthcompanion.sync

import org.json.JSONObject

internal fun successfulReceipt(body: String, status: Int = 200): IngestionHttpResult {
    if (status !in 200..299 || status == 207) return IngestionHttpResult(status)
    val mutations = JSONObject(body).optJSONArray("mutations") ?: return IngestionHttpResult(status)
    val keys = List(mutations.length()) { mutations.getJSONObject(it).getString("idempotency_key") }
    return IngestionHttpResult(status, receipt = IngestionReceipt(keys, emptyList(), 0))
}
