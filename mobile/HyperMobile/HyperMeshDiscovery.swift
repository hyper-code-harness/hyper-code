import Foundation

struct HyperMeshCatalogResponse: Decodable {
    struct Identity: Decodable { let user: String; let device: String }
    struct Service: Codable, Identifiable {
        let id: String
        let name: String
        let team: String
        let node: String
        let kind: String
        let url: String
        let online: Bool
        let up: Bool
        let mine: Bool

        var title: String { team.isEmpty ? name : team }
    }
    let who: Identity
    let revision: String
    let services: [Service]
}

@MainActor
final class HyperMeshDiscovery: ObservableObject {
    static let shared = HyperMeshDiscovery()
    static let catalogURL = URL(string: "https://control.hn.hyper-mesh.xyz/v1/net/catalog?kind=hyper")!

    @Published private(set) var services: [HyperMeshCatalogResponse.Service] = []
    @Published private(set) var isRefreshing = false
    @Published private(set) var message: String?

    private let cacheKey = "hyper.mesh.catalog.v1"
    private let revisionKey = "hyper.mesh.catalog.revision.v1"

    private init() {
        if let data = UserDefaults.standard.data(forKey: cacheKey),
           let cached = try? JSONDecoder().decode([HyperMeshCatalogResponse.Service].self, from: data) {
            services = cached
        }
    }

    func refresh(serverStore: ServerProfileStore) async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        var request = URLRequest(url: Self.catalogURL)
        request.timeoutInterval = 12
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let revision = UserDefaults.standard.string(forKey: revisionKey) { request.setValue("\"\(revision)\"", forHTTPHeaderField: "If-None-Match") }
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw DiscoveryError.invalidResponse }
            if http.statusCode == 304 { message = nil; return }
            guard (200..<300).contains(http.statusCode) else { throw DiscoveryError.http(http.statusCode) }
            let catalog = try JSONDecoder().decode(HyperMeshCatalogResponse.self, from: data)
            services = catalog.services
            UserDefaults.standard.set(try? JSONEncoder().encode(catalog.services), forKey: cacheKey)
            UserDefaults.standard.set(catalog.revision, forKey: revisionKey)
            for service in catalog.services { serverStore.upsertDiscovered(name: service.title, url: service.url) }
            message = nil
        } catch {
            let reason: String
            if case DiscoveryError.http(403) = error { reason = "Hypermesh did not recognise this device — is the VPN on and signed in?" }
            else if let urlError = error as? URLError, [.timedOut, .cannotConnectToHost, .cannotFindHost, .notConnectedToInternet, .networkConnectionLost].contains(urlError.code) { reason = "Can’t reach Hypermesh — turn on the Hypermesh VPN and try again." }
            else { reason = error.localizedDescription }
            message = services.isEmpty ? reason : "\(reason) Showing saved workspaces."
        }
    }
}

private enum DiscoveryError: LocalizedError {
    case invalidResponse
    case http(Int)
    var errorDescription: String? {
        switch self { case .invalidResponse: "Invalid Hypermesh response"; case .http(let status): "Hypermesh returned HTTP \(status)" }
    }
}
