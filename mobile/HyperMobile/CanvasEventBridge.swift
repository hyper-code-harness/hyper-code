import Foundation

@MainActor
final class CanvasEventBridge: ObservableObject {
    @Published private(set) var event: WebViewEvent?

    private var watchTask: Task<Void, Never>?

    func start(baseURL: URL, agentID: String) {
        stop()
        watchTask = Task { [weak self] in
            guard let self else { return }
            var revision = ""
            var retryNanoseconds: UInt64 = 500_000_000
            while !Task.isCancelled {
                do {
                    let result = try await self.watch(baseURL: baseURL, agentID: agentID, revision: revision)
                    let previous = revision
                    revision = result.rev
                    retryNanoseconds = 500_000_000
                    if result.changed || (!previous.isEmpty && previous != result.rev) {
                        self.event = WebViewEvent(payload: [
                            "type": "canvas.changed",
                            "agentId": agentID,
                            "rev": result.rev,
                        ])
                    }
                } catch is CancellationError {
                    return
                } catch {
                    try? await Task.sleep(nanoseconds: retryNanoseconds)
                    retryNanoseconds = min(retryNanoseconds * 2, 5_000_000_000)
                }
            }
        }
    }

    func stop() {
        watchTask?.cancel()
        watchTask = nil
    }

    private func watch(baseURL: URL, agentID: String, revision: String) async throws -> WatchResponse {
        var components = URLComponents(url: baseURL.appending(path: "canvas/\(agentID)/watch"), resolvingAgainstBaseURL: false)!
        if !revision.isEmpty {
            components.queryItems = [URLQueryItem(name: "rev", value: revision)]
        }
        var request = URLRequest(url: components.url!)
        request.timeoutInterval = 35
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await ServerSessionPool.shared.data(for: request, baseURL: baseURL)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(WatchResponse.self, from: data)
    }

    private struct WatchResponse: Decodable {
        let rev: String
        let changed: Bool
    }
}
