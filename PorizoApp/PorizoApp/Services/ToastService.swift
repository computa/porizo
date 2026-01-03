//
//  ToastService.swift
//  PorizoApp
//
//  A lightweight toast notification service for showing
//  brief success/info messages that auto-dismiss.
//

import SwiftUI

// MARK: - Toast Type

enum ToastType {
    case success
    case info
    case warning
    case error

    var iconName: String {
        switch self {
        case .success: return "checkmark.circle.fill"
        case .info: return "info.circle.fill"
        case .warning: return "exclamationmark.triangle.fill"
        case .error: return "xmark.circle.fill"
        }
    }

    var iconColor: Color {
        switch self {
        case .success: return DesignTokens.success
        case .info: return DesignTokens.rose
        case .warning: return DesignTokens.warning
        case .error: return DesignTokens.error
        }
    }
}

// MARK: - Toast Model

struct Toast: Equatable, Identifiable {
    let id = UUID()
    let message: String
    let type: ToastType
    let duration: TimeInterval

    init(message: String, type: ToastType = .success, duration: TimeInterval = 2.0) {
        self.message = message
        self.type = type
        self.duration = duration
    }

    static func == (lhs: Toast, rhs: Toast) -> Bool {
        lhs.id == rhs.id
    }
}

// MARK: - Toast Service

@MainActor
@Observable
final class ToastService {
    static let shared = ToastService()

    private(set) var currentToast: Toast?
    private var dismissTask: Task<Void, Never>?

    private init() {}

    func show(_ message: String, type: ToastType = .success, duration: TimeInterval = 2.0) {
        // Cancel any existing dismiss task
        dismissTask?.cancel()

        // Haptic feedback
        switch type {
        case .success:
            let generator = UINotificationFeedbackGenerator()
            generator.notificationOccurred(.success)
        case .warning:
            let generator = UINotificationFeedbackGenerator()
            generator.notificationOccurred(.warning)
        case .error:
            let generator = UINotificationFeedbackGenerator()
            generator.notificationOccurred(.error)
        case .info:
            let generator = UIImpactFeedbackGenerator(style: .light)
            generator.impactOccurred()
        }

        // Show toast
        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
            currentToast = Toast(message: message, type: type, duration: duration)
        }

        // Schedule dismiss
        dismissTask = Task {
            try? await Task.sleep(for: .seconds(duration))
            guard !Task.isCancelled else { return }
            await dismiss()
        }
    }

    func dismiss() {
        dismissTask?.cancel()
        withAnimation(.easeOut(duration: 0.2)) {
            currentToast = nil
        }
    }

    // Convenience methods
    func success(_ message: String) {
        show(message, type: .success)
    }

    func info(_ message: String) {
        show(message, type: .info)
    }

    func warning(_ message: String) {
        show(message, type: .warning)
    }

    func error(_ message: String) {
        show(message, type: .error, duration: 3.0)
    }
}

// MARK: - Toast View

struct ToastView: View {
    let toast: Toast
    let onDismiss: () -> Void

    private var accessibilityTypeLabel: String {
        switch toast.type {
        case .success: return "Success"
        case .info: return "Information"
        case .warning: return "Warning"
        case .error: return "Error"
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: toast.type.iconName)
                .font(.system(size: 20))
                .foregroundColor(toast.type.iconColor)
                .accessibilityHidden(true)

            Text(toast.message)
                .font(.subheadline.weight(.medium))
                .foregroundColor(DesignTokens.textPrimary)

            Spacer()

            Button {
                onDismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(DesignTokens.textSecondary)
            }
            .accessibilityLabel("Dismiss notification")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(DesignTokens.cardBackground)
                .elevation(.level4)
        )
        .padding(.horizontal, 16)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(accessibilityTypeLabel): \(toast.message)")
        .accessibilityAddTraits(.isStaticText)
    }
}

// MARK: - Toast View Modifier

struct ToastModifier: ViewModifier {
    @State private var toastService = ToastService.shared

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) {
                if let toast = toastService.currentToast {
                    ToastView(toast: toast) {
                        toastService.dismiss()
                    }
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .padding(.top, 8)
                    .onAppear {
                        // Announce toast for VoiceOver users
                        let typeLabel: String
                        switch toast.type {
                        case .success: typeLabel = "Success"
                        case .info: typeLabel = "Information"
                        case .warning: typeLabel = "Warning"
                        case .error: typeLabel = "Error"
                        }
                        UIAccessibility.post(
                            notification: .announcement,
                            argument: "\(typeLabel): \(toast.message)"
                        )
                    }
                }
            }
    }
}

extension View {
    func withToasts() -> some View {
        modifier(ToastModifier())
    }
}
