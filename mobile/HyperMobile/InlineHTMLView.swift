import SwiftUI
import WebKit

struct InlineHTMLView: UIViewRepresentable {
    let html: String
    @Binding var height: CGFloat

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let view = WKWebView(frame: .zero, configuration: config)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        view.navigationDelegate = context.coordinator
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) {
        guard context.coordinator.lastHTML != html else { return }
        context.coordinator.lastHTML = html
        view.loadHTMLString("""
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>html,body{margin:0;padding:0;background:transparent;color:inherit;font:15px -apple-system;line-height:1.45}svg,img{max-width:100%;height:auto}pre{white-space:pre-wrap}*{box-sizing:border-box}</style>
        <div id="content">\(html)</div>
        """, baseURL: nil)
    }
    func makeCoordinator() -> Coordinator { Coordinator(height: $height) }
    final class Coordinator: NSObject, WKNavigationDelegate {
        @Binding var height: CGFloat
        var lastHTML = ""
        init(height: Binding<CGFloat>) { _height = height }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            webView.evaluateJavaScript("Math.ceil(document.documentElement.scrollHeight)") { value, _ in
                if let value = value as? NSNumber { DispatchQueue.main.async { self.height = max(1, value.doubleValue) } }
            }
        }
    }
}
