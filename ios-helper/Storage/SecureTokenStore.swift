import Foundation
import Security

struct AppSession: Codable, Equatable, Sendable {
    let sessionID: UUID
    let canonicalUserID: UUID
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date
}

protocol SecureTokenStore: Sendable {
    func load() throws -> AppSession?
    func save(_ session: AppSession) throws
    func clear() throws
}

enum SecureTokenStoreError: Error { case encoding, decoding, keychain(OSStatus) }

final class KeychainTokenStore: SecureTokenStore, @unchecked Sendable {
    private let service = "tw.lifehelper.healthsync.session"
    private let account = "current"

    func load() throws -> AppSession? {
        let query = baseQuery.merging([
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]) { _, new in new }
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw SecureTokenStoreError.keychain(status) }
        guard let data = result as? Data,
              let session = try? JSONDecoder.canonical.decode(AppSession.self, from: data) else {
            throw SecureTokenStoreError.decoding
        }
        return session
    }

    func save(_ session: AppSession) throws {
        guard let data = try? JSONEncoder.canonical.encode(session) else { throw SecureTokenStoreError.encoding }
        try clear()
        let item = baseQuery.merging([
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]) { _, new in new }
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw SecureTokenStoreError.keychain(status) }
    }

    func clear() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw SecureTokenStoreError.keychain(status)
        }
    }

    private var baseQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }
}

extension JSONEncoder {
    static let canonical: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }()
}

extension JSONDecoder {
    static let canonical: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}
