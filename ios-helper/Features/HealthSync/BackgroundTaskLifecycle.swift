import BackgroundTasks

protocol BackgroundTaskCompleting: AnyObject {
    var expirationHandler: (() -> Void)? { get set }
    func setTaskCompleted(success: Bool)
}

extension BGProcessingTask: BackgroundTaskCompleting {}

struct BackgroundTaskLifecycleSnapshot: Equatable, Sendable {
    let completed: Bool
    let completionResult: Bool?
    let completionInvocationCount: Int
    let expired: Bool
}

actor BackgroundTaskLifecycle {
    private var task: (any BackgroundTaskCompleting)?
    private var operation: Task<Bool, Never>?
    private var didComplete = false
    private var didExpire = false
    private var completionResult: Bool?
    private var completionInvocationCount = 0

    init(task: sending any BackgroundTaskCompleting) {
        self.task = task
    }

    func run(
        operation: sending @escaping @Sendable () async -> Bool
    ) async -> Bool {
        guard !didComplete, operation == nil, let task else { return false }

        task.expirationHandler = { [weak self] in
            self?.requestExpiration()
        }

        let work = Task { await operation() }
        self.operation = work
        if didExpire { work.cancel() }

        let operationSucceeded = await work.value
        self.operation = nil
        let success = operationSucceeded && !didExpire && !work.isCancelled
        complete(success: success)
        return success
    }

    nonisolated func requestExpiration() {
        Task { await expire() }
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

        let ownedTask = task
        task = nil
        ownedTask?.expirationHandler = nil
        ownedTask?.setTaskCompleted(success: success)
    }
}
