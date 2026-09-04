import Foundation

struct IngestionReceipt: Codable, Sendable {
    let acceptedIdempotencyKeys: [String]
    let duplicateIdempotencyKeys: [String]
    let rejected: [RejectedRecord]

    enum CodingKeys: String, CodingKey {
        case acceptedIdempotencyKeys = "accepted_idempotency_keys"
        case duplicateIdempotencyKeys = "duplicate_idempotency_keys"
        case rejected
    }
}

struct RejectedRecord: Codable, Sendable {
    let idempotencyKey: String
    let errorCode: String

    enum CodingKeys: String, CodingKey {
        case idempotencyKey = "idempotency_key"
        case errorCode = "error_code"
    }
}

struct HealthIngestionClient: Sendable {
    let api: APIClient

    func upload(_ records: [HealthRecordMutation], session: AppSession) async throws -> IngestionReceipt {
        guard records.allSatisfy({ $0.canonicalUserID == session.canonicalUserID }) else {
            throw APIError.forbidden
        }
        return try await api.send(
            path: "/v1/health/ingestion/batches",
            body: IngestionBatch(
                schemaVersion: "hdl-v2.health-ingestion.v1",
                canonicalUserID: session.canonicalUserID,
                mutations: records
            ),
            bearerToken: session.accessToken,
            headers: ["X-App-Session-ID": session.sessionID.uuidString.lowercased()]
        )
    }
}
