import Foundation

enum LaunchFlashGate {
    static func shouldAttemptFlash(
        hasPendingNavigationIntent: Bool,
        isAuthenticated: Bool,
        skipAuth: Bool,
        mode: LaunchFlashMode,
        failureCount: Int
    ) -> Bool {
        if hasPendingNavigationIntent {
            return false
        }
        if !skipAuth && !isAuthenticated {
            return false
        }
        if mode == .off {
            return false
        }
        if failureCount >= 3 {
            return false
        }
        return true
    }
}
