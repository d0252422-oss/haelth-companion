import Foundation

struct ClaimExchangeRequest: Codable {
    let claim: String
    let installationPublicKey: String
    let installationKeyFingerprint: String
    let signature: String

    enum CodingKeys: String, CodingKey {
        case claim
        case installationPublicKey = "installation_public_key"
        case installationKeyFingerprint = "installation_key_fingerprint"
        case signature
    }
}

struct ClaimExchangeResponse: Codable {
    let sessionID: UUID
    let canonicalUserID: UUID
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date

    enum CodingKeys: String, CodingKey {
        case sessionID = "session_id"
        case canonicalUserID = "canonical_user_id"
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresAt = "expires_at"
    }
}

struct SessionRefreshRequest: Codable {
    let sessionID: UUID
    let refreshToken: String
    let signature: String

    enum CodingKeys: String, CodingKey {
        case sessionID = "session_id"
        case refreshToken = "refresh_token"
        case signature
    }
}

actor SessionManager {
    private let api: APIClient
    private let tokenStore: SecureTokenStore
    private let installationKeyStore: InstallationKeyStore

    init(api: APIClient, tokenStore: SecureTokenStore, installationKeyStore: InstallationKeyStore) {
        self.api = api
        self.tokenStore = tokenStore
        self.installationKeyStore = installationKeyStore
    }

    func currentSession() async throws -> AppSession? {
        guard let session = try tokenStore.load() else { return nil }
        if session.expiresAt <= Date(timeIntervalSinceNow: 60) { return try await refresh(session) }
        return session
    }

    func exchange(_ claim: InstallClaim) async throws -> AppSession {
        let publicKey = try installationKeyStore.subjectPublicKeyInfoData()
        let signature = try installationKeyStore.sign(Data(claim.opaqueValue.utf8))
        let request = ClaimExchangeRequest(
            claim: claim.opaqueValue,
            installationPublicKey: publicKey.base64EncodedString(),
            installationKeyFingerprint: try installationKeyStore.publicKeyFingerprint(),
            signature: signature.base64EncodedString()
        )
        let response: ClaimExchangeResponse = try await api.send(
            path: "/v1/mobile/install-claims/exchange",
            body: request
        )
        let session = AppSession(
            sessionID: response.sessionID,
            canonicalUserID: response.canonicalUserID,
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            expiresAt: response.expiresAt
        )
        try tokenStore.save(session)
        return session
    }

    private func refresh(_ session: AppSession) async throws -> AppSession {
        let message = "\(session.sessionID.uuidString.lowercased())\u{001F}\(session.refreshToken)"
        let request = SessionRefreshRequest(
            sessionID: session.sessionID,
            refreshToken: session.refreshToken,
            signature: try installationKeyStore.sign(Data(message.utf8)).base64EncodedString()
        )
        let response: ClaimExchangeResponse = try await api.send(
            path: "/v1/mobile/sessions/refresh",
            body: request
        )
        guard response.sessionID == session.sessionID,
              response.canonicalUserID == session.canonicalUserID else { throw APIError.forbidden }
        let refreshed = AppSession(
            sessionID: response.sessionID,
            canonicalUserID: response.canonicalUserID,
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            expiresAt: response.expiresAt
        )
        try tokenStore.save(refreshed)
        return refreshed
    }

    func revokeLocalSession() throws { try tokenStore.clear() }
}
