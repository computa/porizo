//
//  UsernameView.swift
//  PorizoApp
//
//  Username selection view for phone-based registration.
//  Shown after phone verification for new users.
//  Matches v1.pen "05 - Username" design with Velvet & Gold styling.
//

import SwiftUI
import Combine

// MARK: - UsernameView

/// Username selection screen shown after phone verification.
/// Users can choose a unique username and optional display name before completing registration.
struct UsernameView: View {
    /// Registration token from phone verification
    let registrationToken: String
    /// Phone number being registered
    let phoneNumber: String
    /// Called when registration completes successfully
    let onComplete: (PhoneRegisterResponse) -> Void
    /// Called when user taps back button
    let onBack: () -> Void
    /// Called when user taps Skip (v1.pen: optional username)
    var onSkip: (() -> Void)? = nil

    @Environment(APIClientWrapper.self) private var apiClient

    // MARK: - State

    @State private var username: String = ""
    @State private var displayName: String = ""
    @State private var isAvailable: Bool?
    @State private var isChecking: Bool = false
    @State private var suggestions: [String] = []
    @State private var isRegistering: Bool = false
    @State private var error: String?
    @State private var validationError: String?

    /// Debounce publisher for username availability checks
    @State private var usernamePublisher = PassthroughSubject<String, Never>()
    @State private var cancellables = Set<AnyCancellable>()

    // MARK: - Validation Constants

    private let minLength = 3
    private let maxLength = 20
    private let debounceMs = 500

    // MARK: - Body

    var body: some View {
        ZStack {
            // Background
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                header

                // Content
                ScrollView {
                    VStack(spacing: DesignTokens.spacing24) {
                        // Title section
                        titleSection

                        // Username input
                        usernameInputSection

                        // Availability indicator
                        if !username.isEmpty {
                            availabilityIndicator
                        }

                        // Suggestions (when username taken)
                        if !suggestions.isEmpty && isAvailable == false {
                            suggestionsSection
                        }

                        // Display name input (optional)
                        displayNameSection

                        // Username rules hint
                        rulesHint
                    }
                    .padding(.horizontal, DesignTokens.spacing24)
                    .padding(.top, DesignTokens.spacing24)
                }

                Spacer()

                // Error banner
                if let error = error {
                    errorBanner(error)
                        .padding(.horizontal, DesignTokens.spacing24)
                        .padding(.bottom, DesignTokens.spacing12)
                }

                // Complete button
                completeButton
                    .padding(.horizontal, DesignTokens.spacing24)
                    .padding(.bottom, DesignTokens.spacing24)
            }

            // Loading overlay
            if isRegistering {
                loadingOverlay
            }
        }
        .onAppear {
            setupDebounce()
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            // Back button
            VelvetIconButton(icon: "arrow.left") {
                onBack()
            }

            Spacer()

            // Title
            Text("Your Username")
                .font(DesignTokens.displayFont(size: 20))
                .foregroundColor(DesignTokens.textPrimary)

            Spacer()

            // Skip link (v1.pen: gold "Skip" button on right)
            if let onSkip = onSkip {
                Button {
                    onSkip()
                } label: {
                    Text("Skip")
                        .font(DesignTokens.bodyFont(size: 16, weight: .medium))
                        .foregroundColor(DesignTokens.gold)
                }
                .frame(width: 44, height: 44, alignment: .trailing)
            } else {
                // Spacer to balance back button when no skip
                Color.clear.frame(width: 44, height: 44)
            }
        }
        .padding(.horizontal, DesignTokens.spacing20)
        .padding(.vertical, DesignTokens.spacing8)
    }

    // MARK: - Title Section

    private var titleSection: some View {
        VStack(spacing: DesignTokens.spacing8) {
            Text("Choose a Username")
                .font(DesignTokens.displayFont(size: 28))
                .foregroundColor(DesignTokens.textPrimary)

            Text("This is how others will find you on Porizo")
                .font(DesignTokens.bodyFont(size: 16))
                .foregroundColor(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
        }
    }

    // MARK: - Username Input

    private var usernameInputSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing8) {
            // Input field with @ prefix
            HStack(spacing: 0) {
                // @ prefix
                Text("@")
                    .font(DesignTokens.displayFont(size: 28))
                    .foregroundColor(DesignTokens.gold)
                    .padding(.leading, DesignTokens.spacing16)

                // Username text field
                TextField("username", text: $username)
                    .font(DesignTokens.displayFont(size: 28))
                    .foregroundColor(DesignTokens.gold)
                    .autocapitalization(.none)
                    .autocorrectionDisabled()
                    .textContentType(.username)
                    .onChange(of: username) { _, newValue in
                        handleUsernameChange(newValue)
                    }
                    .padding(.vertical, DesignTokens.spacing16)
                    .padding(.trailing, DesignTokens.spacing8)

                // Clear button (when username not empty)
                if !username.isEmpty {
                    Button {
                        username = ""
                        isAvailable = nil
                        suggestions = []
                        validationError = nil
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(DesignTokens.textTertiary)
                            .frame(width: 24, height: 24)
                            .background(DesignTokens.borderSubtle)
                            .clipShape(Circle())
                    }
                    .padding(.trailing, DesignTokens.spacing16)
                }
            }
            .background(DesignTokens.inputBackground)
            .cornerRadius(DesignTokens.radiusMedium)
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                    .stroke(borderColor, lineWidth: 1)
            )

            // Validation error
            if let validationError = validationError {
                Text(validationError)
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundColor(DesignTokens.error)
            }
        }
    }

    private var borderColor: Color {
        if let validationError = validationError, !validationError.isEmpty {
            return DesignTokens.error
        }
        if let isAvailable = isAvailable {
            return isAvailable ? DesignTokens.success : DesignTokens.error
        }
        return DesignTokens.borderSubtle
    }

    // MARK: - Availability Indicator

    private var availabilityIndicator: some View {
        HStack(spacing: DesignTokens.spacing8) {
            if isChecking {
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: DesignTokens.textSecondary))
                    .scaleEffect(0.8)
                Text("Checking availability...")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundColor(DesignTokens.textSecondary)
            } else if validationError == nil, let isAvailable = isAvailable {
                if isAvailable {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 20))
                        .foregroundColor(DesignTokens.successDark)
                    Text("Username available")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundColor(DesignTokens.successDark)
                } else {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 20))
                        .foregroundColor(DesignTokens.error)
                    Text("Username taken")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundColor(DesignTokens.error)
                }
            }
            Spacer()
        }
    }

    // MARK: - Suggestions Section

    private var suggestionsSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing12) {
            Text("Try one of these instead:")
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundColor(DesignTokens.textSecondary)

            FlowLayout(spacing: DesignTokens.spacing8) {
                ForEach(suggestions.prefix(5), id: \.self) { suggestion in
                    Button {
                        username = suggestion
                    } label: {
                        Text("@\(suggestion)")
                            .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                            .foregroundColor(DesignTokens.gold)
                            .padding(.horizontal, DesignTokens.spacing12)
                            .padding(.vertical, DesignTokens.spacing8)
                            .background(DesignTokens.gold.opacity(0.15))
                            .cornerRadius(DesignTokens.radiusPill)
                    }
                }
            }
        }
        .padding(DesignTokens.spacing16)
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.radiusMedium)
    }

    // MARK: - Display Name Section

    private var displayNameSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing8) {
            Text("Display Name (optional)")
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundColor(DesignTokens.textSecondary)

            TextField("How you want to be called", text: $displayName)
                .font(DesignTokens.bodyFont(size: 16))
                .foregroundColor(DesignTokens.textPrimary)
                .padding(.horizontal, DesignTokens.spacing16)
                .padding(.vertical, DesignTokens.spacing12)
                .background(DesignTokens.inputBackground)
                .cornerRadius(DesignTokens.radiusMedium)
                .overlay(
                    RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                        .stroke(DesignTokens.borderSubtle, lineWidth: 1)
                )
        }
    }

    // MARK: - Rules Hint

    private var rulesHint: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing4) {
            Text("Username requirements:")
                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                .foregroundColor(DesignTokens.textTertiary)

            VStack(alignment: .leading, spacing: DesignTokens.spacing2) {
                ruleRow("3-20 characters", isMet: username.count >= minLength && username.count <= maxLength)
                ruleRow("Letters, numbers, and underscores only", isMet: isAlphanumericWithUnderscore(username))
                ruleRow("Must start with a letter", isMet: startsWithLetter(username))
            }
        }
        .padding(DesignTokens.spacing16)
        .background(DesignTokens.surfaceMuted)
        .cornerRadius(DesignTokens.radiusMedium)
    }

    private func ruleRow(_ text: String, isMet: Bool) -> some View {
        HStack(spacing: DesignTokens.spacing8) {
            Image(systemName: isMet ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 12))
                .foregroundColor(isMet ? DesignTokens.successDark : DesignTokens.textTertiary)

            Text(text)
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundColor(isMet ? DesignTokens.textSecondary : DesignTokens.textTertiary)
        }
    }

    // MARK: - Error Banner

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: DesignTokens.spacing8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(DesignTokens.error)
            Text(message)
                .font(.subheadline)
                .foregroundColor(DesignTokens.textPrimary)
            Spacer()
            Button {
                error = nil
            } label: {
                Image(systemName: "xmark")
                    .font(.caption)
                    .foregroundColor(DesignTokens.textSecondary)
            }
        }
        .padding(DesignTokens.spacing12)
        .background(DesignTokens.error.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
    }

    // MARK: - Complete Button

    private var completeButton: some View {
        VelvetButton(
            "Love it!",
            style: .primary,
            isLoading: isRegistering,
            isDisabled: !canComplete
        ) {
            Task {
                await completeRegistration()
            }
        }
    }

    private var canComplete: Bool {
        guard !username.isEmpty else { return false }
        guard validationError == nil else { return false }
        guard isAvailable == true else { return false }
        guard !isChecking else { return false }
        return true
    }

    // MARK: - Loading Overlay

    private var loadingOverlay: some View {
        ZStack {
            Color.black.opacity(0.3)
                .ignoresSafeArea()

            VStack(spacing: DesignTokens.spacing16) {
                ProgressView()
                    .scaleEffect(1.2)
                    .tint(.white)

                Text("Creating your account...")
                    .font(DesignTokens.bodyFont(size: 16, weight: .medium))
                    .foregroundColor(DesignTokens.textPrimary)
            }
            .padding(DesignTokens.spacing24)
            .background(DesignTokens.surface)
            .cornerRadius(DesignTokens.radiusMedium)
        }
    }

    // MARK: - Validation

    private func validateUsername(_ username: String) -> String? {
        if username.isEmpty {
            return nil // No error for empty
        }

        if username.count < minLength {
            return "Username must be at least \(minLength) characters"
        }

        if username.count > maxLength {
            return "Username must be at most \(maxLength) characters"
        }

        if !startsWithLetter(username) {
            return "Username must start with a letter"
        }

        if !isAlphanumericWithUnderscore(username) {
            return "Only letters, numbers, and underscores allowed"
        }

        return nil
    }

    private func isAlphanumericWithUnderscore(_ text: String) -> Bool {
        guard !text.isEmpty else { return false }
        let pattern = "^[a-zA-Z0-9_]+$"
        return text.range(of: pattern, options: .regularExpression) != nil
    }

    private func startsWithLetter(_ text: String) -> Bool {
        guard let first = text.first else { return false }
        return first.isLetter
    }

    // MARK: - Username Change Handler

    private func handleUsernameChange(_ newValue: String) {
        // Sanitize input (remove spaces, special chars except underscore)
        let sanitized = newValue.filter { $0.isLetter || $0.isNumber || $0 == "_" }
        if sanitized != newValue {
            username = sanitized
            return
        }

        // Reset availability state
        isAvailable = nil
        suggestions = []

        // Validate locally
        validationError = validateUsername(newValue)

        // Only check availability if locally valid
        if validationError == nil && !newValue.isEmpty {
            usernamePublisher.send(newValue)
        }
    }

    // MARK: - Debounce Setup

    private func setupDebounce() {
        usernamePublisher
            .debounce(for: .milliseconds(debounceMs), scheduler: RunLoop.main)
            .sink { value in
                Task {
                    await checkAvailability(value)
                }
            }
            .store(in: &cancellables)
    }

    // MARK: - API Calls

    private func checkAvailability(_ username: String) async {
        guard !username.isEmpty else { return }

        // Revalidate (in case state changed during debounce)
        guard validateUsername(username) == nil else { return }

        await MainActor.run {
            isChecking = true
        }

        do {
            let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "checkUsernameAvailability") {
                try await apiClient.client.checkUsernameAvailability(username: username)
            }
            await MainActor.run {
                isAvailable = response.available
                suggestions = response.suggestions ?? []
                isChecking = false
            }
        } catch {
            await MainActor.run {
                // On error, don't show availability status
                isAvailable = nil
                isChecking = false
                // Don't show error for availability check - just silently fail
            }
        }
    }

    private func completeRegistration() async {
        guard canComplete else { return }

        await MainActor.run {
            isRegistering = true
            error = nil
        }

        do {
            let name = displayName.isEmpty ? nil : displayName
            let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "registerWithPhone") {
                try await apiClient.client.registerWithPhone(
                    registrationToken: registrationToken,
                    username: username,
                    name: name
                )
            }

            await MainActor.run {
                isRegistering = false
                onComplete(response)
            }
        } catch {
            await MainActor.run {
                isRegistering = false
                self.error = "Registration failed. Please try again."
            }
        }
    }
}

// MARK: - FlowLayout

/// Simple flow layout for wrapping suggestion buttons
struct FlowLayout: Layout {
    let spacing: CGFloat

    init(spacing: CGFloat = 8) {
        self.spacing = spacing
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = layoutSubviews(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = layoutSubviews(proposal: proposal, subviews: subviews)
        for (index, frame) in result.frames.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                proposal: ProposedViewSize(frame.size)
            )
        }
    }

    private func layoutSubviews(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, frames: [CGRect]) {
        var frames: [CGRect] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var lineHeight: CGFloat = 0
        let maxWidth = proposal.width ?? .infinity

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)

            if x + size.width > maxWidth && x > 0 {
                // Move to next line
                x = 0
                y += lineHeight + spacing
                lineHeight = 0
            }

            frames.append(CGRect(x: x, y: y, width: size.width, height: size.height))
            lineHeight = max(lineHeight, size.height)
            x += size.width + spacing
        }

        let totalHeight = y + lineHeight
        let totalWidth = frames.reduce(0) { max($0, $1.maxX) }

        return (CGSize(width: totalWidth, height: totalHeight), frames)
    }
}

// MARK: - Preview

#Preview("UsernameView") {
    UsernameView(
        registrationToken: "mock-token",
        phoneNumber: "+1 (555) 123-4567",
        onComplete: { response in
            print("Registered: \(response.userId)")
        },
        onBack: {
            print("Back tapped")
        }
    )
    .environment(APIClientWrapper(baseURL: "http://localhost:3000"))
}

#Preview("UsernameView - With Suggestions") {
    // This preview simulates what it looks like when username is taken
    UsernameView(
        registrationToken: "mock-token",
        phoneNumber: "+1 (555) 123-4567",
        onComplete: { _ in },
        onBack: {}
    )
    .environment(APIClientWrapper(baseURL: "http://localhost:3000"))
}
