import CryptoKit
import Foundation

actor SourceRecordVersionStore {
    private struct Entry: Codable {
        let domain: HealthDomain
        let sourceApp: String
        var currentRevision: Int
        var currentContentHash: String
        var revisionByContentHash: [String: Int]
        var isDeleted: Bool
        var affectedLocalDates: [String]
    }

    private let fileURL: URL
    private var entries: [String: Entry] = [:]
    private var loaded = false

    init(filename: String = "health-source-versions-v1.json") {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        fileURL = directory.appendingPathComponent(filename)
    }

    func upsert(_ record: CanonicalHealthRecord) throws -> HealthRecordMutation {
        try loadIfNeeded()
        guard let sourceRecordID = record.sourceRecordID else { throw HealthKitReadError.unexpectedSample }
        let key = identityKey(domain: record.domain, sourceRecordID: sourceRecordID)
        let contentHash = record.idempotencyKey
        var entry = entries[key] ?? Entry(
            domain: record.domain, sourceApp: record.sourceApp, currentRevision: 0,
            currentContentHash: "", revisionByContentHash: [:], isDeleted: false,
            affectedLocalDates: []
        )
        let revision: Int
        if let knownRevision = entry.revisionByContentHash[contentHash] {
            revision = knownRevision
        } else {
            revision = entry.currentRevision + 1
            entry.currentRevision = revision
            entry.currentContentHash = contentHash
            entry.revisionByContentHash[contentHash] = revision
            entry.isDeleted = false
            entry.affectedLocalDates = Array(Set(entry.affectedLocalDates + [record.localDate])).sorted()
            entries[key] = entry
            try persist()
        }
        return mutation(
            userID: record.canonicalUserID, entry: entry, sourceRecordID: sourceRecordID,
            revision: revision, contentHash: contentHash, operation: .upsert, record: record
        )
    }

    func tombstone(sourceRecordID: UUID, domain: HealthDomain, canonicalUserID: UUID) throws -> HealthRecordMutation? {
        try loadIfNeeded()
        let sourceID = sourceRecordID.uuidString.lowercased()
        let key = identityKey(domain: domain, sourceRecordID: sourceID)
        guard var entry = entries[key] else { return nil }
        let revision: Int
        let contentHash: String
        if entry.isDeleted {
            revision = entry.currentRevision
            contentHash = entry.currentContentHash
        } else {
            revision = entry.currentRevision + 1
            contentHash = SHA256.hash(data: Data("DELETE\u{001F}\(sourceID)\u{001F}\(revision)".utf8))
                .map { String(format: "%02x", $0) }.joined()
            entry.currentRevision = revision
            entry.currentContentHash = contentHash
            entry.revisionByContentHash[contentHash] = revision
            entry.isDeleted = true
            entries[key] = entry
            try persist()
        }
        return mutation(
            userID: canonicalUserID, entry: entry, sourceRecordID: sourceID,
            revision: revision, contentHash: contentHash, operation: .delete, record: nil
        )
    }

    private func mutation(
        userID: UUID,
        entry: Entry,
        sourceRecordID: String,
        revision: Int,
        contentHash: String,
        operation: HealthMutationOperation,
        record: CanonicalHealthRecord?
    ) -> HealthRecordMutation {
        HealthRecordMutation(
            canonicalUserID: userID, platform: "ios", domain: entry.domain,
            sourceApp: entry.sourceApp, sourceRecordID: sourceRecordID,
            sourceRevision: revision, sourceUpdatedAt: record?.sourceUpdatedAt,
            sourceContentHash: contentHash, operation: operation,
            affectedLocalDates: entry.affectedLocalDates,
            idempotencyKey: HealthRecordMutation.mutationKey(
                canonicalUserID: userID, domain: entry.domain, sourceApp: entry.sourceApp,
                sourceRecordID: sourceRecordID, sourceRevision: revision,
                sourceContentHash: contentHash, operation: operation
            ),
            record: record
        )
    }

    private func identityKey(domain: HealthDomain, sourceRecordID: String) -> String {
        "\(domain.rawValue)\u{001F}\(sourceRecordID.lowercased())"
    }

    private func loadIfNeeded() throws {
        guard !loaded else { return }
        defer { loaded = true }
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
        entries = try JSONDecoder.canonical.decode([String: Entry].self, from: Data(contentsOf: fileURL))
    }

    private func persist() throws {
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder.canonical.encode(entries).write(
            to: fileURL,
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
        )
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutableURL = fileURL
        try mutableURL.setResourceValues(values)
    }
}

