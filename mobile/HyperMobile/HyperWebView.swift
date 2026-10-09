import SwiftUI
import UIKit
import WebKit

enum WebNavigationAction { case back, forward, reload }

struct WebNavigationCommand: Equatable {
    let id = UUID()
    let action: WebNavigationAction
    static func == (lhs: Self, rhs: Self) -> Bool { lhs.id == rhs.id }
}

struct HyperWebView: UIViewRepresentable {
    let urlString: String
    var authenticatedBaseURL: URL? = nil
    let command: WebNavigationCommand?
    @Binding var isLoading: Bool
    @Binding var canGoBack: Bool
    @Binding var canGoForward: Bool

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = authenticatedBaseURL == nil ? .default() : .nonPersistent()
        configuration.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.keyboardDismissMode = .interactive
        webView.isInspectable = true
        context.coordinator.webView = webView
        context.coordinator.load(urlString, in: webView, authenticatedBaseURL: authenticatedBaseURL)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.parent = self
        if context.coordinator.requestedURL != urlString {
            context.coordinator.load(urlString, in: webView, authenticatedBaseURL: authenticatedBaseURL)
        }
        if let command, context.coordinator.lastCommand != command.id {
            context.coordinator.lastCommand = command.id
            switch command.action {
            case .back: if webView.canGoBack { webView.goBack() }
            case .forward: if webView.canGoForward { webView.goForward() }
            case .reload: webView.reload()
            }
        }
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var parent: HyperWebView
        weak var webView: WKWebView?
        var requestedURL = ""
        var lastCommand: UUID?
        var authenticatedBaseURL: URL?

        init(parent: HyperWebView) { self.parent = parent }

        func load(_ value: String, in webView: WKWebView, authenticatedBaseURL: URL?) {
            requestedURL = value
            guard let url = URL(string: value), url.scheme != nil else {
                webView.loadHTMLString(Self.errorPage("Invalid server URL"), baseURL: nil)
                update(loading: false, webView: webView)
                return
            }
            self.authenticatedBaseURL = authenticatedBaseURL
            guard let authenticatedBaseURL else {
                webView.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData))
                return
            }
            let cookies = ServerSessionPool.shared.webCookies(for: authenticatedBaseURL)
            let group = DispatchGroup()
            for cookie in cookies {
                group.enter()
                webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { group.leave() }
            }
            group.notify(queue: .main) {
                guard self.requestedURL == value else { return }
                webView.load(self.authenticatedRequest(url: url, baseURL: authenticatedBaseURL))
            }
        }

        private func authenticatedRequest(url: URL, baseURL: URL) -> URLRequest {
            var request = URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData)
            request.setValue("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", forHTTPHeaderField: "Accept")
            request.setValue("1", forHTTPHeaderField: "X-Hyper-Native-Auth")
            if let cookie = ServerSessionPool.shared.cookieHeader(for: baseURL) {
                request.setValue(cookie, forHTTPHeaderField: "Cookie")
            }
            return request
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let baseURL = authenticatedBaseURL,
                  let url = navigationAction.request.url,
                  ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
                  url.host?.lowercased() == baseURL.host?.lowercased(),
                  navigationAction.request.value(forHTTPHeaderField: "X-Hyper-Native-Auth") != "1",
                  let cookie = ServerSessionPool.shared.cookieHeader(for: baseURL) else {
                decisionHandler(.allow)
                return
            }
            var request = navigationAction.request
            request.setValue(cookie, forHTTPHeaderField: "Cookie")
            request.setValue("1", forHTTPHeaderField: "X-Hyper-Native-Auth")
            decisionHandler(.cancel)
            webView.load(request)
        }


        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            update(loading: true, webView: webView)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            update(loading: false, webView: webView)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            show(error, in: webView)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            show(error, in: webView)
        }

        private func show(_ error: Error, in webView: WKWebView) {
            webView.loadHTMLString(Self.errorPage((error as NSError).localizedDescription), baseURL: nil)
            update(loading: false, webView: webView)
        }

        private func update(loading: Bool, webView: WKWebView) {
            DispatchQueue.main.async {
                self.parent.isLoading = loading
                self.parent.canGoBack = webView.canGoBack
                self.parent.canGoForward = webView.canGoForward
            }
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction,
                     windowFeatures: WKWindowFeatures) -> WKWebView? {
            if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
                UIApplication.shared.open(url)
            }
            return nil
        }

        private static func errorPage(_ message: String) -> String {
            let escaped = message
                .replacingOccurrences(of: "&", with: "&amp;")
                .replacingOccurrences(of: "<", with: "&lt;")
                .replacingOccurrences(of: ">", with: "&gt;")
            return """
            <!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
            <style>body{font:17px -apple-system;padding:64px 24px;background:#111;color:#eee}p{color:#aaa;line-height:1.45}code{color:#8bd}</style>
            <h2>Can’t connect to Hyper</h2><p>\(escaped)</p><p>Start Hyper on the Mac and check <code>http://localhost:3010</code> in Settings.</p>
            """
        }
    }
}
