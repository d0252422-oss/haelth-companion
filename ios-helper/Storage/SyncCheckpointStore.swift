import Foundation
import HealthKit

protocol SyncCheckpointStoring: Sendable {
    func loadAnchor(for domain: HealthDomain) throws -> HKQueryAnchor?
    func saveAnchor(_ anchor: HKQueryAnchor, for domain: HealthDomain) throws
    func lastSuccessfulSync() -> Date?
    func markSuccessfulSync(at date: Date)
}

final class SyncCheckpointStore: SyncCheckpointStoring, @unchecked Sendable {
    private let defaults: UserDefaults
    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    func loadAnchor(for domain: HealthDomain) throws -> HKQueryAnchor? {
        guard let data = defaults.data(forKey: "health.anchor.\(domain.rawValue)") else { return nil }
        return try NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
    }

    func saveAnchor(_ anchor: HKQueryAnchor, for domain: HealthDomain) throws {
        let data = try NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true)
        defaults.set(data, forKey: "health.anchor.\(domain.rawValue)")
    }

    func lastSuccessfulSync() -> Date? { defaults.object(forKey: "health.lastSuccessfulSync") as? Date }
    func markSuccessfulSync(at date: Date) { defaults.set(date, forKey: "health.lastSuccessfulSync") }
}

