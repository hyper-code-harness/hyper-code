import SwiftUI
import MarkdownUI

struct HyperMarkdownImageProvider: ImageProvider {
    let baseURL: URL
    let workspacePath: String

    func makeImage(url: URL?) -> some View {
        Group {
            if let resolved = resolve(url) {
                AuthenticatedRemoteImage(url: resolved) { image, failed in
                    if let image {
                        Image(uiImage: image).resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 10))
                    } else if failed {
                        Label("Image unavailable", systemImage: "photo.badge.exclamationmark").font(.caption).foregroundStyle(.secondary)
                    } else { ProgressView().frame(maxWidth: .infinity, minHeight: 80) }
                }
            } else { EmptyView() }
        }
    }

    private func resolve(_ url: URL?) -> URL? {
        guard let url else { return nil }
        if url.scheme == "http" || url.scheme == "https" {
            // MarkdownUI resolves relative image paths against the file base URL.
            // Convert those file URLs to Hyper's authenticated raw endpoint.
            if url.isFileURL {
                return rawURL(path: url.standardizedFileURL.path)
            }
            return url
        }
        let raw = url.path.removingPercentEncoding ?? url.path
        let path = raw.hasPrefix("/") ? raw : URL(fileURLWithPath: workspacePath).appendingPathComponent(raw).standardized.path
        return rawURL(path: path)
    }

    private func rawURL(path: String) -> URL? {
        var components = URLComponents(url: baseURL.appending(path: "files/raw"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "path", value: path)]
        return components?.url
    }
}
