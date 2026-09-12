import SwiftUI

struct FileBrowserView: View {
    let baseURL: URL
    let workspacePath: String
    @Environment(\.dismiss) private var dismiss
    @State private var isLoading = true
    @State private var canGoBack = false
    @State private var canGoForward = false
    @State private var command: WebNavigationCommand?

    private var url: String {
        let encoded = workspacePath.split(separator: "/").map { String($0).addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? String($0) }.joined(separator: "/")
        return baseURL.appending(path: "files/absolute/\(encoded)").absoluteString
    }

    var body: some View {
        NavigationStack {
            HyperWebView(urlString: url, command: command, isLoading: $isLoading, canGoBack: $canGoBack, canGoForward: $canGoForward)
                .navigationTitle("Files")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                    ToolbarItemGroup(placement: .bottomBar) {
                        Button { command = .init(action: .back) } label: { Image(systemName: "chevron.backward") }.disabled(!canGoBack)
                        Button { command = .init(action: .forward) } label: { Image(systemName: "chevron.forward") }.disabled(!canGoForward)
                        Spacer()
                        if isLoading { ProgressView().controlSize(.small) }
                        Button { command = .init(action: .reload) } label: { Image(systemName: "arrow.clockwise") }
                    }
                }
        }
    }
}
