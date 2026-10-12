import Foundation

@MainActor
final class CanvasEventBridge: ObservableObject {
    @Published private(set) var revision = UUID()

    private var pollingTask: Task<Void, Never>?
    private var lastRevision: String?

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

    private func check(baseURL: URL, agentID: String) async {
        var request = URLRequest(url: baseURL.appending(path: "canvas/\(agentID)/panel"))
        request.timeoutInterval = 10
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("text/html", forHTTPHeaderField: "Accept")
        guard let (data, response) = try? await ServerSessionPool.shared.data(for: request, baseURL: baseURL),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let html = String(data: data, encoding: .utf8),
              let current = html.firstMatch(of: /data-canvas-rev="([^"]+)"/)?.1 else { return }
        let value = String(current)
        defer { lastRevision = value }
        guard let lastRevision, lastRevision != value else { return }
        revision = UUID()
    }
}
