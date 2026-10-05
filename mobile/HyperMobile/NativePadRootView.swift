import SwiftUI
import AuthenticationServices

struct NativePadRootView: View {
    @EnvironmentObject private var servers: ServerProfileStore
    @EnvironmentObject private var sessions: MultiServerSessionCoordinator
    @StateObject private var store = AgentListStore()
    @State private var selection: AgentSummary?
    @State private var query = ""
    @State private var selectedFolder: String?
    @State private var showingSettings = false
    @State private var showingServers = false
    @State private var showingNews = false
    @State private var showingWeb = false
    @State private var showingHealth = false
    @State private var showingNewAgent = false
    @State private var needsLogin = false
    @State private var loginPassword = ""
    @State private var loginError: String?
    @State private var loggingIn = false
    @State private var sso = MobileSSO()
    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    @State private var showingLogoutConfirmation = false
    @State private var authUser: APIClient.AuthUser?

    private var baseURL: URL? { servers.selectedURL }
    private var selectedWorkspace: ServerWorkspaceSnapshot { sessions.workspace(for: servers.selectedID) }
    private var folders: [String] { Array(Set(selectedWorkspace.agents.map { folder($0.workspaceDir) })).sorted() }
    private var filtered: [AgentSummary] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return selectedWorkspace.agents.filter { agent in
            (needle.isEmpty || agent.title.lowercased().contains(needle) || agent.workspaceDir.lowercased().contains(needle)) &&
            (selectedFolder == nil || folder(agent.workspaceDir) == selectedFolder)
        }.sorted {
            if $0.pinned != $1.pinned { return $0.pinned }
            if ($0.unread > 0) != ($1.unread > 0) { return $0.unread > 0 }
            if $0.isRunning != $1.isRunning { return $0.isRunning }
            return $0.updatedAt > $1.updatedAt
        }
    }

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            List(selection: $selectedFolder) {
                Section("Workspace") {
                    Label("All chats", systemImage: "bubble.left.and.bubble.right").tag(String?.none)
                    ForEach(folders, id: \.self) { value in Label(value, systemImage: "folder").tag(Optional(value)) }
                }
                Section("Explore") {
                    Button { showingWeb = true } label: { Label("Web Hyper", systemImage: "safari") }
                }
            }
            .navigationTitle("Hyper Code")
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button { showingNews = true } label: { Image(systemName: "newspaper") }.accessibilityLabel("News")
                    ServerSwitcherMenu { showingServers = true }
                    Button { showingHealth = true } label: { Image(systemName: "heart.text.square") }.accessibilityLabel("Health Sync")
                    Menu {
                        if let authUser { Text(authUser.name) }
                        Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) { showingLogoutConfirmation = true }
                    } label: { Image(systemName: "person.crop.circle") }
                    .accessibilityLabel("Account")
                    Button { showingSettings = true } label: { Image(systemName: "gearshape") }.accessibilityLabel("Connection")
                }
            }
        } content: {
            List(filtered, selection: $selection) { agent in
                AgentRow(agent: agent).tag(agent)
                    .contextMenu { Button { pin(agent, !agent.pinned) } label: { Label(agent.pinned ? "Unpin" : "Pin", systemImage: "pin") } }
            }
            .navigationTitle(selectedFolder ?? "Chats")
            .searchable(text: $query, prompt: "Search chats")
            .refreshable { await refreshSelected() }
            .overlay { if selectedWorkspace.isLoading && selectedWorkspace.agents.isEmpty { ProgressView("Connecting…") } }
            .toolbar {
                ToolbarItem(placement: .primaryAction) { Button { showingNewAgent = true } label: { Label("New chat", systemImage: "square.and.pencil") } }
            }
        } detail: {
            if let agent = selection, let baseURL {
                NativeChatView(agent: agent, baseURL: baseURL, profileID: servers.selectedID) { Task { await refreshSelected() } }
                    .id(agent.id)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .toolbar { panelToggle }
            } else {
                ContentUnavailableView("Select a chat", systemImage: "bubble.left.and.bubble.right", description: Text("Choose a conversation from the middle column."))
                    .background(DotGridBackground())
                    .toolbar { panelToggle }
            }
        }
        .navigationSplitViewStyle(.balanced)
        .task { sessions.activate(profiles: servers.profiles, serverStore: servers); switchServer() }
        .onChange(of: servers.profiles) { _, profiles in sessions.activate(profiles: profiles, serverStore: servers) }
        .onChange(of: selectedWorkspace.agents) { _, agents in store.agents = agents }
        .onChange(of: selectedWorkspace.error) { _, error in store.error = error }
        .onChange(of: selection?.id) { _, value in MobileStateCache.shared.updateSelection(profileID: servers.selectedID, agentID: value) }
        .onChange(of: selectedFolder) { _, value in MobileStateCache.shared.updateListState(profileID: servers.selectedID, folder: value, query: query) }
        .onChange(of: query) { _, value in MobileStateCache.shared.updateListState(profileID: servers.selectedID, folder: selectedFolder, query: value) }
        .onDisappear { store.stopRefreshing() }
        .onChange(of: servers.selectedID) { _, _ in needsLogin = false; switchServer() }
        .onChange(of: servers.auth(for: servers.selectedID).status) { _, status in needsLogin = status == .signInRequired }
        .sheet(isPresented: $showingSettings) { ServerProfilesView() }
        .sheet(isPresented: $showingServers) { ServerProfilesView() }
        .sheet(isPresented: $showingHealth) { if let healthURL = servers.trustedHealthURL { HealthSyncView(baseURL: healthURL, serverName: servers.trustedHealthProfile.name) } }
        .fullScreenCover(isPresented: $showingNews) { if let baseURL { NativePadNewsView(baseURL: baseURL) } }
        .sheet(isPresented: $showingWeb) { NavigationStack { HyperWebViewScreen(urlString: servers.selectedProfile.url) } }
        .sheet(isPresented: $showingNewAgent) { if let baseURL { NewAgentView(baseURL: baseURL) { created in showingNewAgent = false; Task { await refreshSelected(); selection = store.agents.first { $0.id == created.id } } } } }
        .sheet(isPresented: $needsLogin) {
            NativeLoginView(password: $loginPassword, error: loginError, isLoading: loggingIn, sso: { signInWithSSO() }) { login() }
        }
        .confirmationDialog("Sign out of Hyper?", isPresented: $showingLogoutConfirmation, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { logout() }
            Button("Cancel", role: .cancel) { }
        }
    }

    @ToolbarContentBuilder private var panelToggle: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button {
                withAnimation(.snappy) { columnVisibility = columnVisibility == .detailOnly ? .all : .detailOnly }
            } label: {
                Image(systemName: columnVisibility == .detailOnly ? "sidebar.left" : "sidebar.left")
            }
            .accessibilityLabel(columnVisibility == .detailOnly ? "Show chat panels" : "Hide chat panels")
        }
    }

    private func refreshSelected() async {
        await sessions.refresh(profile: servers.selectedProfile, serverStore: servers)
        let snapshot = sessions.workspace(for: servers.selectedID)
        store.agents = snapshot.agents
        store.error = snapshot.error
        authUser = authUserFromSnapshot()
        needsLogin = servers.auth(for: servers.selectedID).status == .signInRequired
    }
    private func login() { guard let baseURL, !loginPassword.isEmpty else { return }; loggingIn = true; Task { do { try await APIClient(baseURL: baseURL).login(password: loginPassword); loginPassword = ""; needsLogin = false; await refreshSelected() } catch { loginError = error.localizedDescription }; loggingIn = false } }
    private func signInWithSSO() { guard let baseURL else { return }; loggingIn = true; loginError = nil; Task { do { try await sso.signIn(baseURL: baseURL); needsLogin = false; await refreshSelected() } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin { } catch { loginError = error.localizedDescription }; loggingIn = false } }
    private func logout() { guard let baseURL else { return }; let profileID = servers.selectedID; Task { do { try await APIClient(baseURL: baseURL).logout(); ServerSessionPool.shared.clear(baseURL: baseURL); servers.markSignedOut(profileID); sessions.remove(profileID: profileID); sessions.activate(profiles: servers.profiles, serverStore: servers); store.stopRefreshing(); store.agents = []; selection = nil; authUser = nil; loginPassword = ""; loginError = nil; needsLogin = true } catch { loginError = error.localizedDescription } } }
    private func switchServer() { store.stopRefreshing(); let cached = MobileStateCache.shared.server(servers.selectedID); let snapshot = sessions.workspace(for: servers.selectedID); selection = cached.selectedAgentID.flatMap { id in snapshot.agents.first { $0.id == id } }; selectedFolder = cached.selectedFolder; query = cached.query; loginPassword = ""; loginError = nil; store.agents = snapshot.agents; store.error = snapshot.error; authUser = authUserFromSnapshot(); needsLogin = servers.auth(for: servers.selectedID).status == .signInRequired; Task { await sessions.refresh(profile: servers.selectedProfile, serverStore: servers, showLoading: snapshot.agents.isEmpty) } }
    private func authUserFromSnapshot() -> APIClient.AuthUser? { let auth = servers.auth(for: servers.selectedID); guard auth.status == .authenticated else { return nil }; return APIClient.AuthUser(id: auth.userID, name: auth.userName ?? "Signed in", email: auth.userEmail, role: auth.role ?? "user") }
    private func pin(_ agent: AgentSummary, _ value: Bool) { guard let baseURL else { return }; Task { await store.setPinned(agent, pinned: value, baseURL: baseURL); await refreshSelected() } }
    private func folder(_ path: String) -> String { let value = URL(fileURLWithPath: path).lastPathComponent; return value.isEmpty ? "No workspace" : value }
}
