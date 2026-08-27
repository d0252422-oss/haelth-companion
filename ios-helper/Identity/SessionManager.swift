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
    let canonicalUserID: UUID
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date

    enum CodingKeys: String, CodingKey {
        case canonicalUserID = "canonical_user_id"
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresAt = "expires_at"
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

    func currentSession() throws -> AppSession? { try tokenStore.load() }

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
            canonicalUserID: response.canonicalUserID,
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            expiresAt: response.expiresAt
        )
        try tokenStore.save(session)
        return session
    }

    func revokeLocalSession() throws { try tokenStore.clear() }
}
