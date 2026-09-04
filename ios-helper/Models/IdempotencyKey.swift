import CryptoKit
import Foundation

enum IdempotencyKey {
    static let version = "sha256-canonical-v1"

    static func make(
        canonicalUserID: UUID,
        domain: HealthDomain,
        sourceApp: String,
        sourceRecordID: String?,
        startedAt: Date?,
        endedAt: Date?,
        recordedAt: Date,
        value: Double,
        unit: String,
        stage: String?
    ) -> String {
        let tuple = [
            version,
            canonicalUserID.uuidString.lowercased(),
            "ios",
            domain.rawValue,
            sourceApp,
            sourceRecordID ?? "",
            iso(startedAt),
            iso(endedAt),
            iso(recordedAt),
            normalized(value),
            unit,
            stage ?? ""
        ].joined(separator: "\u{001F}")
        return SHA256.hash(data: Data(tuple.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private static func iso(_ date: Date?) -> String {
        guard let date else { return "" }
        return ISO8601DateFormatter.canonical.string(from: date)
    }

    private static func normalized(_ value: Double) -> String {
        var output = String(format: "%.6f", locale: Locale(identifier: "en_US_POSIX"), value)
        while output.last == "0" { output.removeLast() }
        if output.last == "." { output.removeLast() }
        return output == "-0" ? "0" : output
    }
}

extension ISO8601DateFormatter {
    static var canonical: ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter
    }
}
