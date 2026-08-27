import SwiftUI

struct HealthSyncView: View {
    @ObservedObject var model: AppModel
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(spacing: 20) {
            Text("生活小助手").font(.title.bold())
            Text("健康資料同步").font(.headline)
            content
        }
        .padding(24)
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .settingUp:
            ProgressView("正在設定")
        case .secureContinuationRequired:
            Text("請由已登入的健康管理網站完成安全連結。")
            Button("繼續安全設定") {
                if let url = model.secureContinuationURL() { openURL(url) }
            }
        case .healthPermissionRequired:
            Text("允許生活小助手讀取步數、心率與睡眠資料，用於健康分析與同步。")
            Button("允許健康資料存取") { Task { await model.requestHealthAccessAndSync() } }
        case .syncing:
            ProgressView("同步中")
        case .syncSuccess(let date):
            Text("健康資料同步已啟用")
            Text("最近同步：\(date.formatted())").font(.caption)
            Button("重新同步") { Task { await model.retry() } }
        case .error(let message):
            Text(message).foregroundStyle(.red)
            Button("重試") { Task { await model.retry() } }
        }
    }
}

