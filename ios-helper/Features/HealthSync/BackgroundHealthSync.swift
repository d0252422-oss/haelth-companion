import BackgroundTasks
import Dispatch
import HealthKit

@MainActor
final class BackgroundHealthSync {
    static let taskIdentifier = "tw.lifehelper.healthsync.refresh"
    private let store: HKHealthStore
    private let coordinator: HealthSyncCoordinator
    private var observerQueries: [HKObserverQuery] = []
    private var observerTasks: [Task<Void, Never>] = []
    private var observersEnabled = false
    private let retryPolicy = RetryPolicy()
    private let defaults = UserDefaults.standard

    init(store: HKHealthStore, coordinator: HealthSyncCoordinator) {
        self.store = store
        self.coordinator = coordinator
    }

    func register() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.taskIdentifier,
            using: DispatchQueue.main
        ) { [weak self] task in
            MainActor.assumeIsolated {
                guard let self, let processing = task as? BGProcessingTask else {
                    task.setTaskCompleted(success: false)
                    return
                }
                self.start(processingTask: processing)
            }
        }
    }

    private func start(processingTask: BGProcessingTask) {
        let lifecycle = BackgroundTaskLifecycle { success in
            processingTask.setTaskCompleted(success: success)
        }
        processingTask.expirationHandler = { [weak lifecycle] in
            Task { @MainActor in
                lifecycle?.requestExpiration()
            }
        }
        Task { @MainActor [weak self] in
            guard let self else {
                lifecycle.cancel()
                return
            }
            await self.run(lifecycle: lifecycle)
        }
    }

    private func run(lifecycle: BackgroundTaskLifecycle) async {
        let coordinator = self.coordinator
        let success = await lifecycle.run {
            do {
                try Task.checkCancellation()
                try await coordinator.synchronize()
                try Task.checkCancellation()
                return true
            } catch {
                return false
            }
        }

        if success {
            saveRetryState(retryPolicy.success())
        } else {
            saveRetryState(retryPolicy.failure(
                from: retryState(),
                at: Date(),
                code: "BACKGROUND_SYNC_FAILED"
            ))
        }
        schedule(after: retryState().nextAttemptAt)
    }

    func enableObservers() {
        guard !observersEnabled else { return }
        observersEnabled = true
        let coordinator = self.coordinator
        for type in HealthKitAuthorization.readTypes.compactMap({ $0 as? HKSampleType }) {
            let (events, continuation) = AsyncStream.makeStream(
                of: Void.self,
                bufferingPolicy: .bufferingNewest(1)
            )
            let bridge = HealthKitObserverCallbackBridge(continuation: continuation)
            observerTasks.append(Task {
                for await _ in events {
                    try? await coordinator.synchronize()
                }
            })
            let query = HKObserverQuery(sampleType: type, predicate: nil) { _, completion, error in
                bridge.receive(error: error, completion: completion)
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
