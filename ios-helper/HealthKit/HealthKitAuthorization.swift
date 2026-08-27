import HealthKit

enum HealthAuthorizationOutcome: Equatable {
    case requestProcessed
    case healthDataUnavailable
}

struct HealthKitAuthorization {
    let store: HKHealthStore

    static var readTypes: Set<HKObjectType> {
        let identifiers: [HKQuantityTypeIdentifier] = [.stepCount, .heartRate]
        var types = Set<HKObjectType>(identifiers.compactMap(HKObjectType.quantityType(forIdentifier:)))
        if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { types.insert(sleep) }
        return types
    }

    func request() async throws -> HealthAuthorizationOutcome {
        guard HKHealthStore.isHealthDataAvailable() else { return .healthDataUnavailable }
        try await store.requestAuthorization(toShare: [], read: Self.readTypes)
        // Apple intentionally does not disclose per-type read denial. A successful
        // request means the permission sheet completed, not that every read was granted.
        return .requestProcessed
    }
}
