import Foundation

/// Swift façade over the Google Sign-In native bridge (U4c).
/// Returns a Google ID token to hand to /auth/social, or an error.
struct AndroidGoogleSignInProvider: Sendable {

    /// Present the Google credential picker and return an ID token.
    func signIn() -> Result<String, AndroidNativeAdapterError> {
        #if os(Android)
        let raw = porizoGoogleSignIn(webClientId: AndroidAppConfig.googleWebClientId)
        #else
        let raw = "ERR|Google sign-in is available only on Android."
        #endif
        let pieces = raw.split(separator: "|", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
        if pieces.first == "OK", pieces.count >= 2, !pieces[1].isEmpty {
            return .success(pieces[1])
        }
        let reason = pieces.count >= 2 ? pieces[1] : raw
        return .failure(.operationFailed(reason))
    }
}

#if SKIP
func porizoGoogleSignIn(webClientId: String) -> String {
    PorizoNativeGoogleSignInBridge.signIn(
        context: ProcessInfo.processInfo.androidContext,
        webClientId: webClientId
    )
}
#endif
