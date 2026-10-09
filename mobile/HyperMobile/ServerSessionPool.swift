import Foundation
import Security

final class ServerSessionPool: @unchecked Sendable {
    static let shared = ServerSessionPool()
    private let lock = NSLock()
    private var sessions: [String: URLSession] = [:]
    private var cookieJars: [String: [String: String]] = [:]
    private let keychainService = "dev.hyper.mobile.server-cookies"

    private init() { }

    func session(for baseURL: URL) -> URLSession {
        let key = Self.key(for: baseURL)
        lock.lock(); defer { lock.unlock() }
        if let session = sessions[key] { return session }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieAcceptPolicy = .never
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.urlCache = URLCache(memoryCapacity: 24 * 1024 * 1024, diskCapacity: 160 * 1024 * 1024)
        configuration.requestCachePolicy = .useProtocolCachePolicy
        let session = URLSession(configuration: configuration)
        sessions[key] = session
        return session
    }

    func data(for request: URLRequest, baseURL: URL) async throws -> (Data, URLResponse) {
        var request = request
        let key = Self.key(for: baseURL)
        let jar = cookies(for: key, url: baseURL)
        if request.value(forHTTPHeaderField: "Cookie") == nil, !jar.isEmpty {
            request.setValue(jar.sorted(by: { $0.key < $1.key }).map { "\($0.key)=\($0.value)" }.joined(separator: "; "), forHTTPHeaderField: "Cookie")
        }
        let result = try await session(for: baseURL).data(for: request)
        if let http = result.1 as? HTTPURLResponse { captureCookies(from: http, url: request.url ?? baseURL, key: key) }
        return result
    }

    func cookieHeader(for baseURL: URL) -> String? {
        let jar = cookies(for: Self.key(for: baseURL), url: baseURL)
        guard !jar.isEmpty else { return nil }
        return jar.sorted(by: { $0.key < $1.key }).map { "\($0.key)=\($0.value)" }.joined(separator: "; ")
    }


    func webCookies(for baseURL: URL) -> [HTTPCookie] {
        guard let host = baseURL.host else { return [] }
        let jar = cookies(for: Self.key(for: baseURL), url: baseURL)
        return jar.compactMap { name, value in
            HTTPCookie(properties: [
                .domain: host,
                .path: "/",
                .name: name,
                .value: value,
                .secure: baseURL.scheme?.lowercased() == "https" ? "TRUE" : "FALSE",
            ])
        }
    }


    func clear(baseURL: URL) {
        let key = Self.key(for: baseURL)
        lock.lock()
        let session = sessions.removeValue(forKey: key)
        cookieJars[key] = [:]
        lock.unlock()
        session?.reset(completionHandler: {})
        saveCookies([:], key: key)
    }

    private func cookies(for key: String, url: URL) -> [String: String] {
        lock.lock(); defer { lock.unlock() }
        if let jar = cookieJars[key] { return jar }
        var jar = loadCookies(key: key)
        if jar.isEmpty {
            // One-time migration from the pre-profile URLSession.shared cookie jar.
            for cookie in HTTPCookieStorage.shared.cookies(for: url) ?? [] { jar[cookie.name] = cookie.value }
            if !jar.isEmpty { saveCookies(jar, key: key) }
        }
        cookieJars[key] = jar
        return jar
    }

    private func captureCookies(from response: HTTPURLResponse, url: URL, key: String) {
        var fields: [String: String] = [:]
        for (name, value) in response.allHeaderFields {
            if String(describing: name).caseInsensitiveCompare("Set-Cookie") == .orderedSame { fields["Set-Cookie"] = String(describing: value) }
        }
        guard !fields.isEmpty else { return }
        let updates = HTTPCookie.cookies(withResponseHeaderFields: fields, for: url)
        guard !updates.isEmpty else { return }
        lock.lock()
        var jar = cookieJars[key] ?? loadCookies(key: key)
        for cookie in updates {
            if cookie.expiresDate.map({ $0 <= Date() }) == true || cookie.value.isEmpty { jar.removeValue(forKey: cookie.name) }
            else { jar[cookie.name] = cookie.value }
        }
        cookieJars[key] = jar
        lock.unlock()
        saveCookies(jar, key: key)
    }

    private func loadCookies(key: String) -> [String: String] {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var value: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &value) == errSecSuccess,
              let data = value as? Data,
              let decoded = try? JSONDecoder().decode([String: String].self, from: data) else { return [:] }
        return decoded
    }

    private func saveCookies(_ cookies: [String: String], key: String) {
        let identity: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: key,
        ]
        if cookies.isEmpty {
            SecItemDelete(identity as CFDictionary)
            return
        }
        guard let data = try? JSONEncoder().encode(cookies) else { return }
        let update: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        if SecItemUpdate(identity as CFDictionary, update as CFDictionary) == errSecItemNotFound {
            var add = identity
            update.forEach { add[$0.key] = $0.value }
            SecItemAdd(add as CFDictionary, nil)
        }
    }

    private static func key(for url: URL) -> String {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.path = ""; components?.query = nil; components?.fragment = nil
        return components?.url?.absoluteString.lowercased() ?? url.absoluteString.lowercased()
    }
}
