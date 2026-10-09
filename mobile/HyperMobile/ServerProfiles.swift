import Foundation
import SwiftUI

struct ServerProfile: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var url: String
    let createdAt: Date
    var updatedAt: Date

    var baseURL: URL? { URL(string: url) }
}

enum ServerAuthStatus: String, Codable, Equatable {
    case unknown
    case authenticated
    case signInRequired
}

struct ServerAuthSnapshot: Codable, Hashable {
    var status: ServerAuthStatus
    var userID: String?
    var userName: String?
    var userEmail: String?
    var role: String?
    var checkedAt: Date?

    static let unknown = ServerAuthSnapshot(status: .unknown, userID: nil, userName: nil, userEmail: nil, role: nil, checkedAt: nil)
}

@MainActor
final class ServerProfileStore: ObservableObject {
    /// Placeholder while no server is known yet: there is NO built-in default — servers come from Hypermesh discovery (VPN on) or are added by hand.
    static let none = ServerProfile(id: "", name: "No server", url: "", createdAt: .distantPast, updatedAt: .distantPast)

    @Published private(set) var profiles: [ServerProfile]
    @Published private(set) var selectedID: String
    @Published private(set) var authByProfile: [String: ServerAuthSnapshot]
    @Published private(set) var trustedHealthProfileID: String

    private let defaults: UserDefaults
    private let profilesKey = "hyper.serverProfiles.v1"
    private let selectedKey = "hyper.selectedServerProfile.v1"
    private let authKey = "hyper.serverAuthState.v1"
    private let healthKey = "hyper.trustedHealthServerProfile.v1"
    private let legacyURLKey = "hyper.serverURL"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let loadedProfiles: [ServerProfile]
        if let data = defaults.data(forKey: profilesKey),
           let decoded = try? decoder.decode([ServerProfile].self, from: data),
           !decoded.isEmpty {
            loadedProfiles = decoded
        } else if let raw = defaults.string(forKey: legacyURLKey), let legacy = Self.normalizedURL(raw) {
            let now = Date()
            loadedProfiles = [ServerProfile(id: UUID().uuidString, name: Self.suggestedName(for: legacy), url: legacy, createdAt: now, updatedAt: now)]
        } else {
            loadedProfiles = []
        }
        profiles = loadedProfiles

        let requested = defaults.string(forKey: selectedKey)
        let initialSelectedID = loadedProfiles.contains(where: { $0.id == requested }) ? requested! : (loadedProfiles.first?.id ?? "")
        selectedID = initialSelectedID
        let requestedHealth = defaults.string(forKey: healthKey)
        trustedHealthProfileID = loadedProfiles.contains(where: { $0.id == requestedHealth }) ? requestedHealth! : initialSelectedID
        if let data = defaults.data(forKey: authKey), let decoded = try? decoder.decode([String: ServerAuthSnapshot].self, from: data) {
            authByProfile = decoded.filter { id, _ in loadedProfiles.contains(where: { $0.id == id }) }
        } else {
            authByProfile = [:]
        }
        persist()
    }

    var hasServers: Bool { !profiles.isEmpty }
    var selectedProfile: ServerProfile { profiles.first(where: { $0.id == selectedID }) ?? profiles.first ?? Self.none }
    var selectedURL: URL? { selectedProfile.baseURL }
    var trustedHealthProfile: ServerProfile { profiles.first(where: { $0.id == trustedHealthProfileID }) ?? profiles.first ?? Self.none }
    var trustedHealthURL: URL? { trustedHealthProfile.baseURL }

    func auth(for profileID: String) -> ServerAuthSnapshot {
        authByProfile[profileID] ?? .unknown
    }

    func select(_ profileID: String) {
        guard profiles.contains(where: { $0.id == profileID }), selectedID != profileID else { return }
        selectedID = profileID
        persist()
    }

    func setTrustedHealthServer(_ profileID: String) {
        guard profiles.contains(where: { $0.id == profileID }) else { return }
        trustedHealthProfileID = profileID
        persist()
    }

    @discardableResult
    func add(name: String, url: String) throws -> ServerProfile {
        guard let normalized = Self.normalizedURL(url) else { throw ServerProfileError.invalidURL }
        if let existing = profiles.first(where: { $0.url.caseInsensitiveCompare(normalized) == .orderedSame }) {
            select(existing.id)
            return existing
        }
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let now = Date()
        let profile = ServerProfile(id: UUID().uuidString, name: cleanName.isEmpty ? Self.suggestedName(for: normalized) : cleanName, url: normalized, createdAt: now, updatedAt: now)
        profiles.append(profile)
        selectedID = profile.id
        if !profiles.contains(where: { $0.id == trustedHealthProfileID }) { trustedHealthProfileID = profile.id }
        authByProfile[profile.id] = .unknown
        persist()
        return profile
    }

    func upsertDiscovered(name: String, url: String) {
        guard let normalized = Self.normalizedURL(url) else { return }
        if let index = profiles.firstIndex(where: { $0.url.caseInsensitiveCompare(normalized) == .orderedSame }) {
            let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
            if !cleanName.isEmpty, profiles[index].name != cleanName {
                profiles[index].name = cleanName
                profiles[index].updatedAt = Date()
                persist()
            }
            return
        }
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let now = Date()
        let profile = ServerProfile(id: UUID().uuidString, name: cleanName.isEmpty ? Self.suggestedName(for: normalized) : cleanName, url: normalized, createdAt: now, updatedAt: now)
        profiles.append(profile)
        authByProfile[profile.id] = .unknown
        if !profiles.contains(where: { $0.id == selectedID }) { selectedID = profile.id }
        if !profiles.contains(where: { $0.id == trustedHealthProfileID }) { trustedHealthProfileID = selectedID }
        persist()
    }


    func update(_ profileID: String, name: String, url: String) throws {
        guard let index = profiles.firstIndex(where: { $0.id == profileID }) else { return }
        guard let normalized = Self.normalizedURL(url) else { throw ServerProfileError.invalidURL }
        if profiles.contains(where: { $0.id != profileID && $0.url.caseInsensitiveCompare(normalized) == .orderedSame }) {
            throw ServerProfileError.duplicateURL
        }
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let previousURL = profiles[index].baseURL
        let changedOrigin = profiles[index].url != normalized
        profiles[index].name = cleanName.isEmpty ? Self.suggestedName(for: normalized) : cleanName
        profiles[index].url = normalized
        profiles[index].updatedAt = Date()
        if changedOrigin {
            if let previousURL { ServerSessionPool.shared.clear(baseURL: previousURL) }
            MobileStateCache.shared.removeServer(profileID)
            authByProfile[profileID] = .unknown
        }
        persist()
    }

    func delete(_ profileID: String) throws {
        guard profiles.count > 1 else { throw ServerProfileError.lastProfile }
        guard let index = profiles.firstIndex(where: { $0.id == profileID }) else { return }
        profiles.remove(at: index)
        MobileStateCache.shared.removeServer(profileID)
        authByProfile.removeValue(forKey: profileID)
        if selectedID == profileID { selectedID = profiles[min(index, profiles.count - 1)].id }
        if trustedHealthProfileID == profileID { trustedHealthProfileID = selectedID }
        persist()
    }

    func updateAuth(profileID: String, session: APIClient.AuthSession) {
        guard profiles.contains(where: { $0.id == profileID }) else { return }
        authByProfile[profileID] = ServerAuthSnapshot(
            status: session.authenticated ? .authenticated : .signInRequired,
            userID: session.user?.id,
            userName: session.user?.name,
            userEmail: session.user?.email,
            role: session.user?.role,
            checkedAt: Date()
        )
        persist()
    }

    func markSignedOut(_ profileID: String) {
        authByProfile[profileID] = ServerAuthSnapshot(status: .signInRequired, userID: nil, userName: nil, userEmail: nil, role: nil, checkedAt: Date())
        persist()
    }

    private func persist() {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        if let data = try? encoder.encode(profiles) { defaults.set(data, forKey: profilesKey) }
        if let data = try? encoder.encode(authByProfile) { defaults.set(data, forKey: authKey) }
        defaults.set(selectedID, forKey: selectedKey)
        defaults.set(trustedHealthProfileID, forKey: healthKey)
        if selectedProfile.url.isEmpty { defaults.removeObject(forKey: legacyURLKey) } else { defaults.set(selectedProfile.url, forKey: legacyURLKey) }
    }

    private static func normalizedURL(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var components = URLComponents(string: trimmed),
              let scheme = components.scheme?.lowercased(), ["http", "https"].contains(scheme),
              components.host != nil else { return nil }
        components.scheme = scheme
        components.host = components.host?.lowercased()
        components.query = nil
        components.fragment = nil
        while components.path.count > 1 && components.path.hasSuffix("/") { components.path.removeLast() }
        return components.url?.absoluteString
    }

    private static func suggestedName(for url: String) -> String {
        guard let host = URL(string: url)?.host else { return "Hyper" }
        return host.replacingOccurrences(of: ".local", with: "")
    }
}

enum ServerProfileError: LocalizedError {
    case invalidURL
    case duplicateURL
    case lastProfile

    var errorDescription: String? {
        switch self {
        case .invalidURL: "Enter a valid HTTP or HTTPS Hyper URL."
        case .duplicateURL: "This Hyper server is already in the list."
        case .lastProfile: "At least one Hyper server must remain."
        }
    }
}

struct ServerSwitcherMenu: View {
    @EnvironmentObject private var servers: ServerProfileStore
    @State private var isPresented = false
    let manage: () -> Void

    var body: some View {
        Button { isPresented.toggle() } label: {
            Image(systemName: "server.rack")
        }
        .accessibilityLabel("Switch Hyper server")
        .popover(isPresented: $isPresented, attachmentAnchor: .rect(.bounds), arrowEdge: .top) {
            NavigationStack {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(servers.profiles) { profile in
                                Button {
                                    servers.select(profile.id)
                                    isPresented = false
                                } label: {
                                    HStack(spacing: 12) {
                                        Image(systemName: profile.id == servers.selectedID ? "checkmark.circle.fill" : authIcon(profile.id))
                                            .foregroundStyle(profile.id == servers.selectedID ? .blue : authColor(profile.id))
                                            .frame(width: 22)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(profile.name).foregroundStyle(.primary).lineLimit(1)
                                            Text(profile.baseURL?.host ?? profile.url).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                        }
                                        Spacer(minLength: 12)
                                    }
                                    .contentShape(Rectangle())
                                    .padding(.horizontal, 16)
                                    .frame(minHeight: 56)
                                }
                                .buttonStyle(.plain)
                                .id(profile.id)
                                if profile.id != servers.profiles.last?.id { Divider().padding(.leading, 50) }
                            }
                        }
                    }
                    .onAppear { proxy.scrollTo(servers.selectedID, anchor: .center) }
                }
                .safeAreaInset(edge: .bottom) {
                    Button {
                        isPresented = false
                        manage()
                    } label: {
                        Label("Manage Servers", systemImage: "server.rack")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .padding(12)
                    .background(.bar)
                }
                .navigationTitle("Hyper Servers")
                .navigationBarTitleDisplayMode(.inline)
            }
            .frame(minWidth: 320, idealWidth: 360, minHeight: 320, idealHeight: 520, maxHeight: 620)
            .presentationCompactAdaptation(.popover)
        }
    }
    private func authIcon(_ profileID: String) -> String {
        switch servers.auth(for: profileID).status {
        case .authenticated: "circle.fill"
        case .signInRequired: "exclamationmark.circle.fill"
        case .unknown: "circle.dotted"
        }
    }

    private func authColor(_ profileID: String) -> Color {
        switch servers.auth(for: profileID).status {
        case .authenticated: .green
        case .signInRequired: .orange
        case .unknown: .secondary
        }
    }


}

struct ServerProfilesView: View {
    @EnvironmentObject private var servers: ServerProfileStore
    @StateObject private var discovery = HyperMeshDiscovery.shared
    @Environment(\.dismiss) private var dismiss
    @State private var editor: ServerEditorTarget?
    @State private var pendingDelete: ServerProfile?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if discovery.isRefreshing { HStack { ProgressView(); Text("Looking for Hyper workspaces…") } }
                    else { Button("Discover from Hypermesh", systemImage: "point.3.connected.trianglepath.dotted") { Task { await discovery.refresh(serverStore: servers) } } }
                    if let message = discovery.message { Text(message).font(.caption).foregroundStyle(.secondary) }
                } header: { Text("Hypermesh") } footer: { Text("With Hypermesh VPN enabled, allowed workspaces are added automatically. No catalog token is stored.") }
                Section {
                    Picker("Health uploads", selection: Binding(get: { servers.trustedHealthProfileID }, set: { servers.setTrustedHealthServer($0) })) {
                        ForEach(servers.profiles) { profile in Text(profile.name).tag(profile.id) }
                    }
                } header: {
                    Text("Trusted Health Server")
                } footer: {
                    Text("Apple Health data is uploaded only to this Hyper. Switching workspaces does not change the destination.")
                }
                Section("Workspaces") {
                ForEach(servers.profiles) { profile in
                    Button { servers.select(profile.id) } label: {
                        HStack(spacing: 12) {
                            Image(systemName: profile.id == servers.selectedID ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(profile.id == servers.selectedID ? .blue : .secondary)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(profile.name).font(.headline).foregroundStyle(.primary)
                                Text(profile.url).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                authLabel(profile.id)
                                if profile.id == servers.trustedHealthProfileID {
                                    Label("Health destination", systemImage: "heart.fill").font(.caption2).foregroundStyle(.pink)
                                }
                            }
                            Spacer()
                            Button { editor = ServerEditorTarget(profile: profile) } label: { Image(systemName: "pencil") }
                                .buttonStyle(.borderless).accessibilityLabel("Edit \(profile.name)")
                        }
                    }
                    .swipeActions {
                        Button("Delete", role: .destructive) { pendingDelete = profile }.disabled(servers.profiles.count == 1)
                        Button("Edit") { editor = ServerEditorTarget(profile: profile) }.tint(.blue)
                        Button("Health") { servers.setTrustedHealthServer(profile.id) }.tint(.pink)
                    }
                }
                }
            }
            .navigationTitle("Hyper Servers")
            .task { await discovery.refresh(serverStore: servers) }
            .refreshable { await discovery.refresh(serverStore: servers) }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .primaryAction) { Button { editor = ServerEditorTarget(profile: nil) } label: { Image(systemName: "plus") } }
            }
            .sheet(item: $editor) { target in ServerProfileEditor(profile: target.profile) }
            .confirmationDialog("Remove \(pendingDelete?.name ?? "server")?", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }), titleVisibility: .visible) {
                Button("Remove Server", role: .destructive) {
                    if let profile = pendingDelete { do { try servers.delete(profile.id) } catch { self.error = error.localizedDescription } }
                    pendingDelete = nil
                }
                Button("Cancel", role: .cancel) { pendingDelete = nil }
            } message: { Text("The server profile and its local authentication state will be removed. Server data is not deleted. Health data never moves to another server unless you explicitly change the trusted destination above.") }
            .alert("Couldn’t update servers", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) { Button("OK") { error = nil } } message: { Text(error ?? "Unknown error") }
        }
    }

    @ViewBuilder private func authLabel(_ id: String) -> some View {
        let auth = servers.auth(for: id)
        switch auth.status {
        case .authenticated:
            Label(auth.userName ?? "Signed in", systemImage: "person.crop.circle.fill").font(.caption2).foregroundStyle(.green)
        case .signInRequired:
            Label("Sign in required", systemImage: "person.crop.circle.badge.exclamationmark").font(.caption2).foregroundStyle(.orange)
        case .unknown:
            Label("Not checked", systemImage: "questionmark.circle").font(.caption2).foregroundStyle(.tertiary)
        }
    }
}

private struct ServerEditorTarget: Identifiable {
    let id = UUID()
    let profile: ServerProfile?
}

private struct ServerProfileEditor: View {
    @EnvironmentObject private var servers: ServerProfileStore
    @Environment(\.dismiss) private var dismiss
    let profile: ServerProfile?
    @State private var name: String
    @State private var url: String
    @State private var error: String?

    init(profile: ServerProfile?) {
        self.profile = profile
        _name = State(initialValue: profile?.name ?? "")
        _url = State(initialValue: profile?.url ?? "https://")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    TextField("Name", text: $name)
                    TextField("https://hyper.example.com", text: $url)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                }
                if let error { Text(error).font(.caption).foregroundStyle(.red) }
            }
            .navigationTitle(profile == nil ? "Add Hyper" : "Edit Hyper")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save", action: save).fontWeight(.semibold) }
            }
        }
        .presentationDetents([.medium])
    }

    private func save() {
        do {
            if let profile { try servers.update(profile.id, name: name, url: url) }
            else { try servers.add(name: name, url: url) }
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
