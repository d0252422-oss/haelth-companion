import Foundation

actor PendingUploadStore {
    private let fileURL: URL
    private var records: [HealthRecordMutation] = []

    init(filename: String = "pending-health-upload-v1.json") {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        self.fileURL = directory.appendingPathComponent(filename)
    }

    func load() throws {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { records = []; return }
        records = try JSONDecoder.canonical.decode([HealthRecordMutation].self, from: Data(contentsOf: fileURL))
    }

    func enqueue(_ newRecords: [HealthRecordMutation]) throws {
        var byKey = Dictionary(uniqueKeysWithValues: records.map { ($0.idempotencyKey, $0) })
        for record in newRecords { byKey[record.idempotencyKey] = record }
        records = byKey.values.sorted { lhs, rhs in
            if lhs.sourceRecordID == rhs.sourceRecordID { return lhs.sourceRevision < rhs.sourceRevision }
            return lhs.sourceRecordID < rhs.sourceRecordID
        }
        try persist()
    }

    func batch(limit: Int = 250) -> [HealthRecordMutation] { Array(records.prefix(limit)) }

    func acknowledge(idempotencyKeys: Set<String>) throws {
        records.removeAll { idempotencyKeys.contains($0.idempotencyKey) }
        try persist()
    }

    func count() -> Int { records.count }

    private func persist() throws {
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONEncoder.canonical.encode(records)
        try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutableURL = fileURL
        try mutableURL.setResourceValues(values)
    }
}
