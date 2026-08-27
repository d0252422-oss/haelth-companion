import Foundation

struct RetryState: Codable, Equatable, Sendable {
    var attempt: Int = 0
    var nextAttemptAt: Date?
    var lastErrorCode: String?
}

struct RetryPolicy: Sendable {
    let baseDelay: TimeInterval
    let maximumDelay: TimeInterval

    init(baseDelay: TimeInterval = 30, maximumDelay: TimeInterval = 21_600) {
        self.baseDelay = baseDelay
        self.maximumDelay = maximumDelay
    }

    func failure(from state: RetryState, at now: Date, code: String) -> RetryState {
        let attempt = state.attempt + 1
        let delay = min(maximumDelay, baseDelay * pow(2, Double(max(0, attempt - 1))))
        return RetryState(attempt: attempt, nextAttemptAt: now.addingTimeInterval(delay), lastErrorCode: code)
    }

    func success() -> RetryState { RetryState() }
}

