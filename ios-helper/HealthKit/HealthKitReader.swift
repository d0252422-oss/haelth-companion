import HealthKit

struct AnchoredSamples: @unchecked Sendable {
    let samples: [HKSample]
    let deletedObjectIDs: [UUID]
    let anchor: HKQueryAnchor
}

protocol HealthSampleReading: Sendable {
    var domain: HealthDomain { get }
    var sampleType: HKSampleType { get }
    func read(from start: Date, to end: Date, anchor: HKQueryAnchor?) async throws -> AnchoredSamples
}

struct AnchoredHealthKitReader: HealthSampleReading, @unchecked Sendable {
    let store: HKHealthStore
    let domain: HealthDomain
    let sampleType: HKSampleType

    func read(from start: Date, to end: Date, anchor: HKQueryAnchor?) async throws -> AnchoredSamples {
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKAnchoredObjectQuery(
                type: sampleType,
                predicate: predicate,
                anchor: anchor,
                limit: HKObjectQueryNoLimit
            ) { _, samples, deleted, newAnchor, error in
                if let error { continuation.resume(throwing: error); return }
                guard let newAnchor else {
                    continuation.resume(throwing: HealthKitReadError.missingAnchor)
                    return
                }
                continuation.resume(returning: AnchoredSamples(
                    samples: samples ?? [],
                    deletedObjectIDs: (deleted ?? []).map(\.uuid),
                    anchor: newAnchor
                ))
            }
            store.execute(query)
        }
    }
}

enum HealthKitReadError: Error { case unavailableType, unexpectedSample, missingAnchor }

enum HealthKitReaders {
    static func steps(store: HKHealthStore) throws -> AnchoredHealthKitReader {
        guard let type = HKObjectType.quantityType(forIdentifier: .stepCount) else {
            throw HealthKitReadError.unavailableType
        }
        return AnchoredHealthKitReader(store: store, domain: .steps, sampleType: type)
    }

    static func heartRate(store: HKHealthStore) throws -> AnchoredHealthKitReader {
        guard let type = HKObjectType.quantityType(forIdentifier: .heartRate) else {
            throw HealthKitReadError.unavailableType
        }
        return AnchoredHealthKitReader(store: store, domain: .heartRate, sampleType: type)
    }

    static func sleep(store: HKHealthStore) throws -> AnchoredHealthKitReader {
        guard let type = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else {
            throw HealthKitReadError.unavailableType
        }
        return AnchoredHealthKitReader(store: store, domain: .sleep, sampleType: type)
    }
}
