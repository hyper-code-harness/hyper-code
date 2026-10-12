import Foundation

@MainActor
final class CanvasEventBridge: ObservableObject {
    @Published private(set) var event: WebViewEvent?

    private var streamTask: Task<Void, Never>?
    private var revisionTask: Task<Void, Never>?
    private var lastRevision: String?

    func start(baseURL: URL, agentID: String) {
        stop()
        streamTask = Task { [weak self] in
            guard let self else { return }
            var retryNanoseconds: UInt64 = 1_000_000_000
            while !Task.isCancelled {
                do {
                    try await self.consumeEvents(baseURL: baseURL, agentID: agentID)
                    retryNanoseconds = 1_000_000_000
                } catch is CancellationError {
                    return
                } catch {
                    try? await Task.sleep(nanoseconds: retryNanoseconds)
                    retryNanoseconds = min(retryNanoseconds * 2, 10_000_000_000)
                }
            }
        }
        revisionTask = Task { [weak self] in
            while !Task.isCancelled {
                guard !Task.isCancelled, let self else { return }
                await self.checkRevision(baseURL: baseURL, agentID: agentID)
                try? await Task.sleep(nanoseconds: 20_000_000_000)
            }
        }
    }

    func stop() {
        streamTask?.cancel()
        revisionTask?.cancel()
        streamTask = nil
        revisionTask = nil
        lastRevision = nil
    }

    private func consumeEvents(baseURL: URL, agentID: String) async throws {
        var components = URLComponents(url: baseURL.appending(path: "procs/events"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "topics", value: "agent:\(agentID)")]
        var request = URLRequest(url: components.url!)
        request.timeoutInterval = 60 * 60
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        if let cookie = ServerSessionPool.shared.cookieHeader(for: baseURL) {
            request.setValue(cookie, forHTTPHeaderField: "Cookie")
        }
        let (bytes, response) = try await ServerSessionPool.shared.session(for: baseURL).bytes(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw URLError(.userAuthenticationRequired) }
        for try await line in bytes.lines {
            try Task.checkCancellation()
            guard line.hasPrefix("data: "), let data = line.dropFirst(6).data(using: .utf8),
                  let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  object["type"] as? String == "canvas.changed",
                  object["agentId"] as? String == agentID else { continue }
            publish(object, agentID: agentID)
        }
        throw URLError(.networkConnectionLost)
    }

    private func checkRevision(baseURL: URL, agentID: String) async {
        var request = URLRequest(url: baseURL.appending(path: "canvas/\(agentID)/panel"))
        request.setValue("text/html", forHTTPHeaderField: "Accept")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (data, response) = try? await ServerSessionPool.shared.data(for: request, baseURL: baseURL),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let html = String(data: data, encoding: .utf8),
              let revision = html.firstMatch(of: /data-canvas-rev="([^"]+)"/)?.1 else { return }
        let value = String(revision)
        let changed = lastRevision != value
        lastRevision = value
        guard changed else { return }
        event = WebViewEvent(payload: ["type": "canvas.changed", "agentId": agentID, "rev": value])
    }

    private func publish(_ object: [String: Any], agentID: String) {
        var payload = ["type": "canvas.changed", "agentId": agentID]
        if let revision = object["rev"] as? String {
            payload["rev"] = revision
            lastRevision = revision
        }
        if let open = object["open"] as? Bool { payload["open"] = open ? "true" : "false" }
        event = WebViewEvent(payload: payload)
    }
}
