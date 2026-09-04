import Foundation
import HealthKit

enum HealthSyncError: Error { case sessionMissing, rejectedRecords(Int) }

actor HealthSyncCoordinator {
    private let readers: [any HealthSampleReading]
    private let mapper: HealthKitMapper
    private let checkpointStore: SyncCheckpointStoring
    private let pendingStore: PendingUploadStore
    private let sourceVersionStore: SourceRecordVersionStore
    private let ingestionClient: HealthIngestionClient
    private let sessionManager: SessionManager

    init(
        readers: [any HealthSampleReading],
        mapper: HealthKitMapper,
        checkpointStore: SyncCheckpointStoring,
        pendingStore: PendingUploadStore,
        sourceVersionStore: SourceRecordVersionStore,
        ingestionClient: HealthIngestionClient,
        sessionManager: SessionManager
    ) {
        self.readers = readers
        self.mapper = mapper
        self.checkpointStore = checkpointStore
        self.pendingStore = pendingStore
        self.sourceVersionStore = sourceVersionStore
        self.ingestionClient = ingestionClient
        self.sessionManager = sessionManager
    }

    func synchronize(now: Date = Date(), historicalDays: Int = 30) async throws {
        guard let session = try await sessionManager.currentSession() else { throw HealthSyncError.sessionMissing }
        try await pendingStore.load()
        let start = Calendar.autoupdatingCurrent.date(byAdding: .day, value: -historicalDays, to: now) ?? now

        for reader in readers {
            let oldAnchor = try checkpointStore.loadAnchor(for: reader.domain)
            let result = try await reader.read(from: start, to: now, anchor: oldAnchor)
            let mapped = try result.samples.map { try mapper.map($0, domain: reader.domain, canonicalUserID: session.canonicalUserID) }
            var mutations: [HealthRecordMutation] = []
            for record in mapped { mutations.append(try await sourceVersionStore.upsert(record)) }
            for deletedID in result.deletedObjectIDs {
                if let tombstone = try await sourceVersionStore.tombstone(
                    sourceRecordID: deletedID,
                    domain: reader.domain,
                    canonicalUserID: session.canonicalUserID
                ) { mutations.append(tombstone) }
            }
            try await pendingStore.enqueue(mutations)
            try await flush(session: session)
            // Advance only after the upload queue accepted or deduplicated all records.
            try checkpointStore.saveAnchor(result.anchor, for: reader.domain)
        }
        checkpointStore.markSuccessfulSync(at: now)
    }

    func flush(session: AppSession) async throws {
        while true {
            let batch = await pendingStore.batch()
            if batch.isEmpty { return }
            let receipt = try await ingestionClient.upload(batch, session: session)
            if !receipt.rejected.isEmpty { throw HealthSyncError.rejectedRecords(receipt.rejected.count) }
            let completed = Set(receipt.acceptedIdempotencyKeys + receipt.duplicateIdempotencyKeys)
            guard completed.count == batch.count else { throw APIError.malformedResponse }
            try await pendingStore.acknowledge(idempotencyKeys: completed)
        }
    }
}
