actor HealthKitObserverCompletion {
    private var completion: (() -> Void)?
    private var invocationCount = 0

    init(_ completion: sending @escaping () -> Void) {
        self.completion = completion
    }

    func finish() {
        guard let completion else { return }
        self.completion = nil
        invocationCount += 1
        completion()
    }

    func completedInvocationCount() -> Int {
        invocationCount
    }
}

enum HealthKitObserverCallbackBridge {
    static func start(
        completion: HealthKitObserverCompletion,
        operation: sending @escaping @Sendable () async throws -> Void
    ) {
        Task {
            await run(completion: completion, operation: operation)
        }
    }

    static func run(
        completion: HealthKitObserverCompletion,
        operation: sending @escaping @Sendable () async throws -> Void
    ) async {
        do {
            try await operation()
        } catch {
            // HealthKit must be notified even when synchronization fails. The
            // coordinator retains the pending queue for its normal retry path.
        }
        await completion.finish()
    }
}
