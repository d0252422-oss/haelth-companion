import XCTest
@testable import HealthSyncHelper

final class InstallClaimHandlerTests: XCTestCase {
    func testFragmentClaimAcceptedAndQueryClaimRejected() throws {
        let handler = InstallClaimHandler(expectedHost: "sync.example.com")
        let value = String(repeating: "a", count: 43)
        XCTAssertEqual(try handler.parse(try XCTUnwrap(URL(string: "https://sync.example.com/health-sync/bootstrap#claim=\(value)"))).opaqueValue, value)
        XCTAssertThrowsError(try handler.parse(try XCTUnwrap(URL(string: "https://sync.example.com/health-sync/bootstrap?claim=\(value)"))))
    }
}

