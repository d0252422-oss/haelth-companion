struct HealthKitObserverCallbackBridge: Sendable {
    private let continuation: AsyncStream<Void>.Continuation

    init(continuation: AsyncStream<Void>.Continuation) {
        self.continuation = continuation
    }

    @discardableResult
    func receive(error: Error?, completion: () -> Void) -> Bool {
        defer { completion() }
        guard error == nil else { return false }
        continuation.yield(())
        return true
    }
}
