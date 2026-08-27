import BackgroundTasks
import HealthKit

final class BackgroundHealthSync: @unchecked Sendable {
    static let taskIdentifier = "tw.lifehelper.healthsync.refresh"
    private let store: HKHealthStore
    private let coordinator: HealthSyncCoordinator
    private var observerQueries: [HKObserverQuery] = []
    private var observersEnabled = false
    private let retryPolicy = RetryPolicy()
    private let defaults = UserDefaults.standard

    init(store: HKHealthStore, coordinator: HealthSyncCoordinator) {
        self.store = store
        self.coordinator = coordinator
    }

    func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.taskIdentifier, using: nil) { [weak self] task in
            guard let self, let processing = task as? BGProcessingTask else { task.setTaskCompleted(success: false); return }
            let work = Task {
                do {
                    try await self.coordinator.synchronize()
                    self.saveRetryState(self.retryPolicy.success())
                    processing.setTaskCompleted(success: true)
                } catch {
                    self.saveRetryState(self.retryPolicy.failure(from: self.retryState(), at: Date(), code: "BACKGROUND_SYNC_FAILED"))
                    processing.setTaskCompleted(success: false)
                }
                self.schedule(after: self.retryState().nextAttemptAt)
            }
            processing.expirationHandler = { work.cancel() }
        }
    }

    func enableObservers() {
        guard !observersEnabled else { return }
        observersEnabled = true
        for type in HealthKitAuthorization.readTypes.compactMap({ $0 as? HKSampleType }) {
            let query = HKObserverQuery(sampleType: type, predicate: nil) { [weak self] _, completion, error in
                guard error == nil, let self else { completion(); return }
                Task {
                    defer { completion() }
                    try? await self.coordinator.synchronize()
                }
            }
            store.execute(query)
            store.enableBackgroundDelivery(for: type, frequency: .hourly) { _, _ in }
            observerQueries.append(query)
        }
        schedule(after: nil)
    }

    func schedule(after nextAttemptAt: Date?) {
        let request = BGProcessingTaskRequest(identifier: Self.taskIdentifier)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        request.earliestBeginDate = nextAttemptAt ?? Date(timeIntervalSinceNow: 60 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    private func retryState() -> RetryState {
        guard let data = defaults.data(forKey: "health.background.retry"),
              let state = try? JSONDecoder.canonical.decode(RetryState.self, from: data) else { return RetryState() }
        return state
    }

    private func saveRetryState(_ state: RetryState) {
        defaults.set(try? JSONEncoder.canonical.encode(state), forKey: "health.background.retry")
    }
}
