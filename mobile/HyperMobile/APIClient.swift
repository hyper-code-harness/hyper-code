import Foundation

struct APIClient {
    private struct SendBody: Encodable { let text: String; let debounceMs: Int }
    private struct PinBody: Encodable { let pinned: Bool }
    let baseURL: URL
    private struct HealthSamplesBody: Encodable { let kind: String; let samples: [HealthSampleUpload] }

    private struct SleepSyncBody: Encodable { let sessions: [SleepUploadSession] }

    private struct NewsAgentBody: Encodable { let id: String; let prompt: String }
    private struct NewsReadBody: Encodable { let id: String }
    private struct NewsLikeBody: Encodable { let id: String; let liked: Bool }


    private struct LoginBody: Encodable { let password: String }
    private struct LoginResponse: Decodable { let ok: Bool }
    private struct AuthSessionResponse: Decodable { let authenticated: Bool }
    private let session: URLSession
    private struct CreateAgentBody: Encodable { let title: String; let workspaceDir: String; let model: String; let systemPrompt: String; let createWorkspaceDir: Bool }

    private struct ModelBody: Encodable { let model: String }
    private struct InjectBody: Encodable { let text: String; let every: Int }
    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    func login(password: String) async throws {
        let response: LoginResponse = try await request(path: "auth/login", method: "POST", body: LoginBody(password: password))
        guard response.ok else { throw APIClientError.server("Login failed") }
    }

    func sessionIsAuthenticated() async -> Bool {
        do { let response: AuthSessionResponse = try await request(path: "auth/session"); return response.authenticated }
        catch { return false }
    }


    func news(view: String = "unread", source: String? = nil, query: String? = nil, limit: Int = 50) async throws -> NewsResponse {
        var components = URLComponents(url: url("api/mobile/v1/news"), resolvingAgainstBaseURL: false)!
        var items = [URLQueryItem(name: "limit", value: String(limit)), URLQueryItem(name: "view", value: view)]
        if let source, !source.isEmpty { items.append(URLQueryItem(name: "source", value: source)) }
        if let query, !query.isEmpty { items.append(URLQueryItem(name: "q", value: query)) }
        components.queryItems = items
        return try await request(url: components.url!)
    }

    func setNewsLiked(id: String, liked: Bool) async throws -> NewsLikeResponse {
        try await request(path: "api/mobile/v1/news/like", method: "POST", body: NewsLikeBody(id: id, liked: liked))
    }

    func markNewsRead(id: String) async throws {
        let _: ReadNewsResponse = try await request(path: "api/mobile/v1/news/read", method: "POST", body: NewsReadBody(id: id))
    }

    func startNewsAgent(id: String, prompt: String) async throws -> NewsAgentResponse {
        try await request(path: "api/mobile/v1/news/agent", method: "POST", body: NewsAgentBody(id: id, prompt: prompt))
    }



    func healthStatus() async throws -> HealthServerStatus {
        try await request(path: "api/mobile/v1/health/status")
    }


    func syncHealthSamples(kind: String, samples: [HealthSampleUpload]) async throws -> HealthSamplesResponse {
        try await request(path: "api/mobile/v1/health/samples", method: "POST", body: HealthSamplesBody(kind: kind, samples: samples))
    }


    func syncSleep(_ sessions: [SleepUploadSession]) async throws -> SleepSyncResponse {
        try await request(path: "api/mobile/v1/health/sleep", method: "POST", body: SleepSyncBody(sessions: sessions))
    }


    func newAgentOptions() async throws -> NewAgentOptions {
        try await request(path: "api/mobile/v1/new-agent-options")
    }

    func createAgent(title: String, workspaceDir: String, model: String, systemPrompt: String, createWorkspaceDir: Bool = false) async throws -> CreatedAgent {
        let response: CreatedAgentResponse = try await request(path: "api/mobile/v1/agents", method: "POST", body: CreateAgentBody(title: title, workspaceDir: workspaceDir, model: model, systemPrompt: systemPrompt, createWorkspaceDir: createWorkspaceDir))
        return response.agent
    }


    func agents() async throws -> [AgentSummary] {
        let response: AgentsResponse = try await request(path: "api/mobile/v1/agents")
        return response.agents
    }

    func events(agentID: String, after: Int? = nil, before: Int? = nil, limit: Int = 100) async throws -> EventsResponse {
        var components = URLComponents(url: url("api/mobile/v1/agents/\(escaped(agentID))/events"), resolvingAgainstBaseURL: false)!
        var items = [URLQueryItem(name: "limit", value: String(limit))]
        if let after { items.append(URLQueryItem(name: "after", value: String(after))) }
        if let before { items.append(URLQueryItem(name: "before", value: String(before))) }
        components.queryItems = items
        return try await request(url: components.url!)
    }

    func send(agentID: String, text: String, attachments: [PendingAttachment] = []) async throws -> SendResponse {
        if attachments.isEmpty {
            return try await request(path: "api/mobile/v1/agents/\(escaped(agentID))/messages", method: "POST", body: SendBody(text: text, debounceMs: 100))
        }
        let boundary = "HyperBoundary-\(UUID().uuidString)"
        var body = Data()
        func append(_ string: String) { body.append(Data(string.utf8)) }
        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"text\"\r\n\r\n\(text)\r\n")
        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"debounceMs\"\r\n\r\n100\r\n")
        for attachment in attachments {
            append("--\(boundary)\r\nContent-Disposition: form-data; name=\"files\"; filename=\"\(attachment.name.replacingOccurrences(of: "\"", with: ""))\"\r\nContent-Type: \(attachment.contentType)\r\n\r\n")
            body.append(attachment.data); append("\r\n")
        }
        append("--\(boundary)--\r\n")
        var req = URLRequest(url: url("api/mobile/v1/agents/\(escaped(agentID))/messages"))
        req.httpMethod = "POST"; req.timeoutInterval = 120
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        return try await decode(req)
    }

    func inject(agentID: String) async throws -> InjectResponse {
        try await request(path: "api/mobile/v1/agents/\(escaped(agentID))/inject")
    }

    func setInject(agentID: String, text: String, every: Int) async throws -> InjectResponse {
        try await request(path: "api/mobile/v1/agents/\(escaped(agentID))/inject", method: "POST", body: InjectBody(text: text, every: every))
    }


    func changeModel(agentID: String, model: String) async throws -> ModelChangeResponse {
        try await request(path: "api/mobile/v1/agents/\(escaped(agentID))/model", method: "POST", body: ModelBody(model: model))
    }


    func compact(agentID: String) async throws -> CompactResponse {
        try await request(path: "api/mobile/v1/agents/\(escaped(agentID))/compact", method: "POST", body: [String: String]())
    }

    func archiveAgent(agentID: String) async throws -> ArchiveAgentResponse {
        try await request(path: "api/mobile/v1/agents/\(escaped(agentID))/archive", method: "POST", body: [String: String]())
    }


    func deleteAgent(agentID: String) async throws -> DeleteAgentResponse {
        try await request(path: "api/mobile/v1/agents/\(escaped(agentID))", method: "DELETE", body: Optional<String>.none)
    }


    func stop(agentID: String) async throws -> StopResponse {
        try await request(path: "api/mobile/v1/agents/\(escaped(agentID))/stop", method: "POST", body: [String: String]())
    }

    func toolDetail(agentID: String, eventIndex: Int) async throws -> ToolDetail {
        let response: ToolDetailResponse = try await request(path: "api/mobile/v1/agents/\(escaped(agentID))/events/\(eventIndex)")
        return response.event
    }

    func setPinned(agentID: String, pinned: Bool) async throws -> PinResponse {
        try await request(path: "api/mobile/v1/agents/\(escaped(agentID))/pin", method: "POST", body: PinBody(pinned: pinned))
    }

    func markRead(agentID: String) async throws -> ReadResponse {
        try await request(path: "api/mobile/v1/agents/\(escaped(agentID))/read", method: "POST", body: [String: String]())
    }

    private func escaped(_ value: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }
    private func url(_ path: String) -> URL { baseURL.appending(path: path) }

    private func request<T: Decodable, B: Encodable>(path: String, method: String = "GET", body: B? = Optional<String>.none) async throws -> T {
        try await request(url: url(path), method: method, body: body)
    }

    private func request<T: Decodable, B: Encodable>(url: URL, method: String = "GET", body: B? = Optional<String>.none) async throws -> T {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            request.httpBody = try encoder.encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await session.data(for: request)
        return try decode(data: data, response: response)
    }

    private func decode<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await session.data(for: request)
        return try decode(data: data, response: response)
    }

    private func decode<T: Decodable>(data: Data, response: URLResponse) throws -> T {
        guard let http = response as? HTTPURLResponse else { throw APIClientError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            let api = try? JSONDecoder().decode(APIErrorBody.self, from: data)
            throw APIClientError.server(api?.message ?? api?.error ?? "HTTP \(http.statusCode)")
        }
        do {
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            return try decoder.decode(T.self, from: data)
        }
        catch { throw APIClientError.decoding(error.localizedDescription) }
    }
}

enum APIClientError: LocalizedError {
    case invalidResponse, server(String), decoding(String)
    var errorDescription: String? {
        switch self {
        case .invalidResponse: "Invalid server response"
        case .server(let message): message
        case .decoding(let message): "Could not read Hyper response: \(message)"
        }
    }
}
