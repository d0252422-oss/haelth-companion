import XCTest
@testable import HealthSyncHelper

@MainActor
final class BackgroundSyncConcurrencyTests: XCTestCase {
    func testBackgroundSyncSuccessCompletesExactlyOnce() async {
        var completions: [Bool] = []
        let lifecycle = BackgroundTaskLifecycle { completions.append($0) }

        let result = await lifecycle.run { true }
        lifecycle.requestExpiration()
        let repeatedResult = await lifecycle.run { false }
        let snapshot = lifecycle.snapshot()

        XCTAssertTrue(result)
        XCTAssertFalse(repeatedResult)
        XCTAssertEqual(
            snapshot,
            BackgroundTaskLifecycleSnapshot(
                completed: true,
                completionResult: true,
                completionInvocationCount: 1,
                expired: false
            )
        )
        XCTAssertEqual(completions, [true])
    }

    func testBackgroundSyncFailureCompletesExactlyOnce() async {
        var completions: [Bool] = []
        let lifecycle = BackgroundTaskLifecycle { completions.append($0) }

        let result = await lifecycle.run { false }
        let snapshot = lifecycle.snapshot()

        XCTAssertFalse(result)
        XCTAssertEqual(snapshot.completionResult, false)
        XCTAssertEqual(snapshot.completionInvocationCount, 1)
        XCTAssertEqual(completions, [false])
    }

    func testExpirationCancelsOperationAndCompletesOnce() async {
        let cancellation = CancellationObservation()
        var completions: [Bool] = []
        let lifecycle = BackgroundTaskLifecycle { completions.append($0) }
        let running = Task {
            await lifecycle.run {
                await cancellation.markStarted()
                while !Task.isCancelled { await Task.yield() }
                await cancellation.observe()
                return true
            }
        }

        await cancellation.waitUntilStarted()
        lifecycle.requestExpiration()
        let result = await running.value
        let cancellationObserved = await cancellation.wasObserved()
        let snapshot = lifecycle.snapshot()

        XCTAssertFalse(result)
        XCTAssertTrue(cancellationObserved)
        XCTAssertEqual(snapshot.completionInvocationCount, 1)
        XCTAssertEqual(snapshot.completionResult, false)
        XCTAssertEqual(completions, [false])
    }

    func testCancellationBeforeStartFailsClosed() async {
        var completions: [Bool] = []
        let lifecycle = BackgroundTaskLifecycle { completions.append($0) }

        lifecycle.cancel()
        let result = await lifecycle.run { true }
        let snapshot = lifecycle.snapshot()

        XCTAssertFalse(result)
        XCTAssertEqual(snapshot.completionInvocationCount, 1)
        XCTAssertEqual(snapshot.completionResult, false)
        XCTAssertEqual(completions, [false])
    }

    func testHealthKitCallbackSuccessCompletesOnce() async {
        let (events, continuation) = AsyncStream.makeStream(of: Void.self)
        let bridge = HealthKitObserverCallbackBridge(continuation: continuation)
        var completionCount = 0

        let enqueued = bridge.receive(error: nil) { completionCount += 1 }
        var iterator = events.makeAsyncIterator()
        let event: Void? = await iterator.next()

        XCTAssertTrue(enqueued)
        XCTAssertNotNil(event)
        XCTAssertEqual(completionCount, 1)
    }

    func testHealthKitCallbackFailureStillCompletesOnce() async {
        let (_, continuation) = AsyncStream.makeStream(of: Void.self)
        let bridge = HealthKitObserverCallbackBridge(continuation: continuation)
        var completionCount = 0

        let enqueued = bridge.receive(error: CallbackTestError.expected) {
            completionCount += 1
        }

        XCTAssertFalse(enqueued)
        XCTAssertEqual(completionCount, 1)
    }

    func testHealthKitCallbackCannotCompleteTwice() async {
        let (_, continuation) = AsyncStream.makeStream(of: Void.self)
        let bridge = HealthKitObserverCallbackBridge(continuation: continuation)
        var completionCount = 0

        _ = bridge.receive(error: nil) { completionCount += 1 }

        XCTAssertEqual(completionCount, 1)
    }
}

private actor CancellationObservation {
    private var started = false
    private var observed = false
    private var startWaiters: [CheckedContinuation<Void, Never>] = []

    func markStarted() {
        started = true
        let waiters = startWaiters
        startWaiters.removeAll()
        for waiter in waiters { waiter.resume() }
    }

    func waitUntilStarted() async {
        if started { return }
        await withCheckedContinuation { continuation in
            startWaiters.append(continuation)
        }
    }

    func observe() { observed = true }
    func wasObserved() -> Bool { observed }
}

private enum CallbackTestError: Error {
    case expected
}
