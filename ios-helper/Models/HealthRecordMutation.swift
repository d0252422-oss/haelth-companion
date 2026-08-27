import CryptoKit
import Foundation

enum HealthMutationOperation: String, Codable, Sendable {
    case upsert = "UPSERT"
    case delete = "DELETE"
}

struct HealthRecordMutation: Codable, Equatable, Identifiable, Sendable {
    let canonicalUserID: UUID
    let platform: String
    let domain: HealthDomain
    let sourceApp: String
    let sourceRecordID: String
    let sourceRevision: Int
    let sourceUpdatedAt: Date?
    let sourceContentHash: String
    let operation: HealthMutationOperation
    let affectedLocalDates: [String]
    let idempotencyKey: String
    let record: CanonicalHealthRecord?

    var id: String { idempotencyKey }

    enum CodingKeys: String, CodingKey {
        case canonicalUserID = "canonical_user_id"
        case platform, domain
        case sourceApp = "source_app"
        case sourceRecordID = "source_record_id"
        case sourceRevision = "source_revision"
        case sourceUpdatedAt = "source_updated_at"
        case sourceContentHash = "source_content_hash"
        case operation
        case affectedLocalDates = "affected_local_dates"
        case idempotencyKey = "idempotency_key"
        case record
    }

    static func mutationKey(
        canonicalUserID: UUID,
        domain: HealthDomain,
        sourceApp: String,
        sourceRecordID: String,
        sourceRevision: Int,
        sourceContentHash: String,
        operation: HealthMutationOperation
    ) -> String {
        let tuple = [canonicalUserID.uuidString.lowercased(), "ios", domain.rawValue, sourceApp,
                     sourceRecordID, String(sourceRevision), sourceContentHash, operation.rawValue]
            .joined(separator: "\u{001F}")
        return SHA256.hash(data: Data(tuple.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

