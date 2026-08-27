import Foundation

enum HealthDomain: String, Codable, CaseIterable, Sendable {
    case steps
    case heartRate = "heart_rate"
    case sleep
}

struct SourceDeviceMetadata: Codable, Equatable, Sendable {
    let manufacturer: String?
    let model: String?
    let hardwareVersion: String?
    let softwareVersion: String?
}

struct CanonicalHealthRecord: Codable, Equatable, Identifiable, Sendable {
    let canonicalUserID: UUID
    let platform: String
    let domain: HealthDomain
    let sourceApp: String
    let sourceRecordID: String?
    let sourceUpdatedAt: Date?
    let recordedAt: Date
    let startedAt: Date?
    let endedAt: Date?
    let timezone: String
    let localDate: String
    let value: Double
    let unit: String
    let stage: String?
    let sourceDevice: SourceDeviceMetadata?
    let schemaVersion: String
    let idempotencyKey: String

    var id: String { idempotencyKey }

    enum CodingKeys: String, CodingKey {
        case canonicalUserID = "canonical_user_id"
        case platform, domain
        case sourceApp = "source_app"
        case sourceRecordID = "source_record_id"
        case sourceUpdatedAt = "source_updated_at"
        case recordedAt = "recorded_at"
        case startedAt = "started_at"
        case endedAt = "ended_at"
        case timezone
        case localDate = "local_date"
        case value, unit, stage
        case sourceDevice = "source_device"
        case schemaVersion = "schema_version"
        case idempotencyKey = "idempotency_key"
    }
}

struct IngestionBatch: Codable, Sendable {
    let schemaVersion: String
    let canonicalUserID: UUID
    let mutations: [HealthRecordMutation]

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case canonicalUserID = "canonical_user_id"
        case mutations
    }
}

