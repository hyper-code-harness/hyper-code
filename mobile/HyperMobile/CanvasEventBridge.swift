import Foundation

struct CanvasTab: Identifiable, Equatable {
    let id: Int
    let title: String
}

@MainActor
final class CanvasEventBridge: ObservableObject {
    @Published private(set) var revision = UUID()
    @Published private(set) var tabs: [CanvasTab] = []
    @Published private(set) var activeTabID: Int?

    private var pollingTask: Task<Void, Never>?
    private var lastRevision: String?

    var canSelectPrevious: Bool {
        guard let activeTabID, let index = tabs.firstIndex(where: { $0.id == activeTabID }) else { return false }
        return index > 0
    }

    var canSelectNext: Bool {
        guard let activeTabID, let index = tabs.firstIndex(where: { $0.id == activeTabID }) else { return false }
        return index + 1 < tabs.count
    }

    func start(baseURL: URL, agentID: String) {
        stop()
        pollingTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.check(baseURL: baseURL, agentID: agentID)
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }

    func stop() {
        pollingTask?.cancel()
        pollingTask = nil
        lastRevision = nil
    }

    func selectPrevious(baseURL: URL, agentID: String) {
        guard let activeTabID, let index = tabs.firstIndex(where: { $0.id == activeTabID }), index > 0 else { return }
        select(tabs[index - 1].id, baseURL: baseURL, agentID: agentID)
    }

    func selectNext(baseURL: URL, agentID: String) {
        guard let activeTabID, let index = tabs.firstIndex(where: { $0.id == activeTabID }), index + 1 < tabs.count else { return }
        select(tabs[index + 1].id, baseURL: baseURL, agentID: agentID)
    }

    private func select(_ itemID: Int, baseURL: URL, agentID: String) {
        Task {
            var request = URLRequest(url: baseURL.appending(path: "canvas/\(agentID)"))
            request.httpMethod = "POST"
            request.timeoutInterval = 10
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.httpBody = try? JSONSerialization.data(withJSONObject: ["activeItemId": itemID])
            guard let (_, response) = try? await ServerSessionPool.shared.data(for: request, baseURL: baseURL),
                  (response as? HTTPURLResponse)?.statusCode == 200 else { return }
            activeTabID = itemID
            await check(baseURL: baseURL, agentID: agentID)
        }
    }

    private func check(baseURL: URL, agentID: String) async {
        var request = URLRequest(url: baseURL.appending(path: "canvas/\(agentID)/panel"))
        request.timeoutInterval = 10
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("text/html", forHTTPHeaderField: "Accept")
        guard let (data, response) = try? await ServerSessionPool.shared.data(for: request, baseURL: baseURL),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let html = String(data: data, encoding: .utf8),
              let current = html.firstMatch(of: /data-canvas-rev="([^"]+)"/)?.1 else { return }
        let newTabs = Self.parseTabs(from: html)
        if tabs != newTabs { tabs = newTabs }
        let newActiveTabID = html.firstMatch(of: /data-canvas-item="([0-9]+)"/).flatMap { Int(String($0.1)) }
        if activeTabID != newActiveTabID { activeTabID = newActiveTabID }
        let value = String(current)
        defer { lastRevision = value }
        guard let lastRevision else { return }
        guard lastRevision != value else { return }
        revision = UUID()
    }

    /// Reads the stable Canvas tab hooks emitted by both the legacy markup and the current w.tabs markup.
    /// Current tabs put `data-canvas-tab` and `title` on the same button and no longer emit
    /// `data-canvas-select`; keeping that old hook optional preserves compatibility with older servers.
    static func parseTabs(from html: String) -> [CanvasTab] {
        html.matches(of: /<button\b(?=[^>]*\bdata-canvas-tab="([0-9]+)")(?=[^>]*\btitle="([^"]*)")[^>]*>/).compactMap { match in
            guard let id = Int(match.1) else { return nil }
            return CanvasTab(id: id, title: String(match.2).split(separator: " · ").first.map(String.init) ?? "Canvas")
        }
    }

}
