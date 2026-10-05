import Foundation

struct ServerWorkspaceSnapshot {
    var agents: [AgentSummary] = []
    var isLoading = false
    var error: String?
    var lastUpdated: Date?
}

@MainActor
final class MultiServerSessionCoordinator: ObservableObject {
    @Published private(set) var workspaces: [String: ServerWorkspaceSnapshot] = [:]
    private var loops: [String: Task<Void, Never>] = [:]
    private var activeURLs: [String: String] = [:]

    func workspace(for profileID: String) -> ServerWorkspaceSnapshot {
        if let live = workspaces[profileID] { return live }
        let cached = MobileStateCache.shared.server(profileID)
        return ServerWorkspaceSnapshot(agents: cached.agents, isLoading: false, error: nil, lastUpdated: cached.updatedAt)
    }

    func activate(profiles: [ServerProfile], serverStore: ServerProfileStore) {
        let ids = Set(profiles.map(\.id))
        for id in Array(loops.keys) where !ids.contains(id) {
            loops.removeValue(forKey: id)?.cancel()
            activeURLs.removeValue(forKey: id)
            workspaces.removeValue(forKey: id)
        }
        for profile in profiles {
            if activeURLs[profile.id] != profile.url {
                loops.removeValue(forKey: profile.id)?.cancel()
                workspaces.removeValue(forKey: profile.id)
                start(profile: profile, serverStore: serverStore)
            }
        }
    }

    func refresh(profile: ServerProfile, serverStore: ServerProfileStore, showLoading: Bool = true) async {
        guard let baseURL = profile.baseURL else { return }
        if showLoading { mutate(profile.id) { $0.isLoading = true } }
        defer { if showLoading { mutate(profile.id) { $0.isLoading = false } } }
        do {
            let client = APIClient(baseURL: baseURL)
            let auth = try await client.authSession()
            serverStore.updateAuth(profileID: profile.id, session: auth)
            guard auth.authenticated else { mutate(profile.id) { $0.error = nil }; return }
            let agents = try await client.agents()
            mutate(profile.id) { snapshot in
                snapshot.agents = agents
                snapshot.error = nil
                snapshot.lastUpdated = Date()
            }
            MobileStateCache.shared.updateAgents(agents, profileID: profile.id)
        } catch let error as APIClientError {
            if case .unauthorized = error { serverStore.markSignedOut(profile.id) }
            mutate(profile.id) { $0.error = error.localizedDescription }
        } catch {
            mutate(profile.id) { $0.error = error.localizedDescription }
        }
    }

    func remove(profileID: String) {
        MobileStateCache.shared.removeServer(profileID)
        activeURLs.removeValue(forKey: profileID)
        loops.removeValue(forKey: profileID)?.cancel()
        workspaces.removeValue(forKey: profileID)
    }

    private func start(profile: ServerProfile, serverStore: ServerProfileStore) {
        activeURLs[profile.id] = profile.url
        loops[profile.id] = Task { [weak self] in
            guard let self else { return }
            await refresh(profile: profile, serverStore: serverStore)
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                guard !Task.isCancelled else { break }
                await refresh(profile: profile, serverStore: serverStore, showLoading: false)
            }
        }
    }

    private func mutate(_ profileID: String, _ update: (inout ServerWorkspaceSnapshot) -> Void) {
        var value = workspaces[profileID] ?? workspace(for: profileID)
        update(&value)
        workspaces[profileID] = value
    }
}
