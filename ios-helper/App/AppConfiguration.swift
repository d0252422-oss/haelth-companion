import Foundation

struct AppConfiguration {
    let environment: String
    let apiBaseURL: URL
    let webBootstrapURL: URL
    let universalLinkHost: String

    static func load(bundle: Bundle = .main) throws -> AppConfiguration {
        guard let environment = bundle.object(forInfoDictionaryKey: "APP_ENV") as? String,
              let apiString = bundle.object(forInfoDictionaryKey: "API_BASE_URL") as? String,
              let apiURL = URL(string: apiString), apiURL.scheme == "https",
              let bootstrapString = bundle.object(forInfoDictionaryKey: "WEB_BOOTSTRAP_URL") as? String,
              let bootstrapURL = URL(string: bootstrapString), bootstrapURL.scheme == "https",
              let host = bundle.object(forInfoDictionaryKey: "UNIVERSAL_LINK_HOST") as? String,
              !host.contains("REPLACE_") else { throw APIError.invalidConfiguration }
        return AppConfiguration(environment: environment, apiBaseURL: apiURL, webBootstrapURL: bootstrapURL, universalLinkHost: host)
    }

    func bootstrapURL(installationKeyFingerprint: String) -> URL? {
        var components = URLComponents(url: webBootstrapURL, resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "platform", value: "ios"),
            URLQueryItem(name: "installation_key_fingerprint", value: installationKeyFingerprint)
        ]
        return components?.url
    }
}

