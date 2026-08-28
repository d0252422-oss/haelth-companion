import XCTest
@testable import HealthSyncHelper

final class BackgroundSyncConcurrencyTests: XCTestCase {
    func testBackgroundSyncSuccessCompletesExactlyOnce() async {
        let lifecycle = BackgroundTaskLifecycle(task: FakeBackgroundTask())

        let result = await lifecycle.run { true }
        lifecycle.requestExpiration()
        await Task.yield()
        let repeatedResult = await lifecycle.run { false }
        let snapshot = await lifecycle.snapshot()

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
    }

    func testBackgroundSyncFailureCompletesExactlyOnce() async {
        let lifecycle = BackgroundTaskLifecycle(task: FakeBackgroundTask())

        let result = await lifecycle.run { false }
        let snapshot = await lifecycle.snapshot()

        XCTAssertFalse(result)
        XCTAssertEqual(snapshot.completionResult, false)
        XCTAssertEqual(snapshot.completionInvocationCount, 1)
    }

    func testExpirationCancelsOperationAndCompletesOnce() async {
        let cancellation = CancellationObservation()
        let lifecycle = BackgroundTaskLifecycle(task: FakeBackgroundTask())
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
        let snapshot = await lifecycle.snapshot()

        XCTAssertFalse(result)
        XCTAssertTrue(cancellationObserved)
        XCTAssertEqual(snapshot.completionInvocationCount, 1)
        XCTAssertEqual(snapshot.completionResult, false)
    }

    func testCancellationBeforeStartFailsClosed() async {
        let lifecycle = BackgroundTaskLifecycle(task: FakeBackgroundTask())

        await lifecycle.cancel()
        let result = await lifecycle.run { true }
        let snapshot = await lifecycle.snapshot()

        XCTAssertFalse(result)
        XCTAssertEqual(snapshot.completionInvocationCount, 1)
        XCTAssertEqual(snapshot.completionResult, false)
    }

    func testHealthKitCallbackSuccessCompletesOnce() async {
        let completion = HealthKitObserverCompletion({})

        await HealthKitObserverCallbackBridge.run(completion: completion) {}
        let invocationCount = await completion.completedInvocationCount()

        XCTAssertEqual(invocationCount, 1)
    }

    func testHealthKitCallbackFailureStillCompletesOnce() async {
        let completion = HealthKitObserverCompletion({})

        await HealthKitObserverCallbackBridge.run(completion: completion) {
            throw CallbackTestError.expected
        }
        let invocationCount = await completion.completedInvocationCount()

        XCTAssertEqual(invocationCount, 1)
    }

    func testHealthKitCallbackCannotCompleteTwice() async {
        let completion = HealthKitObserverCompletion({})

        await completion.finish()
        await completion.finish()
        let invocationCount = await completion.completedInvocationCount()

        XCTAssertEqual(invocationCount, 1)
    }
}

private final class FakeBackgroundTask: BackgroundTaskCompleting {
    var expirationHandler: (() -> Void)?
    func setTaskCompleted(success _: Bool) {}
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
