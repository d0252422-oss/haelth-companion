import Foundation

enum InstallClaimError: Error, Equatable {
    case unexpectedHost
    case unexpectedPath
    case queryCredentialRejected
    case missingClaim
    case malformedClaim
}

struct InstallClaim: Equatable, Sendable {
    let opaqueValue: String
}

struct InstallClaimHandler {
    let expectedHost: String
    let expectedPath = "/health-sync/bootstrap"

    func parse(_ url: URL) throws -> InstallClaim {
        guard url.scheme == "https", url.host == expectedHost else { throw InstallClaimError.unexpectedHost }
        guard url.path == expectedPath else { throw InstallClaimError.unexpectedPath }
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        if components?.queryItems?.contains(where: { $0.name == "claim" }) == true {
            throw InstallClaimError.queryCredentialRejected
        }
        guard let fragment = components?.fragment else { throw InstallClaimError.missingClaim }
        let fragmentItems = URLComponents(string: "https://local.invalid/?\(fragment)")?.queryItems
        guard let value = fragmentItems?.first(where: { $0.name == "claim" })?.value else {
            throw InstallClaimError.missingClaim
        }
        guard value.count >= 32, value.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil else {
            throw InstallClaimError.malformedClaim
        }
        return InstallClaim(opaqueValue: value)
    }
}

