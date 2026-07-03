import Foundation

/// Swift façade over the ExoPlayer native bridge (U2).
///
/// Owns URL and header POLICY (pure, testable): transforming relative stream
/// paths to absolute against `apiBaseURL`, and building the HTTP header map
/// (Bearer for owned content, empty for pre-signed share URLs). Playback
/// mechanics live in `PorizoNativeAudioBridge.kt`.
struct AndroidAudioPlayerProvider: Sendable {

    /// Prepare a stream for playback.
    /// - Parameters:
    ///   - url: absolute or relative stream URL (relative is resolved against apiBaseURL)
    ///   - headers: HTTP headers to attach (Bearer for owned; empty for pre-signed)
    func prepare(url: String, headers: [String: String]) -> Result<Void, AndroidNativeAdapterError> {
        let absolute = Self.absoluteURL(url)
        let headersJson = Self.encodeHeaders(headers)
        #if os(Android)
        let raw = porizoAudioPrepare(url: absolute, headersJson: headersJson)
        #else
        let raw = "ERROR|Android audio playback is available only on Android."
        #endif
        if raw == "OK" {
            return .success(())
        }
        let reason = raw.split(separator: "|", maxSplits: 1, omittingEmptySubsequences: false)
            .dropFirst().first.map(String.init) ?? raw
        return .failure(.operationFailed(reason))
    }

    func play() {
        #if os(Android)
        _ = porizoAudioPlay()
        #endif
    }

    func pause() {
        #if os(Android)
        _ = porizoAudioPause()
        #endif
    }

    func seek(toMs positionMs: Int) {
        #if os(Android)
        _ = porizoAudioSeek(positionMs: Int64(max(0, positionMs)))
        #endif
    }

    func release() {
        #if os(Android)
        _ = porizoAudioRelease()
        #endif
    }

    func currentPositionMs() -> Int {
        #if os(Android)
        return Int(porizoAudioCurrentPositionMs())
        #else
        return 0
        #endif
    }

    func durationMs() -> Int {
        #if os(Android)
        return Int(porizoAudioDurationMs())
        #else
        return 0
        #endif
    }

    func isPlaying() -> Bool {
        #if os(Android)
        return porizoAudioIsPlaying()
        #else
        return false
        #endif
    }

    // MARK: - Pure policy (host-testable)

    /// Bearer-auth header map for streaming a signed-in user's OWN content
    /// (track preview/full, poem audio). Mirrors iOS `streamingAuthHeaders()`.
    static func ownedContentHeaders(accessToken: String) -> [String: String] {
        ["Authorization": "Bearer \(accessToken)"]
    }

    /// No auth headers for SHARED content — the share/receiver-claim stream URL
    /// is pre-signed by the server.
    static func sharedContentHeaders() -> [String: String] {
        [:]
    }

    /// Resolve a possibly-relative stream path to an absolute URL against the
    /// active API base. Absolute URLs (http/https) pass through unchanged.
    /// Mirrors iOS `transformAudioUrl(_:baseURL:)`.
    static func absoluteURL(_ url: String) -> String {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") {
            return trimmed
        }
        let base = AndroidAppConfig.apiBaseURL
        let baseNoSlash = base.hasSuffix("/") ? String(base.dropLast()) : base
        let path = trimmed.hasPrefix("/") ? trimmed : "/\(trimmed)"
        return baseNoSlash + path
    }

    /// Encode a header map as a compact JSON object for the Kotlin bridge.
    /// Empty map → "{}".
    static func encodeHeaders(_ headers: [String: String]) -> String {
        guard !headers.isEmpty else { return "{}" }
        // Deterministic key order keeps output stable/testable.
        let sorted = headers.sorted { $0.key < $1.key }
        let parts = sorted.map { key, value in
            "\(jsonString(key)):\(jsonString(value))"
        }
        return "{\(parts.joined(separator: ","))}"
    }

    private static func jsonString(_ raw: String) -> String {
        var escaped = ""
        for ch in raw {
            switch ch {
            case "\"": escaped += "\\\""
            case "\\": escaped += "\\\\"
            case "\n": escaped += "\\n"
            case "\r": escaped += "\\r"
            case "\t": escaped += "\\t"
            default: escaped.append(ch)
            }
        }
        return "\"\(escaped)\""
    }
}

#if SKIP
func porizoAudioPrepare(url: String, headersJson: String) -> String {
    PorizoNativeAudioBridge.prepare(context: ProcessInfo.processInfo.androidContext, url: url, headersJson: headersJson)
}

func porizoAudioPlay() -> String {
    PorizoNativeAudioBridge.play()
}

func porizoAudioPause() -> String {
    PorizoNativeAudioBridge.pause()
}

func porizoAudioSeek(positionMs: Int64) -> String {
    PorizoNativeAudioBridge.seek(positionMs: positionMs)
}

func porizoAudioRelease() -> String {
    PorizoNativeAudioBridge.release()
}

func porizoAudioCurrentPositionMs() -> Int64 {
    PorizoNativeAudioBridge.currentPositionMs()
}

func porizoAudioDurationMs() -> Int64 {
    PorizoNativeAudioBridge.durationMs()
}

func porizoAudioIsPlaying() -> Bool {
    PorizoNativeAudioBridge.isPlaying()
}
#endif
