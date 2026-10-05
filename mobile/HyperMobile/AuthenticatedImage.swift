import SwiftUI

@MainActor
final class AuthenticatedImageLoader: ObservableObject {
    @Published var image: UIImage?
    @Published var failed = false
    private var task: Task<Void, Never>?

    func load(_ url: URL) {
        guard image == nil, task == nil else { return }
        task = Task {
            do {
                var request = URLRequest(url: url)
                request.cachePolicy = .returnCacheDataElseLoad
                request.timeoutInterval = 30
                request.setValue("image/*", forHTTPHeaderField: "Accept")
                let baseURL = URL(string: "\(url.scheme ?? "https")://\(url.host ?? "")") ?? url
                let (data, response) = try await ServerSessionPool.shared.data(for: request, baseURL: baseURL)
                guard let http = response as? HTTPURLResponse, http.statusCode == 200, let decoded = UIImage(data: data) else { throw URLError(.cannotDecodeContentData) }
                image = decoded
            } catch { failed = true }
            task = nil
        }
    }

    deinit { task?.cancel() }
}

struct AuthenticatedRemoteImage<Content: View>: View {
    let url: URL
    @ViewBuilder let content: (UIImage?, Bool) -> Content
    @StateObject private var loader = AuthenticatedImageLoader()

    var body: some View {
        content(loader.image, loader.failed).task(id: url) { loader.load(url) }
    }
}
