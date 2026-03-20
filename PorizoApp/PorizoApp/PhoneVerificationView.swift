//
//  PhoneVerificationView.swift
//  PorizoApp
//
//  Phone verification code entry matching v1.pen "04 - Confirmation Code" design.
//  Handles 6-digit OTP input with auto-submit and resend countdown.
//

import SwiftUI

// MARK: - PhoneVerificationView

/// Verification code entry screen for phone authentication.
/// Displays masked phone number and 6-digit code input with auto-submit.
struct PhoneVerificationView: View {
    /// Phone number in E.164 format (e.g., "+15551234567")
    let phoneNumber: String

    /// Called when verification succeeds with response containing tokens or registration_token
    let onVerified: (VerifyPhoneCodeResponse) -> Void

    /// Called when user taps back button
    let onBack: () -> Void

    @Environment(APIClientWrapper.self) private var apiClient

    // MARK: - State

    @State private var code: String = ""
    @State private var isVerifying: Bool = false
    @State private var error: String?
    @State private var resendCountdown: Int = 60
    @State private var canResend: Bool = false
    @State private var remainingAttempts: Int?

    @FocusState private var isCodeFieldFocused: Bool

    /// Task handles for resend countdown and cursor blink
    @State private var countdownTask: Task<Void, Never>?
    @State private var blinkTask: Task<Void, Never>?

    // MARK: - Body

    var body: some View {
        ZStack {
            // Background: Deep velvet black
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header with back button and title
                VelvetHeader(
                    title: "Enter confirmation code",
                    showBackButton: true,
                    onBack: onBack
                )

                // Subheader: "Sent to +1 *** *** 4567"
                HStack {
                    Text("Sent to \(maskedPhoneNumber)")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundStyle(DesignTokens.textTertiary)
                }
                .frame(maxWidth: .infinity)
                .padding(.horizontal, DesignTokens.spacing24)
                .padding(.bottom, DesignTokens.spacing8)

                // Content
                VStack(spacing: DesignTokens.spacing24) {
                    Spacer()
                        .frame(height: DesignTokens.spacing24)

                    // OTP Input Display
                    codeInputDisplay

                    // Error message
                    if let error = error {
                        errorMessage(error)
                    }

                    Spacer()

                    // Resend button / countdown
                    resendSection
                }
                .padding(.horizontal, DesignTokens.spacing24)
                .padding(.bottom, DesignTokens.spacing24)
            }

            // Loading overlay
            if isVerifying {
                Color.black.opacity(0.4)
                    .ignoresSafeArea()

                VStack(spacing: DesignTokens.spacing16) {
                    ProgressView()
                        .scaleEffect(1.3)
                        .tint(DesignTokens.gold)
                    Text("Verifying...")
                        .font(DesignTokens.bodyFont(size: 16, weight: .medium))
                        .foregroundStyle(DesignTokens.textPrimary)
                }
                .padding(DesignTokens.spacing24)
                .background(DesignTokens.surface)
                .clipShape(.rect(cornerRadius: DesignTokens.radiusMedium))
            }
        }
        .onAppear {
            startCountdown()
        }
        .task { @MainActor in
            await Task.yield()
            isCodeFieldFocused = true
        }
        .onDisappear {
            countdownTask?.cancel()
            blinkTask?.cancel()
        }
        .onChange(of: code) { _, newValue in
            // Auto-submit when 6 digits entered
            if newValue.count == 6 {
                Task {
                    await verifyCode()
                }
            }
        }
    }

    // MARK: - Code Input Display

    /// Visual display of 6 code digits with hidden TextField for input
    private var codeInputDisplay: some View {
        ZStack {
            // Hidden TextField for actual input (captures keyboard and auto-fill)
            TextField("", text: $code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .focused($isCodeFieldFocused)
                .frame(width: 1, height: 1)
                .opacity(0.01)
                .onChange(of: code) { _, newValue in
                    // Filter to only digits and limit to 6 characters
                    let filtered = newValue.filter { $0.isNumber }
                    if filtered != newValue || filtered.count > 6 {
                        code = String(filtered.prefix(6))
                    }
                }

            // Visual digit display (matching v1.pen design)
            HStack(spacing: DesignTokens.spacing4) {
                // Cursor indicator when empty or focused at start
                if code.isEmpty && isCodeFieldFocused {
                    Rectangle()
                        .fill(DesignTokens.gold)
                        .frame(width: 2, height: 40)
                        .opacity(cursorOpacity)
                }

                // Display digits with XXX-XXX format
                ForEach(0..<6, id: \.self) { index in
                    if index == 3 {
                        // Separator dash
                        Text("-")
                            .font(DesignTokens.bodyFont(size: 36, weight: .light))
                            .foregroundStyle(DesignTokens.textTertiary)
                    }

                    ZStack {
                        // Placeholder X
                        Text("X")
                            .font(DesignTokens.bodyFont(size: 36, weight: .light))
                            .foregroundStyle(DesignTokens.textTertiary)
                            .opacity(index >= code.count ? 1 : 0)

                        // Entered digit
                        if index < code.count {
                            Text(String(code[code.index(code.startIndex, offsetBy: index)]))
                                .font(DesignTokens.bodyFont(size: 36, weight: .regular))
                                .foregroundStyle(DesignTokens.textPrimary)
                        }

                        // Cursor after last entered digit
                        if index == code.count && isCodeFieldFocused && !code.isEmpty {
                            HStack(spacing: 0) {
                                Spacer()
                                Rectangle()
                                    .fill(DesignTokens.gold)
                                    .frame(width: 2, height: 40)
                                    .opacity(cursorOpacity)
                            }
                        }
                    }
                    .frame(width: 24)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture {
                isCodeFieldFocused = true
            }
        }
    }

    /// Blinking cursor animation
    @State private var cursorVisible = true
    private var cursorOpacity: Double {
        cursorVisible ? 1.0 : 0.0
    }

    // MARK: - Error Message

    private func errorMessage(_ message: String) -> some View {
        VStack(spacing: DesignTokens.spacing8) {
            HStack(spacing: DesignTokens.spacing8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(DesignTokens.error)
                Text(message)
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)
            }

            if let remaining = remainingAttempts, remaining > 0 {
                Text("\(remaining) attempt\(remaining == 1 ? "" : "s") remaining")
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.textSecondary)
            }
        }
        .padding(DesignTokens.spacing12)
        .frame(maxWidth: .infinity)
        .background(DesignTokens.error.opacity(0.1))
        .clipShape(.rect(cornerRadius: DesignTokens.radiusMedium))
    }

    // MARK: - Resend Section

    private var resendSection: some View {
        VStack(spacing: DesignTokens.spacing12) {
            if canResend {
                Button {
                    Task {
                        await resendCode()
                    }
                } label: {
                    Text("RESEND CODE")
                        .font(DesignTokens.bodyFont(size: 12, weight: .semibold))
                        .tracking(2)
                        .foregroundStyle(DesignTokens.gold)
                }
                .disabled(isVerifying)
            } else {
                Text("RESEND IN \(resendCountdown)S")
                    .font(DesignTokens.bodyFont(size: 12, weight: .semibold))
                    .tracking(2)
                    .foregroundStyle(DesignTokens.textTertiary)
            }
        }
        .padding(.bottom, DesignTokens.spacing20)
    }

    // MARK: - Masked Phone Number

    /// Masks phone number for display: "+1 *** *** 4567"
    private var maskedPhoneNumber: String {
        // Handle E.164 format: +15551234567
        guard phoneNumber.count >= 4 else { return phoneNumber }

        let lastFour = String(phoneNumber.suffix(4))

        // Try to extract country code (assume +1 for US/Canada if starts with +1)
        if phoneNumber.hasPrefix("+1") && phoneNumber.count >= 11 {
            return "+1 *** *** \(lastFour)"
        } else if phoneNumber.hasPrefix("+") {
            // Generic masking for other country codes
            let countryCode = String(phoneNumber.prefix(while: { $0 == "+" || $0.isNumber }).prefix(3))
            return "\(countryCode) *** *** \(lastFour)"
        }

        return "*** *** \(lastFour)"
    }

    // MARK: - Actions

    /// Verify the entered code
    private func verifyCode() async {
        guard code.count == 6 else { return }
        guard !isVerifying else { return }

        await MainActor.run {
            isVerifying = true
            error = nil
        }

        do {
            let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "verifyPhoneCode") {
                try await apiClient.client.verifyPhoneCode(
                    phoneNumber: phoneNumber,
                    code: code
                )
            }

            await MainActor.run {
                isVerifying = false

                if response.verified {
                    onVerified(response)
                } else {
                    // Verification failed
                    remainingAttempts = response.remainingAttempts
                    if let remaining = response.remainingAttempts, remaining == 0 {
                        error = "Too many attempts. Please request a new code."
                        canResend = true
                        resendCountdown = 0
                    } else {
                        error = "Invalid code. Please try again."
                    }
                    // Clear the code for retry
                    code = ""
                }
            }
        } catch let apiError as APIClientError {
            await MainActor.run {
                isVerifying = false
                code = ""

                switch apiError {
                case .httpError(let statusCode, let body):
                    if statusCode == 429 {
                        error = "Too many requests. Please wait before trying again."
                    } else if statusCode == 400 {
                        // Try to parse error details
                        if body.contains("expired") {
                            error = "Code expired. Please request a new one."
                            canResend = true
                            resendCountdown = 0
                        } else if body.contains("invalid") || body.contains("incorrect") {
                            error = "Invalid code. Please check and try again."
                        } else {
                            error = "Invalid code. Please try again."
                        }
                    } else {
                        error = "Verification failed. Please try again."
                    }
                case .rateLimited:
                    error = "Too many requests. Please wait a moment."
                default:
                    error = "Connection error. Please check your network."
                }
            }
        } catch {
            await MainActor.run {
                isVerifying = false
                code = ""
                self.error = "Something went wrong. Please try again."
            }
        }
    }

    /// Resend verification code
    private func resendCode() async {
        guard canResend else { return }

        await MainActor.run {
            isVerifying = true
            error = nil
        }

        do {
            _ = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "resendPhoneCode") {
                try await apiClient.client.sendPhoneVerificationCode(phoneNumber: phoneNumber)
            }

            await MainActor.run {
                isVerifying = false
                canResend = false
                resendCountdown = 60
                startCountdown()
                code = ""
            }
        } catch {
            await MainActor.run {
                isVerifying = false
                self.error = "Failed to resend code. Please try again."
            }
        }
    }

    // MARK: - Countdown Timer

    private func startCountdown() {
        countdownTask?.cancel()
        blinkTask?.cancel()
        canResend = false
        resendCountdown = 60

        countdownTask = Task {
            while !Task.isCancelled && resendCountdown > 0 {
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    if resendCountdown > 0 {
                        resendCountdown -= 1
                    }
                    if resendCountdown == 0 {
                        canResend = true
                    }
                }
            }
        }

        blinkTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(500))
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    cursorVisible.toggle()
                }
            }
        }
    }
}

// MARK: - Preview

#Preview {
    PhoneVerificationView(
        phoneNumber: "+15551234567",
        onVerified: { response in
            print("Verified: \(response)")
        },
        onBack: {
            print("Back pressed")
        }
    )
    .environment(APIClientWrapper(baseURL: "https://api.example.com"))
}
