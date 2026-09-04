import HealthKit
import SwiftUI

@main
@MainActor
struct HealthSyncHelperApp: App {
    private let assembly: Result<AppModel, Error>

    init() {
        do {
            assembly = .success(try Self.makeModel())
        } catch {
            assembly = .failure(error)
        }
    }

    var body: some Scene {
        WindowGroup {
            switch assembly {
            case .success(let model): HealthSyncRootView(model: model)
            case .failure: ConfigurationErrorView()
            }
        }
    }

    private static func makeModel() throws -> AppModel {
        // Invalid deployment configuration fails closed without selecting a
        // default server, user, or credential.
        let configuration = try AppConfiguration.load()
        let api = APIClient(baseURL: configuration.apiBaseURL)
        let keyStore = InstallationKeyStore()
        let sessionManager = SessionManager(api: api, tokenStore: KeychainTokenStore(), installationKeyStore: keyStore)
        let healthStore = HKHealthStore()
        let readers = try [
            HealthKitReaders.steps(store: healthStore),
            HealthKitReaders.heartRate(store: healthStore),
            HealthKitReaders.sleep(store: healthStore)
        ]
        let coordinator = HealthSyncCoordinator(
            readers: readers,
            mapper: HealthKitMapper(),
            checkpointStore: SyncCheckpointStore(),
            pendingStore: PendingUploadStore(),
            sourceVersionStore: SourceRecordVersionStore(),
            ingestionClient: HealthIngestionClient(api: api),
            sessionManager: sessionManager
        )
        let backgroundSync = BackgroundHealthSync(store: healthStore, coordinator: coordinator)
        backgroundSync.register()
        return AppModel(
            configuration: configuration,
            sessionManager: sessionManager,
            authorization: HealthKitAuthorization(store: healthStore),
            coordinator: coordinator,
            installationKeyStore: keyStore,
            backgroundSync: backgroundSync
        )
    }
}

private struct HealthSyncRootView: View {
    @StateObject private var model: AppModel
    init(model: AppModel) { _model = StateObject(wrappedValue: model) }

    var body: some View {
        HealthSyncView(model: model)
            .task { await model.start() }
            .onOpenURL { url in Task { await model.handleUniversalLink(url) } }
    }
}

private struct ConfigurationErrorView: View {
    var body: some View {
        VStack(spacing: 12) {
            Text("生活小助手").font(.title.bold())
            Text("此測試版本尚未完成安全環境設定。")
            Text("請安裝管理員提供的正確版本。")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(24)
    }
}
