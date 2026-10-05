import Foundation

struct CachedChatState: Codable {
    var events: [MobileEvent] = []
    var nextAfter = 0
    var olderBefore: Int?
    var hasOlder = false
    var isRunning = false
    var partial: PartialAssistant?
    var updatedAt = Date()
}

struct CachedServerUIState: Codable {
    var agents: [AgentSummary] = []
    var chats: [String: CachedChatState] = [:]
    var drafts: [String: String] = [:]
    var selectedAgentID: String?
    var selectedFolder: String?
    var query = ""
    var updatedAt = Date()
}

@MainActor
final class MobileStateCache {
    static let shared = MobileStateCache()
    private var servers: [String: CachedServerUIState]
    private var saveTask: Task<Void, Never>?
    private let fileURL: URL

    private init() {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("HyperMobile", isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        fileURL = root.appendingPathComponent("ui-state-v1.json")
        if let data = try? Data(contentsOf: fileURL),
           let decoded = try? JSONDecoder().decode([String: CachedServerUIState].self, from: data) {
            servers = decoded
        } else {
            servers = [:]
        }
    }

    func server(_ profileID: String) -> CachedServerUIState { servers[profileID] ?? CachedServerUIState() }
    func chat(profileID: String, agentID: String) -> CachedChatState? { servers[profileID]?.chats[agentID] }
    func draft(profileID: String, agentID: String) -> String { servers[profileID]?.drafts[agentID] ?? "" }

    func updateAgents(_ agents: [AgentSummary], profileID: String) {
        mutate(profileID) { $0.agents = agents }
    }

    func updateChat(_ chat: CachedChatState, profileID: String, agentID: String) {
        mutate(profileID) { state in
            var value = chat
            value.events = Array(chat.events.suffix(500))
            value.updatedAt = Date()
            state.chats[agentID] = value
        }
    }

    func updateDraft(_ draft: String, profileID: String, agentID: String) {
        mutate(profileID) { state in
            if draft.isEmpty { state.drafts.removeValue(forKey: agentID) }
            else { state.drafts[agentID] = draft }
        }
    }

    func updateSelection(profileID: String, agentID: String?) {
        mutate(profileID) { $0.selectedAgentID = agentID }
    }

    func updateListState(profileID: String, folder: String?, query: String) {
        mutate(profileID) { state in state.selectedFolder = folder; state.query = query }
    }

    func removeServer(_ profileID: String) {
        servers.removeValue(forKey: profileID)
        scheduleSave()
    }

    func flush() {
        saveTask?.cancel()
        saveNow()
    }

    static func fallbackProfileID(for baseURL: URL) -> String {
        "url:" + baseURL.absoluteString.lowercased()
    }

    private func mutate(_ profileID: String, _ update: (inout CachedServerUIState) -> Void) {
        var state = servers[profileID] ?? CachedServerUIState()
        update(&state)
        state.updatedAt = Date()
        servers[profileID] = state
        scheduleSave()
    }

    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            self?.saveNow()
        }
    }

    private func saveNow() {
        guard let data = try? JSONEncoder().encode(servers) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }
}
