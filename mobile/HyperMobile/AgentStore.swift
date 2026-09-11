import Foundation
import SwiftUI

@MainActor
final class AgentListStore: ObservableObject {
    @Published var agents: [AgentSummary] = []
    @Published var isLoading = false
    @Published var error: String?
    private var refreshTask: Task<Void, Never>?

    func setPinned(_ agent: AgentSummary, pinned: Bool, baseURL: URL) async {
        do { _ = try await APIClient(baseURL: baseURL).setPinned(agentID: agent.id, pinned: pinned); await load(baseURL: baseURL) }
        catch { self.error = error.localizedDescription }
    }


    func startRefreshing(baseURL: URL) {
        refreshTask?.cancel()
        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                guard let self, !Task.isCancelled else { break }
                await self.load(baseURL: baseURL, showLoading: false)
            }
        }
    }

    func stopRefreshing() { refreshTask?.cancel(); refreshTask = nil }

    func load(baseURL: URL, showLoading: Bool = true) async {
        if showLoading { isLoading = true }
        defer { if showLoading { isLoading = false } }
        do { agents = try await APIClient(baseURL: baseURL).agents(); error = nil }
        catch { self.error = error.localizedDescription }
    }
}

@MainActor
final class ChatStore: ObservableObject {
    @Published var events: [MobileEvent] = []
    @Published var isLoading = false
    @Published var isSending = false
    @Published var isRunning = false
    @Published var error: String?
    @Published var partial: PartialAssistant?
    @Published var pendingUserEvent: MobileEvent?
    @Published var hasOlder = false
    @Published var isLoadingOlder = false
    @Published var historyRevision = 0
    @Published var historyAnchorID: Int?
    private var nextAfter = 0
    private var pollTask: Task<Void, Never>?
    private var pollInFlight = false
    private var olderBefore: Int?

    func start(baseURL: URL, agentID: String) async {
        pollTask?.cancel()
        isLoading = true
        do {
            let page = try await APIClient(baseURL: baseURL).events(agentID: agentID, limit: 100)
            _ = try? await APIClient(baseURL: baseURL).markRead(agentID: agentID)
            events = page.events
            olderBefore = page.olderBefore
            hasOlder = page.hasOlder
            nextAfter = page.nextAfter
            isRunning = page.isRunning
            error = nil
            partial = page.partial
        } catch { self.error = error.localizedDescription }
        isLoading = false
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(self?.isRunning == true ? 1 : 3))
                guard let self, !Task.isCancelled else { break }
                await self.poll(baseURL: baseURL, agentID: agentID)
            }
        }
    }

    func loadOlder(baseURL: URL, agentID: String) async {
        guard hasOlder, !isLoadingOlder, let before = olderBefore else { return }
        isLoadingOlder = true; defer { isLoadingOlder = false }
        do {
            let previousFirst = events.first?.idx
            let page = try await APIClient(baseURL: baseURL).events(agentID: agentID, before: before, limit: 100)
            merge(page.events)
            olderBefore = page.olderBefore
            hasOlder = page.hasOlder
            historyAnchorID = previousFirst
            historyRevision += 1
        } catch { self.error = error.localizedDescription }
    }

    func stopPolling() { pollTask?.cancel(); pollTask = nil }

    func send(_ text: String, attachments: [PendingAttachment] = [], baseURL: URL, agentID: String) async -> Bool {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (!value.isEmpty || !attachments.isEmpty), !isSending else { return false }
        isSending = true
        isRunning = true
        let optimisticAttachments = attachments.map { EventAttachment(id: $0.id.uuidString, name: $0.name, contentType: $0.contentType, size: $0.data.count) }
        pendingUserEvent = MobileEvent(idx: Int.min, ts: Date().timeIntervalSince1970 * 1000, type: "user", text: value, name: nil, preview: value, isError: false, attachments: optimisticAttachments)
        defer { isSending = false }
        do {
            let response = try await APIClient(baseURL: baseURL).send(agentID: agentID, text: value, attachments: attachments)
            let canonical = MobileEvent(idx: response.eventIdx, ts: pendingUserEvent?.ts ?? Date().timeIntervalSince1970 * 1000, type: "user", text: value, name: nil, preview: value, isError: false, attachments: optimisticAttachments)
            pendingUserEvent = nil
            merge([canonical])
            nextAfter = max(nextAfter, response.eventIdx + 1)
            partial = nil
            error = nil
            return true
        } catch {
            pendingUserEvent = nil
            isRunning = false
            self.error = error.localizedDescription
            return false
        }
    }

    func stop(baseURL: URL, agentID: String) async {
        do { _ = try await APIClient(baseURL: baseURL).stop(agentID: agentID); isRunning = false; await poll(baseURL: baseURL, agentID: agentID) }
        catch { self.error = error.localizedDescription }
    }

    private func poll(baseURL: URL, agentID: String) async {
        guard !pollInFlight else { return }
        pollInFlight = true
        defer { pollInFlight = false }
        do {
            let page = try await APIClient(baseURL: baseURL).events(agentID: agentID, after: nextAfter, limit: 200)
            merge(page.events)
            nextAfter = max(nextAfter, page.nextAfter)
            isRunning = page.isRunning
            error = nil
            partial = page.partial
        } catch { self.error = error.localizedDescription }
    }

    private func merge(_ incoming: [MobileEvent]) {
        guard !incoming.isEmpty else { return }
        var byIndex = Dictionary(uniqueKeysWithValues: events.map { ($0.idx, $0) })
        for event in incoming { byIndex[event.idx] = event }
        events = byIndex.values.sorted { $0.idx < $1.idx }
    }
}
