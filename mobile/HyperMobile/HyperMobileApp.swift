import SwiftUI

@main
struct HyperMobileApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var servers = ServerProfileStore()
    @StateObject private var sessions = MultiServerSessionCoordinator()

    var body: some Scene {
        WindowGroup {
            Group {
                if servers.hasServers {
                    HealthSyncScheduler {
                        if UIDevice.current.userInterfaceIdiom == .pad {
                            NativePadRootView()
                        } else {
                            NativeRootView()
                        }
                    }
                } else {
                    NoServersView()
                }
            }
            .environmentObject(servers)
            .environmentObject(sessions)
            .task { await HyperMeshDiscovery.shared.refresh(serverStore: servers) }
            .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await HyperMeshDiscovery.shared.refresh(serverStore: servers) } } }
        }
    }
}

/// First run, or every server removed: there is no built-in default. Servers come from Hypermesh discovery with the VPN on, or are added by hand.
struct NoServersView: View {
    @EnvironmentObject private var servers: ServerProfileStore
    @StateObject private var discovery = HyperMeshDiscovery.shared
    @State private var showingServers = false

    var body: some View {
        VStack(spacing: 18) {
            Spacer()
            Image(systemName: "point.3.connected.trianglepath.dotted").font(.system(size: 46)).foregroundStyle(.indigo)
            Text("Find your Hyper").font(.title2.bold())
            Text("Turn on the Hypermesh VPN, then tap Discover. Your team workspaces appear here.")
                .multilineTextAlignment(.center).foregroundStyle(.secondary)
            if discovery.isRefreshing {
                ProgressView("Looking for Hyper workspaces…")
            } else {
                Button("Discover", systemImage: "arrow.clockwise") { Task { await discovery.refresh(serverStore: servers) } }
                    .buttonStyle(.borderedProminent).controlSize(.large)
            }
            if let message = discovery.message { Text(message).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center) }
            Button("Add server by address") { showingServers = true }.buttonStyle(.bordered)
            Spacer()
        }
        .padding(24)
        .sheet(isPresented: $showingServers) { ServerProfilesView() }
        .task { await discovery.refresh(serverStore: servers) }
    }
}
