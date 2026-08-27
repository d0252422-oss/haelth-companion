import HealthKit
import XCTest
@testable import HealthSyncHelper

final class HealthKitMapperTests: XCTestCase {
    private let userID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
    private let start = Date(timeIntervalSince1970: 1_777_777_700)

    func testStepsMapping() throws {
        let type = try XCTUnwrap(HKQuantityType.quantityType(forIdentifier: .stepCount))
        let sample = HKQuantitySample(type: type, quantity: HKQuantity(unit: .count(), doubleValue: 321), start: start, end: start.addingTimeInterval(60))
        let record = try HealthKitMapper(calendar: taipeiCalendar()).map(sample, domain: .steps, canonicalUserID: userID)
        XCTAssertEqual(record.domain, .steps)
        XCTAssertEqual(record.value, 321)
        XCTAssertEqual(record.unit, "count")
        XCTAssertEqual(record.platform, "ios")
    }

    func testHeartRateMapping() throws {
        let type = try XCTUnwrap(HKQuantityType.quantityType(forIdentifier: .heartRate))
        let unit = HKUnit.count().unitDivided(by: .minute())
        let sample = HKQuantitySample(type: type, quantity: HKQuantity(unit: unit, doubleValue: 67), start: start, end: start)
        let record = try HealthKitMapper(calendar: taipeiCalendar()).map(sample, domain: .heartRate, canonicalUserID: userID)
        XCTAssertEqual(record.value, 67, accuracy: 0.0001)
        XCTAssertEqual(record.unit, "bpm")
    }

    func testSleepStageUsesWakeDateAttribution() throws {
        let type = try XCTUnwrap(HKCategoryType.categoryType(forIdentifier: .sleepAnalysis))
        let end = start.addingTimeInterval(45 * 60)
        let sample = HKCategorySample(type: type, value: HKCategoryValueSleepAnalysis.asleepDeep.rawValue, start: start, end: end)
        let record = try HealthKitMapper(calendar: taipeiCalendar()).map(sample, domain: .sleep, canonicalUserID: userID)
        XCTAssertEqual(record.stage, "asleep_deep")
        XCTAssertEqual(record.value, 45, accuracy: 0.0001)
        XCTAssertEqual(record.localDate, taipeiDate(end))
    }

    private func taipeiCalendar() -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Taipei")!
        return calendar
    }

    private func taipeiDate(_ date: Date) -> String {
        let parts = taipeiCalendar().dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!)
    }
}

