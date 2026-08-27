import XCTest
@testable import HealthSyncHelper

final class RetryPolicyTests: XCTestCase {
    func testBackoffCapsAndSuccessResets() {
        let policy = RetryPolicy(baseDelay: 10, maximumDelay: 40)
        let now = Date(timeIntervalSince1970: 1_000)
        let first = policy.failure(from: RetryState(), at: now, code: "OFFLINE")
        let second = policy.failure(from: first, at: now, code: "OFFLINE")
        let fourth = policy.failure(from: policy.failure(from: second, at: now, code: "OFFLINE"), at: now, code: "OFFLINE")
        XCTAssertEqual(first.nextAttemptAt, now.addingTimeInterval(10))
        XCTAssertEqual(second.nextAttemptAt, now.addingTimeInterval(20))
        XCTAssertEqual(fourth.nextAttemptAt, now.addingTimeInterval(40))
        XCTAssertEqual(policy.success(), RetryState())
    }
}

