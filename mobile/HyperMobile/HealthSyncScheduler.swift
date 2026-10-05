import SwiftUI

struct HealthSyncScheduler<Content: View>: View {
    @EnvironmentObject private var servers: ServerProfileStore
    @Environment(\.scenePhase) private var scenePhase
    @ViewBuilder let content: () -> Content
    @State private var loop: Task<Void, Never>?

    var body: some View {
        content()
            .onAppear { startIfActive() }
            .onChange(of: scenePhase) { _, phase in phase == .active ? startIfActive() : stop() }
            .onChange(of: servers.trustedHealthProfileID) { _, _ in stop(); startIfActive() }
            .onDisappear { stop() }
    }
    private func startIfActive() {
        guard scenePhase == .active, loop == nil, let baseURL = servers.trustedHealthURL else { return }
        loop = Task {
            while !Task.isCancelled {
                await HealthKitSleepSync.shared.syncIfAuthorized(baseURL: baseURL)
                try? await Task.sleep(for: .seconds(300))
            }
        }
    }
    private func stop() { loop?.cancel(); loop = nil }
}
