import AuthenticationServices
import Foundation
import UIKit

@MainActor
final class MobileSSO: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func signIn(baseURL: URL) async throws {
        let callbackScheme = "hypermobile"
        var components = URLComponents(url: baseURL.appending(path: "auth/login"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "next", value: "/auth/mobile/complete")]
        let callbackURL: URL = try await withCheckedThrowingContinuation { continuation in
            let auth = ASWebAuthenticationSession(url: components.url!, callbackURLScheme: callbackScheme) { url, error in
                if let error { continuation.resume(throwing: error) }
                else if let url { continuation.resume(returning: url) }
                else { continuation.resume(throwing: MobileSSOError.missingCallback) }
            }
            auth.presentationContextProvider = self
            auth.prefersEphemeralWebBrowserSession = false
            session = auth
            guard auth.start() else {
                session = nil
                continuation.resume(throwing: MobileSSOError.couldNotStart)
                return
            }
        }
        session = nil
        guard callbackURL.scheme == callbackScheme,
              callbackURL.host == "auth",
              callbackURL.path == "/callback",
              let code = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "code" })?.value else {
            throw MobileSSOError.invalidCallback
        }
        try await APIClient(baseURL: baseURL).exchangeMobileSession(code: code)
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }
}

enum MobileSSOError: LocalizedError {
    case missingCallback, couldNotStart, invalidCallback
    var errorDescription: String? {
        switch self {
        case .missingCallback: "The sign-in browser did not return to Hyper."
        case .couldNotStart: "Could not open the sign-in browser."
        case .invalidCallback: "The sign-in response was invalid."
        }
    }
}
