struct BackgroundTaskLifecycleSnapshot: Equatable, Sendable {
    let completed: Bool
    let completionResult: Bool?
    let completionInvocationCount: Int
    let expired: Bool
}

@MainActor
final class BackgroundTaskLifecycle {
    private var completion: (@MainActor (Bool) -> Void)?
    private var operation: Task<Bool, Never>?
    private var didComplete = false
    private var didExpire = false
    private var completionResult: Bool?
    private var completionInvocationCount = 0

    init(completion: @escaping @MainActor (Bool) -> Void) {
        self.completion = completion
    }

    func run(
        operation: sending @escaping @Sendable () async -> Bool
    ) async -> Bool {
        guard !didComplete, operation == nil else { return false }

        let work = Task { await operation() }
        self.operation = work
        if didExpire { work.cancel() }

        let operationSucceeded = await work.value
        self.operation = nil
        let success = operationSucceeded && !didExpire && !work.isCancelled
        complete(success: success)
        return success
    }

    func requestExpiration() {
        expire()
    }

    func cancel() {
        expire()
    }

    func snapshot() -> BackgroundTaskLifecycleSnapshot {
        BackgroundTaskLifecycleSnapshot(
            completed: didComplete,
            completionResult: completionResult,
            completionInvocationCount: completionInvocationCount,
            expired: didExpire
        )
    }

    private func expire() {
        guard !didComplete else { return }
        didExpire = true
        operation?.cancel()
        complete(success: false)
    }

    private func complete(success: Bool) {
        guard !didComplete else { return }
        didComplete = true
        completionResult = success
        completionInvocationCount += 1

        let ownedCompletion = completion
        completion = nil
        ownedCompletion?(success)
    }
}
