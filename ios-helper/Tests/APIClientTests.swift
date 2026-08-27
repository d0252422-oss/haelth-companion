import XCTest
@testable import HealthSyncHelper

final class APIClientTests: XCTestCase {
    struct Request: Codable { let value: Int }
    struct Response: Codable, Equatable { let ok: Bool }

    override func setUp() {
        URLProtocolStub.handler = nil
    }

    func testDecodesSuccessAndClassifiesUnauthorized() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        let session = URLSession(configuration: configuration)
        let client = APIClient(baseURL: URL(string: "https://api.example.com")!, session: session)

        URLProtocolStub.handler = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer local-test-token")
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(#"{"ok":true}"#.utf8))
        }
        let response: Response = try await client.send(path: "/test", body: Request(value: 1), bearerToken: "local-test-token")
        XCTAssertEqual(response, Response(ok: true))

        URLProtocolStub.handler = { request in
            (HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!, Data())
        }
        do {
            let _: Response = try await client.send(path: "/test", body: Request(value: 1))
            XCTFail("Expected unauthorized")
        } catch {
            XCTAssertEqual(error as? APIError, .unauthorized)
        }
    }
}

final class URLProtocolStub: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (response, data) = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
