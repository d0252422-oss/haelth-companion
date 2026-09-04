import XCTest
@testable import HealthSyncHelper

final class IdempotencyKeyTests: XCTestCase {
    func testDuplicateRecordHasStableKeyAndUpdateChangesKey() throws {
        let userID = try XCTUnwrap(UUID(uuidString: "11111111-1111-4111-8111-111111111111"))
        let date = try XCTUnwrap(ISO8601DateFormatter.canonical.date(from: "2026-08-27T01:00:00.000Z"))
        func key(_ value: Double) -> String {
            IdempotencyKey.make(canonicalUserID: userID, domain: .heartRate, sourceApp: "com.apple.health",
                sourceRecordID: "record-1", startedAt: date, endedAt: date, recordedAt: date,
                value: value, unit: "bpm", stage: nil)
        }
        XCTAssertEqual(key(67), key(67))
        XCTAssertNotEqual(key(67), key(68))
    }
}

