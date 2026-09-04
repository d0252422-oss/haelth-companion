import Foundation
import HealthKit
import SwiftUI

enum SetupState: Equatable {
    case settingUp
    case secureContinuationRequired
    case healthPermissionRequired
    case syncing
    case syncSuccess(Date)
    case error(String)
}

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var state: SetupState = .settingUp
    private let configuration: AppConfiguration
    private let sessionManager: SessionManager
    private let authorization: HealthKitAuthorization
    private let coordinator: HealthSyncCoordinator
    private let claimHandler: InstallClaimHandler
    private let installationKeyStore: InstallationKeyStore
    private let backgroundSync: BackgroundHealthSync

    init(
        configuration: AppConfiguration,
        sessionManager: SessionManager,
        authorization: HealthKitAuthorization,
        coordinator: HealthSyncCoordinator,
        installationKeyStore: InstallationKeyStore,
        backgroundSync: BackgroundHealthSync
    ) {
        self.configuration = configuration
        self.sessionManager = sessionManager
        self.authorization = authorization
        self.coordinator = coordinator
        self.installationKeyStore = installationKeyStore
        self.backgroundSync = backgroundSync
        self.claimHandler = InstallClaimHandler(expectedHost: configuration.universalLinkHost)
    }

    func start() async {
        do {
            state = try await sessionManager.currentSession() == nil ? .secureContinuationRequired : .healthPermissionRequired
        } catch { state = .error("安全工作階段不可用") }
    }

    func secureContinuationURL() -> URL? {
        guard let fingerprint = try? installationKeyStore.publicKeyFingerprint() else { return nil }
        return configuration.bootstrapURL(installationKeyFingerprint: fingerprint)
    }

    func handleUniversalLink(_ url: URL) async {
        do {
            let claim = try claimHandler.parse(url)
            _ = try await sessionManager.exchange(claim)
            state = .healthPermissionRequired
            await requestHealthAccessAndSync()
        } catch { state = .error("安全綁定失敗，請從已登入的網站重新開始") }
    }

    func requestHealthAccessAndSync() async {
        do {
            guard try await authorization.request() == .requestProcessed else {
                state = .error("此裝置無法使用 Apple 健康資料")
                return
            }
            state = .syncing
            try await coordinator.synchronize()
            backgroundSync.enableObservers()
            state = .syncSuccess(Date())
        } catch { state = .error("同步尚未完成，系統將稍後自動重試") }
    }

    func retry() async { await requestHealthAccessAndSync() }
}
