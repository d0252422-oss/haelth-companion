import CryptoKit
import Foundation
import Security

enum InstallationKeyError: Error { case createFailed, publicKeyUnavailable, exportFailed, signFailed }

final class InstallationKeyStore: @unchecked Sendable {
    private let tag = Data("tw.lifehelper.healthsync.installation-key.v1".utf8)

    func publicKeyData() throws -> Data {
        let key = try privateKey()
        guard let publicKey = SecKeyCopyPublicKey(key) else { throw InstallationKeyError.publicKeyUnavailable }
        var error: Unmanaged<CFError>?
        guard let data = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
            throw InstallationKeyError.exportFailed
        }
        return data
    }

    func subjectPublicKeyInfoData() throws -> Data {
        // ASN.1 SubjectPublicKeyInfo prefix for id-ecPublicKey + prime256v1,
        // followed by the 65-byte ANSI X9.63 uncompressed public key.
        let prefix = Data([0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2A, 0x86, 0x48, 0xCE,
                           0x3D, 0x02, 0x01, 0x06, 0x08, 0x2A, 0x86, 0x48, 0xCE, 0x3D,
                           0x03, 0x01, 0x07, 0x03, 0x42, 0x00])
        let raw = try publicKeyData()
        guard raw.count == 65, raw.first == 0x04 else { throw InstallationKeyError.exportFailed }
        return prefix + raw
    }

    func publicKeyFingerprint() throws -> String {
        SHA256.hash(data: try subjectPublicKeyInfoData()).map { String(format: "%02x", $0) }.joined()
    }

    func sign(_ data: Data) throws -> Data {
        var error: Unmanaged<CFError>?
        guard let signature = SecKeyCreateSignature(
            try privateKey(),
            .ecdsaSignatureMessageX962SHA256,
            data as CFData,
            &error
        ) as Data? else { throw InstallationKeyError.signFailed }
        return signature
    }

    private func privateKey() throws -> SecKey {
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: tag,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecReturnRef as String: true
        ]
        var found: CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary, &found) == errSecSuccess,
           let key = found as! SecKey? { return key }

        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: tag,
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            ]
        ]
        var error: Unmanaged<CFError>?
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
            throw InstallationKeyError.createFailed
        }
        return key
    }
}
