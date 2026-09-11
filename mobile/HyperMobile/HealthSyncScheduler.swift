import SwiftUI

struct HealthSyncScheduler<Content: View>: View {
    @AppStorage("hyper.serverURL") private var serverURL = "https://hyper.tunnel.apki.dev"
    @Environment(\.scenePhase) private var scenePhase
    @ViewBuilder let content: () -> Content
    @State private var loop: Task<Void, Never>?

    var body: some View {
        content()
            .onAppear { startIfActive() }
            .onChange(of: scenePhase) { _, phase in phase == .active ? startIfActive() : stop() }
            .onDisappear { stop() }
    }
    private func startIfActive() {
        guard scenePhase == .active, loop == nil, let baseURL = URL(string: serverURL) else { return }
        loop = Task {
            while !Task.isCancelled {
                await HealthKitSleepSync.shared.syncIfAuthorized(baseURL: baseURL)
                try? await Task.sleep(for: .seconds(300))
            }
        }
    }
    private func stop() { loop?.cancel(); loop = nil }
}
