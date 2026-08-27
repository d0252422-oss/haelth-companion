import Foundation

enum APIError: Error, Equatable {
    case invalidConfiguration
    case transport
    case unauthorized
    case forbidden
    case rateLimited(retryAfter: TimeInterval?)
    case server(status: Int)
    case malformedResponse
}

struct APIClient: Sendable {
    let baseURL: URL
    var session: URLSession = .shared

    func send<Request: Encodable, Response: Decodable>(
        path: String,
        method: String = "POST",
        body: Request,
        bearerToken: String? = nil
    ) async throws -> Response {
        guard baseURL.scheme == "https", let url = URL(string: path, relativeTo: baseURL) else {
            throw APIError.invalidConfiguration
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let bearerToken { request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization") }
        request.httpBody = try JSONEncoder.canonical.encode(body)

        let data: Data
        let response: URLResponse
        do { (data, response) = try await session.data(for: request) }
        catch { throw APIError.transport }
        guard let http = response as? HTTPURLResponse else { throw APIError.malformedResponse }
        switch http.statusCode {
        case 200..<300: break
        case 401: throw APIError.unauthorized
        case 403: throw APIError.forbidden
        case 429:
            throw APIError.rateLimited(retryAfter: http.value(forHTTPHeaderField: "Retry-After").flatMap(TimeInterval.init))
        case 500...599: throw APIError.server(status: http.statusCode)
        default: throw APIError.server(status: http.statusCode)
        }
        do { return try JSONDecoder.canonical.decode(Response.self, from: data) }
        catch { throw APIError.malformedResponse }
    }
}

