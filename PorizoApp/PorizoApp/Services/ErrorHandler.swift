//
//  ErrorHandler.swift
//  PorizoApp
//
//  Centralized error handling service.
//  Provides unified error categorization, logging, and UI presentation.
//

import SwiftUI

/// Error categories for UI presentation
enum AppErrorCategory {
    case network       // Connection issues, timeouts
    case server        // API errors (4xx, 5xx)
    case validation    // Invalid input, missing data
    case audio         // Recording/playback failures
    case permission    // Microphone, storage access
    case unknown       // Unexpected errors

    var icon: String {
        switch self {
        case .network: return "wifi.slash"
        case .server: return "exclamationmark.icloud"
        case .validation: return "exclamationmark.circle"
        case .audio: return "waveform.slash"
        case .permission: return "lock.shield"
        case .unknown: return "questionmark.circle"
        }
    }

    var title: String {
        switch self {
        case .network: return "Connection Error"
        case .server: return "Server Error"
        case .validation: return "Invalid Input"
        case .audio: return "Audio Error"
        case .permission: return "Permission Required"
        case .unknown: return "Something Went Wrong"
        }
    }
}

/// Structured app error with category and user-friendly message
struct AppError: Error, Identifiable {
    let id = UUID()
    let category: AppErrorCategory
    let message: String
    let underlyingError: Error?
    let isRecoverable: Bool
    let recoveryAction: String?

    init(
        category: AppErrorCategory,
        message: String,
        underlyingError: Error? = nil,
        isRecoverable: Bool = true,
        recoveryAction: String? = nil
    ) {
        self.category = category
        self.message = message
        self.underlyingError = underlyingError
        self.isRecoverable = isRecoverable
        self.recoveryAction = recoveryAction
    }
}

/// Centralized error handling service
///
/// Usage:
/// ```swift
/// // In a view
/// @State private var errorHandler = ErrorHandler.shared
///
/// // Handle an error
/// errorHandler.handle(error, context: "Loading tracks")
///
/// // Show alert binding
/// .alert(item: $errorHandler.currentError) { error in
///     Alert(
///         title: Text(error.category.title),
///         message: Text(error.message)
///     )
/// }
/// ```
@Observable
@MainActor
final class ErrorHandler {

    // MARK: - Singleton

    static let shared = ErrorHandler()

    // MARK: - Published State

    /// Current error for alert presentation (nil when dismissed)
    var currentError: AppError?

    /// Error history for debugging (last 10 errors)
    private(set) var recentErrors: [AppError] = []

    /// Whether an error banner should be shown
    var showErrorBanner = false

    // MARK: - Configuration

    /// Maximum errors to keep in history
    private let maxHistoryCount = 10

    /// Whether to log errors to console
    var enableLogging = true

    // MARK: - Initialization

    private init() {}

    // MARK: - Public Methods

    /// Handle an error with optional context
    /// - Parameters:
    ///   - error: The error to handle
    ///   - context: Optional context describing what was happening
    ///   - showAlert: Whether to show an alert (default: true)
    func handle(_ error: Error, context: String? = nil, showAlert: Bool = true) {
        let appError = Self.categorize(error, context: context)

        // Log to console
        if enableLogging {
            log(appError, context: context)
        }

        // Add to history
        recentErrors.insert(appError, at: 0)
        if recentErrors.count > maxHistoryCount {
            recentErrors.removeLast()
        }

        // Show to user
        if showAlert {
            currentError = appError
        } else {
            showErrorBanner = true
        }
    }

    /// Handle an error silently (log only, no UI)
    /// - Parameters:
    ///   - error: The error to handle
    ///   - context: Optional context
    func handleSilently(_ error: Error, context: String? = nil) {
        handle(error, context: context, showAlert: false)
        showErrorBanner = false  // Also suppress banner
    }

    /// Dismiss current error
    func dismiss() {
        currentError = nil
        showErrorBanner = false
    }

    /// Clear error history
    func clearHistory() {
        recentErrors.removeAll()
    }

    /// Return a user-facing message for an error without mutating handler state.
    nonisolated static func friendlyMessage(for error: Error, context: String? = nil) -> String {
        categorize(error, context: context).message
    }

    /// Shared poem-audio error mapper used by both poem preview surfaces.
    nonisolated static func poemAudioErrorMessage(_ error: Error) -> String {
        guard let apiError = error as? APIClientError else {
            return "Could not play poem audio. Please try again."
        }

        switch apiError {
        case .rateLimited:
            return "You have reached the poem audio limit. Please wait and try again."
        case .networkError:
            return "Network issue while generating poem audio. Please try again."
        case .serverError(let message, _, _):
            return message.isEmpty ? "Could not generate poem audio. Please try again." : message
        case .httpError(_, let body):
            if body.localizedCaseInsensitiveContains("FST_ERR_CTP_EMPTY_JSON_BODY") {
                return "Audio request was rejected by the server. Please try again."
            }
            return "Could not generate poem audio. Please try again."
        default:
            return "Could not play poem audio. Please try again."
        }
    }

    // MARK: - Error Categorization

    nonisolated private static func categorize(_ error: Error, context: String?) -> AppError {
        // Handle APIClientError specifically
        if let apiError = error as? APIClientError {
            return categorizeAPIError(apiError, context: context)
        }

        // Handle URL errors
        if let urlError = error as? URLError {
            return categorizeURLError(urlError, context: context)
        }

        // Default: unknown error
        return AppError(
            category: .unknown,
            message: error.localizedDescription,
            underlyingError: error,
            isRecoverable: true,
            recoveryAction: "Please try again"
        )
    }

    nonisolated private static func categorizeAPIError(_ error: APIClientError, context: String?) -> AppError {
        switch error {
        case .invalidResponse:
            return AppError(
                category: .server,
                message: "Received an invalid response from the server.",
                underlyingError: error,
                recoveryAction: "Please try again"
            )

        case .httpError(let statusCode, _):
            let message: String
            let category: AppErrorCategory

            switch statusCode {
            case 400:
                category = .validation
                message = "Invalid request. Please check your input."
            case 401, 403:
                category = .permission
                message = "You don't have permission to do this."
            case 404:
                category = .server
                message = "The requested resource was not found."
            case 429:
                category = .server
                message = "Too many requests. Please wait a moment."
            case 500...599:
                category = .server
                message = "Server error. Please try again later."
            default:
                category = .server
                message = "Server error (HTTP \(statusCode))."
            }

            return AppError(
                category: category,
                message: message,
                underlyingError: error,
                recoveryAction: category == .validation ? "Check your input" : "Try again later"
            )

        case .networkError(let underlying):
            return AppError(
                category: .network,
                message: "Network error: \(underlying.localizedDescription)",
                underlyingError: underlying,
                recoveryAction: "Check your connection"
            )

        case .serverError(let message, let code, _):
            let (mappedMessage, category, isRecoverable, recoveryAction) = mapServerCode(
                code,
                fallbackMessage: message
            )
            return AppError(
                category: category,
                message: mappedMessage,
                underlyingError: error,
                isRecoverable: isRecoverable,
                recoveryAction: recoveryAction
            )

        case .rateLimited(let retryAfter):
            let waitMessage: String
            if let seconds = retryAfter {
                waitMessage = "Please wait \(seconds) seconds before trying again."
            } else {
                waitMessage = "Please wait a moment before trying again."
            }
            return AppError(
                category: .server,
                message: "Too many requests. \(waitMessage)",
                underlyingError: error,
                recoveryAction: "Wait and retry"
            )

        case .decodingError:
            return AppError(
                category: .server,
                message: "Failed to process server response.",
                underlyingError: error,
                isRecoverable: false
            )

        case .notAuthenticated:
            return AppError(
                category: .permission,
                message: "You need to sign in to continue.",
                underlyingError: error,
                recoveryAction: "Sign in"
            )

        case .authRefreshNeeded:
            // Internal error - should not reach user-facing code
            return AppError(
                category: .permission,
                message: "Session refresh required.",
                underlyingError: error,
                recoveryAction: "Try again"
            )

        case .authRefreshFailed:
            return AppError(
                category: .network,
                message: "Unable to refresh your session. Check your connection and try again.",
                underlyingError: error,
                isRecoverable: true,
                recoveryAction: "Check connection"
            )

        case .aiUnavailable(let message):
            return AppError(
                category: .server,
                message: message ?? "AI service is temporarily unavailable.",
                underlyingError: error,
                recoveryAction: "Please try again later"
            )
        }
    }

    nonisolated private static func categorizeURLError(_ error: URLError, context: String?) -> AppError {
        let message: String
        let recoveryAction: String

        switch error.code {
        case .notConnectedToInternet, .networkConnectionLost:
            message = "No internet connection."
            recoveryAction = "Check your connection"
        case .timedOut:
            message = "The request timed out."
            recoveryAction = "Please try again"
        case .cannotFindHost, .cannotConnectToHost:
            message = "Cannot connect to server."
            recoveryAction = "Check your connection"
        default:
            message = "Network error: \(error.localizedDescription)"
            recoveryAction = "Please try again"
        }

        return AppError(
            category: .network,
            message: message,
            underlyingError: error,
            recoveryAction: recoveryAction
        )
    }

    nonisolated private static func mapServerCode(
        _ code: String?,
        fallbackMessage: String
    ) -> (message: String, category: AppErrorCategory, isRecoverable: Bool, recoveryAction: String?) {
        switch (code ?? "").uppercased() {
        case "VOICE_PROFILE_REQUIRED":
            return (
                "Please enroll your voice before using My Voice mode.",
                .validation,
                true,
                "Enroll Voice"
            )
        case "MODERATION_BLOCKED":
            return (
                "Your content was flagged by our safety filter. Please edit and try again.",
                .validation,
                true,
                "Edit Content"
            )
        case "ALREADY_RENDERING":
            return (
                "Your song is already being created. Please wait.",
                .server,
                false,
                nil
            )
        case "INSUFFICIENT_CREDITS", "NO_ENTITLEMENTS":
            return (
                "No songs remaining. Upgrade to continue.",
                .validation,
                true,
                "Upgrade"
            )
        case "AI_UNAVAILABLE":
            return (
                "Our AI is temporarily busy. Please try again in a moment.",
                .server,
                true,
                "Try Again Later"
            )
        case "BILLING_ERROR":
            return (
                "Billing system error. Please try again or contact support.",
                .server,
                true,
                "Contact Support"
            )
        case "ACCOUNT_BLOCKED":
            return (
                "Your account has been restricted. Please contact support.",
                .permission,
                false,
                "Contact Support"
            )
        case "GENERATION_FAILED":
            return (
                "Generation failed. Please try again.",
                .server,
                true,
                "Try Again"
            )
        case "POEM_NOT_READY":
            return (
                "Your poem is still being prepared. Please wait.",
                .server,
                true,
                "Wait"
            )
        case "STORY_VERSION_CONFLICT":
            return (
                "Your session was updated from another device. Please try again.",
                .server,
                true,
                "Try Again"
            )
        default:
            let message = fallbackMessage.isEmpty ? "Something went wrong. Please try again." : fallbackMessage
            return (message, .server, true, "Try Again")
        }
    }

    // MARK: - Logging

    private func log(_ error: AppError, context: String?) {
        let contextStr = context.map { " [\($0)]" } ?? ""
        print("❌ [\(error.category.title)]\(contextStr): \(error.message)")

        if let underlying = error.underlyingError {
            print("   Underlying: \(String(describing: type(of: underlying))): \(underlying.localizedDescription)")
        }
    }
}

// MARK: - View Modifier for Error Alerts

extension View {
    /// Attach error alert handling to a view
    func errorAlert(_ errorHandler: ErrorHandler) -> some View {
        self.alert(item: Binding(
            get: { errorHandler.currentError },
            set: { errorHandler.currentError = $0 }
        )) { error in
            Alert(
                title: Text(error.category.title),
                message: Text(error.message),
                dismissButton: .default(Text("OK")) {
                    errorHandler.dismiss()
                }
            )
        }
    }
}
