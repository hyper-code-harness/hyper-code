import SwiftUI

struct NativeRootView: View {
    @AppStorage("hyper.serverURL") private var serverURL = "https://hyper.tunnel.apki.dev"
    @AppStorage("hyper.tunnelDefault.v1") private var tunnelDefaultApplied = false
    @StateObject private var store = AgentListStore()
    @State private var showingSettings = false
    @State private var showingHealth = false
    @State private var showingWeb = false
    @State private var showingNewAgent = false
    @State private var createdAgentToOpen: AgentSummary?
    @State private var query = ""
    @State private var selectedFolder: String?
    @State private var needsLogin = false
    @State private var loginPassword = ""
    @State private var loginError: String?
    @State private var isLoggingIn = false

    @State private var pendingDelete: AgentSummary?
    private var baseURL: URL? { URL(string: serverURL) }
    private var folders: [String] { Array(Set(store.agents.map { folderName($0.workspaceDir) })).sorted() }
    private var filtered: [AgentSummary] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return store.agents.filter {
            (q.isEmpty || $0.title.lowercased().contains(q) || $0.id.lowercased().contains(q) || $0.workspaceDir.lowercased().contains(q)) &&
            (selectedFolder == nil || folderName($0.workspaceDir) == selectedFolder)
        }.sorted {
            if $0.pinned != $1.pinned { return $0.pinned }
            if ($0.unread > 0) != ($1.unread > 0) { return $0.unread > 0 }
            if $0.isRunning != $1.isRunning { return $0.isRunning }
            return $0.updatedAt > $1.updatedAt
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color(.systemBackground).ignoresSafeArea()
                if store.isLoading && store.agents.isEmpty {
                    ProgressView("Connecting…")
                } else if let error = store.error, store.agents.isEmpty {
                    ContentUnavailableView("Can’t connect", systemImage: "wifi.exclamationmark", description: Text(error))
                } else {
                    VStack(spacing: 0) {
                        List {
                            agentSection("Pinned", filtered.filter(\.pinned))
                            agentSection("Unread", filtered.filter { !$0.pinned && $0.unread > 0 })
                            agentSection("Recent", filtered.filter { !$0.pinned && $0.unread == 0 })
                        }
                        .listStyle(.plain)
                        .safeAreaPadding(.bottom, 12)
                        .scrollContentBackground(.hidden)
                        .refreshable { await reload() }
                    }
                    .overlay(alignment: .bottom) {
                        Button { showingNewAgent = true } label: {
                            Label("New chat", systemImage: "plus").font(.headline.weight(.semibold))
                                .padding(.horizontal, 22).frame(height: 52)
                                .foregroundStyle(Color(.systemBackground))
                                .background(Color.primary.opacity(0.94), in: Capsule())
                                .overlay(Capsule().stroke(Color(.systemBackground).opacity(0.16), lineWidth: 0.5))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("New chat")
                        .padding(.bottom, 10)
                        .shadow(color: .black.opacity(0.12), radius: 16, y: 8)
                    }
                }
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search chats")
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Menu {
                        Button { selectedFolder = nil } label: { if selectedFolder == nil { Label("All chats", systemImage: "checkmark") } else { Text("All chats") } }
                        Divider()
                        ForEach(folders, id: \.self) { folder in
                            Button { selectedFolder = folder } label: { if selectedFolder == folder { Label(folder, systemImage: "checkmark") } else { Text(folder) } }
                        }
                    } label: {
                        HStack(spacing: 5) {
                            Text(selectedFolder ?? "All chats").font(.headline).lineLimit(1)
                            Image(systemName: "chevron.down").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityLabel("Filter chats by folder")
                }
                ToolbarItem(placement: .topBarLeading) { EmptyView() }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    NavigationLink { if let baseURL { NewsReaderView(baseURL: baseURL) } } label: { Image(systemName: "newspaper") }.accessibilityLabel("News")
                    Button { showingWeb = true } label: { Image(systemName: "safari") }
                    Button { showingHealth = true } label: { Image(systemName: "heart.text.square") }.accessibilityLabel("Health Sync")
                    Button { showingSettings = true } label: { Image(systemName: "gearshape") }
                }
            }
            .navigationDestination(for: AgentSummary.self) { agent in
                if let baseURL {
                    NativeChatView(agent: agent, baseURL: baseURL, onRead: { Task { await reload() } }, onNextUnread: { openNextUnread(after: agent.id) })
                        .id(agent.id)
                }
            }
        }
        .task {
            if !tunnelDefaultApplied { serverURL = "https://hyper.tunnel.apki.dev"; tunnelDefaultApplied = true }
            await reload()
            if let baseURL { store.startRefreshing(baseURL: baseURL) }
        }
        .onDisappear { store.stopRefreshing() }
        .navigationDestination(item: $createdAgentToOpen) { agent in
            if let baseURL { NativeChatView(agent: agent, baseURL: baseURL, onRead: { Task { await reload() } }, onNextUnread: { openNextUnread(after: agent.id) }).id(agent.id) }
        }
        .sheet(isPresented: $showingNewAgent) { if let baseURL { NewAgentView(baseURL: baseURL) { created in showingNewAgent = false; openCreatedAgent(created) } } }
        .sheet(isPresented: $showingHealth) { if let baseURL { HealthSyncView(baseURL: baseURL) } }
        .sheet(isPresented: $showingSettings) { NativeSettingsView(serverURL: $serverURL) { Task { await reload() } } }
        .sheet(isPresented: $showingWeb) { NavigationStack { HyperWebViewScreen(urlString: serverURL) } }
        .sheet(isPresented: $needsLogin) { NativeLoginView(password: $loginPassword, error: loginError, isLoading: isLoggingIn) { login() } }
        .alert("Delete this chat?", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } })) {
            Button("Cancel", role: .cancel) { pendingDelete = nil }
            Button("Delete", role: .destructive) { if let agent = pendingDelete { delete(agent) }; pendingDelete = nil }
        } message: { Text("The transcript and attachments will be permanently removed.") }
    }

    @ViewBuilder private func agentSection(_ title: String, _ agents: [AgentSummary]) -> some View {
        if !agents.isEmpty {
            Text(title).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                .padding(.top, 6).padding(.bottom, 1)
                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
            ForEach(agents) { agent in
                    ZStack {
                        AgentRow(agent: agent)
                        NavigationLink(value: agent) { EmptyView() }.opacity(0)
                    }
                        .listRowSeparator(.visible)
                        .listRowSeparatorTint(Color.primary.opacity(0.12))
                        .alignmentGuide(.listRowSeparatorLeading) { _ in 50 }
                        .listRowInsets(EdgeInsets(top: 1, leading: 16, bottom: 1, trailing: 16))
                        .listRowSpacing(0)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) { pendingDelete = agent } label: { Label("Delete", systemImage: "trash") }
                            Button { archive(agent) } label: { Label("Archive", systemImage: "archivebox") }.tint(.orange)
                        }
                        .swipeActions(edge: .leading) {
                            Button { pin(agent, !agent.pinned) } label: { Label(agent.pinned ? "Unpin" : "Pin", systemImage: agent.pinned ? "pin.slash" : "pin") }.tint(.orange)
                        }
                    .contextMenu { Button { pin(agent, !agent.pinned) } label: { Label(agent.pinned ? "Unpin" : "Pin", systemImage: agent.pinned ? "pin.slash" : "pin") } }
            }
        }
    }

    private func openNextUnread(after currentID: String) {
        Task {
            await reload()
            let unread = filtered.filter { $0.unread > 0 && $0.id != currentID }
            guard let next = unread.first else { UINotificationFeedbackGenerator().notificationOccurred(.warning); return }
            createdAgentToOpen = next
        }
    }

    private func openCreatedAgent(_ created: CreatedAgent) {
        Task {
            await reload()
            if let agent = store.agents.first(where: { $0.id == created.id }) { createdAgentToOpen = agent }
        }
    }

    private func reload() async {
        guard let baseURL else { store.error = "Invalid server URL"; return }
        await store.load(baseURL: baseURL)
        if store.error?.localizedCaseInsensitiveContains("authentication") == true || store.error?.localizedCaseInsensitiveContains("unauthorized") == true { needsLogin = true }
    }
    private func login() {
        guard let baseURL, !loginPassword.isEmpty else { return }
        isLoggingIn = true; loginError = nil
        Task { do { try await APIClient(baseURL: baseURL).login(password: loginPassword); loginPassword = ""; needsLogin = false; await reload() } catch { loginError = error.localizedDescription }; isLoggingIn = false }
    }
    private func pin(_ agent: AgentSummary, _ pinned: Bool) { guard let baseURL else { return }; Task { await store.setPinned(agent, pinned: pinned, baseURL: baseURL) } }
    private func archive(_ agent: AgentSummary) { guard let baseURL else { return }; Task { do { _ = try await APIClient(baseURL: baseURL).archiveAgent(agentID: agent.id); await reload() } catch { store.error = error.localizedDescription } } }
    private func delete(_ agent: AgentSummary) { guard let baseURL else { return }; Task { do { _ = try await APIClient(baseURL: baseURL).deleteAgent(agentID: agent.id); await reload() } catch { store.error = error.localizedDescription } } }
    private func folderName(_ path: String) -> String { URL(fileURLWithPath: path).lastPathComponent.isEmpty ? "No workspace" : URL(fileURLWithPath: path).lastPathComponent }
}

struct AgentRow: View {
    let agent: AgentSummary
    private var folder: String { URL(fileURLWithPath: agent.workspaceDir).lastPathComponent.isEmpty ? "No workspace" : URL(fileURLWithPath: agent.workspaceDir).lastPathComponent }
    private var projectColor: Color { ProjectColor.color(for: agent.workspaceDir) }
    private var initial: String { String((folder == "No workspace" ? agent.title : folder).prefix(1)).uppercased() }
    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(projectColor.gradient).frame(width: 38, height: 38)
                Text(initial).font(.headline.weight(.semibold)).foregroundStyle(.white)
                if agent.isRunning {
                    TimelineView(.animation(minimumInterval: 0.35)) { timeline in
                        let phase = Int(timeline.date.timeIntervalSinceReferenceDate * 3) % 3
                        HStack(spacing: 2) { ForEach(0..<3, id: \.self) { index in Circle().fill(projectColor).frame(width: 3.5, height: 3.5).opacity(index == phase ? 1 : 0.25) } }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(agent.title).font(.callout.weight(.semibold)).lineLimit(1)
                    if agent.unread > 0 { Text("\(agent.unread)").font(.caption2.bold()).foregroundStyle(.white).padding(.horizontal, 6).frame(minHeight: 19).background(.blue, in: Capsule()) }
                    Spacer(minLength: 4)
                    if agent.pinned { Image(systemName: "pin.fill").font(.caption2).foregroundStyle(.secondary) }
                }
                Text(folder).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
        }.environment(\.defaultMinListRowHeight, 48)
    }
}

private enum ProjectColor {
    static let palette: [Color] = [.blue, .indigo, .purple, .pink, .orange, .teal, .cyan, .mint, .brown]
    static func color(for workspace: String) -> Color {
        var hash: UInt64 = 1469598103934665603
        for byte in workspace.utf8 { hash = (hash ^ UInt64(byte)) &* 1099511628211 }
        return palette[Int(hash % UInt64(palette.count))]
    }
}

struct NativeLoginView: View {
    @Binding var password: String; let error: String?; let isLoading: Bool; let submit: () -> Void; @FocusState private var focused: Bool
    var body: some View { VStack(spacing: 18) { Spacer(); Image(systemName: "lock.shield.fill").font(.system(size: 46)).foregroundStyle(.indigo); Text("Sign in").font(.title2.bold()); SecureField("Password", text: $password).onSubmit(submit).focused($focused).padding(14).background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14)); if let error { Text(error).font(.caption).foregroundStyle(.red) }; Button("Sign in", action: submit).buttonStyle(.borderedProminent).controlSize(.large).disabled(password.isEmpty || isLoading); Spacer() }.padding(24).background(DotLoginBackground()).task { focused = true } }
}
struct DotLoginBackground: View { var body: some View { Color(.systemGroupedBackground).overlay(Canvas { context, size in var path = Path(); for y in stride(from: 8.0, to: size.height, by: 16) { for x in stride(from: 8.0, to: size.width, by: 16) { path.addEllipse(in: .init(x: x-1, y: y-1, width: 2, height: 2)) } }; context.fill(path, with: .color(.secondary.opacity(0.13))) }).ignoresSafeArea() } }
struct NativeSettingsView: View { @Binding var serverURL: String; let connected: () -> Void; @State private var draft: String; @Environment(\.dismiss) private var dismiss; init(serverURL: Binding<String>, connected: @escaping () -> Void) { _serverURL = serverURL; self.connected = connected; _draft = State(initialValue: serverURL.wrappedValue) }; var body: some View { NavigationStack { Form { TextField("Server", text: $draft).textInputAutocapitalization(.never).autocorrectionDisabled(); Button("Connect") { serverURL = draft; connected(); dismiss() } }.navigationTitle("Connection").toolbar { Button("Cancel") { dismiss() } } } } }
