import HealthKit

struct HealthKitMapper: Sendable {
    let calendar: Calendar

    init(calendar: Calendar = .autoupdatingCurrent) { self.calendar = calendar }

    func map(_ sample: HKSample, domain: HealthDomain, canonicalUserID: UUID) throws -> CanonicalHealthRecord {
        let timezone = timezoneFor(sample)
        let value: Double
        let unit: String
        let stage: String?

        switch domain {
        case .steps:
            guard let quantity = sample as? HKQuantitySample else { throw HealthKitReadError.unexpectedSample }
            value = quantity.quantity.doubleValue(for: .count())
            unit = "count"
            stage = nil
        case .heartRate:
            guard let quantity = sample as? HKQuantitySample else { throw HealthKitReadError.unexpectedSample }
            value = quantity.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
            unit = "bpm"
            stage = nil
        case .sleep:
            guard let category = sample as? HKCategorySample else { throw HealthKitReadError.unexpectedSample }
            value = sample.endDate.timeIntervalSince(sample.startDate) / 60
            unit = "minute"
            stage = sleepStage(category.value)
        }

        var localCalendar = calendar
        localCalendar.timeZone = timezone
        let dateParts = localCalendar.dateComponents([.year, .month, .day], from: domain == .sleep ? sample.endDate : sample.startDate)
        let localDate = String(format: "%04d-%02d-%02d", dateParts.year ?? 0, dateParts.month ?? 0, dateParts.day ?? 0)
        let sourceApp = sample.sourceRevision.source.bundleIdentifier
        let device = sample.device.map {
            SourceDeviceMetadata(
                manufacturer: $0.manufacturer,
                model: $0.model,
                hardwareVersion: $0.hardwareVersion,
                softwareVersion: $0.softwareVersion
            )
        }
        let sourceRecordID = sample.uuid.uuidString.lowercased()
        let key = IdempotencyKey.make(
            canonicalUserID: canonicalUserID,
            domain: domain,
            sourceApp: sourceApp,
            sourceRecordID: sourceRecordID,
            startedAt: sample.startDate,
            endedAt: sample.endDate,
            recordedAt: sample.startDate,
            value: value,
            unit: unit,
            stage: stage
        )
        return CanonicalHealthRecord(
            canonicalUserID: canonicalUserID,
            platform: "ios",
            domain: domain,
            sourceApp: sourceApp,
            sourceRecordID: sourceRecordID,
            sourceUpdatedAt: nil,
            recordedAt: sample.startDate,
            startedAt: sample.startDate,
            endedAt: sample.endDate,
            timezone: timezone.identifier,
            localDate: localDate,
            value: value,
            unit: unit,
            stage: stage,
            sourceDevice: device,
            schemaVersion: "hdl-v2.health-ingestion.v1",
            idempotencyKey: key
        )
    }

    private func timezoneFor(_ sample: HKSample) -> TimeZone {
        if let identifier = sample.metadata?[HKMetadataKeyTimeZone] as? String,
           let timezone = TimeZone(identifier: identifier) { return timezone }
        return calendar.timeZone
    }

    private func sleepStage(_ raw: Int) -> String {
        guard let value = HKCategoryValueSleepAnalysis(rawValue: raw) else { return "unknown" }
        switch value {
        case .inBed: return "in_bed"
        case .awake: return "awake"
        case .asleepUnspecified: return "asleep_unspecified"
        case .asleepCore: return "asleep_core"
        case .asleepDeep: return "asleep_deep"
        case .asleepREM: return "asleep_rem"
        @unknown default: return "unknown"
        }
    }
}
