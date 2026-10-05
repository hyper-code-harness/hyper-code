import SwiftUI

@main
struct HyperMobileApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var servers = ServerProfileStore()
    @StateObject private var sessions = MultiServerSessionCoordinator()

    var body: some Scene {
        WindowGroup {
            HealthSyncScheduler {
                if UIDevice.current.userInterfaceIdiom == .pad {
                    NativePadRootView()
                } else {
                    NativeRootView()
                }
            }
            .environmentObject(servers)
            .environmentObject(sessions)
            .task { await HyperMeshDiscovery.shared.refresh(serverStore: servers) }
            .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await HyperMeshDiscovery.shared.refresh(serverStore: servers) } } }
        }
    }
}
