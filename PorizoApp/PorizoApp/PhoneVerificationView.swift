//
//  PhoneVerificationView.swift
//  PorizoApp
//
//  Phone verification code entry matching Warm Canvas gallery design.
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

    /// Task handle for resend countdown
    @State private var countdownTask: Task<Void, Never>?

    // MARK: - Body

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Navigation bar with back button
                HStack {
                    Button { onBack() } label: {
                        ZStack {
                            Circle()
                                .fill(Color.black.opacity(0.05))
                                .frame(width: 44, height: 44)
                            Image(systemName: "arrow.left")
                                .font(.system(size: 18))
                                .foregroundStyle(DesignTokens.textPrimary)
                        }
                    }
                    Spacer()
                    Color.clear.frame(width: 44, height: 44)
                }
                .padding(.horizontal, DesignTokens.spacing20)
                .padding(.bottom, DesignTokens.spacing8)

                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        // Title + subtitle
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Enter verification code")
                                .font(DesignTokens.bodyFont(size: 20, weight: .bold))
                                .foregroundStyle(DesignTokens.textPrimary)
                            Text("Sent to \(maskedPhoneNumber)")
                                .font(DesignTokens.bodyFont(size: 14))
                                .foregroundStyle(DesignTokens.textSecondary)
                        }

                        // 6 digit boxes
                        codeInputDisplay

                        // Error message
                        if let error = error {
                            errorMessage(error)
                        }

                        // Verify button
                        Button {
                            Task { await verifyCode() }
                        } label: {
                            HStack(spacing: 8) {
                                if isVerifying {
                                    ProgressView()
                                        .tint(.white)
                                }
                                Text("Verify")
                                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                            }
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(DesignTokens.gold)
                            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                        }
                        .disabled(code.count < 6 || isVerifying)
                        .opacity(code.count < 6 ? 0.5 : 1.0)
                        .buttonStyle(.plain)

                        // Resend code + Wrong number? links
                        resendSection
                    }
                    .padding(.horizontal, DesignTokens.spacing20)
                    .padding(.bottom, DesignTokens.spacing32)
                }
                .scrollIndicators(.hidden)
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

    /// Visual display of 6 code digits as individual boxes with hidden TextField for input
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

            // 6 individual digit boxes (Warm Canvas gallery style)
            HStack(spacing: 8) {
                ForEach(0..<6, id: \.self) { index in
                    Text(index < code.count ? String(code[code.index(code.startIndex, offsetBy: index)]) : "")
                        .font(.system(size: 24, weight: .semibold, design: .monospaced))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .frame(width: 44, height: 56)
                        .background(DesignTokens.surface)
                        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
                        .overlay(
                            RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                                .stroke(index == code.count && isCodeFieldFocused
                                        ? DesignTokens.gold
                                        : DesignTokens.border,
                                        lineWidth: 1.5)
                        )
                }
            }
            .contentShape(Rectangle())
            .onTapGesture {
                isCodeFieldFocused = true
            }
            .accessibilityAddTraits(.isButton)
        }
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
        HStack(spacing: 16) {
            if canResend {
                Button {
                    Task { await resendCode() }
                } label: {
                    Text("Resend code")
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        .foregroundStyle(DesignTokens.gold)
                }
                .disabled(isVerifying)
            } else {
                Text("Resend in \(resendCountdown)s")
                    .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                    .foregroundStyle(DesignTokens.textSecondary)
            }

            Button {
                onBack()
            } label: {
                Text("Wrong number?")
                    .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                    .foregroundStyle(DesignTokens.textSecondary)
            }
        }
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
    @MainActor private func verifyCode() async {
        guard code.count == 6 else { return }
        guard !isVerifying else { return }

        isVerifying = true
        error = nil

        do {
            let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "verifyPhoneCode") {
                try await apiClient.client.verifyPhoneCode(
                    phoneNumber: phoneNumber,
                    code: code
                )
            }

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
        } catch let apiError as APIClientError {
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
        } catch {
            isVerifying = false
            code = ""
            self.error = "Something went wrong. Please try again."
        }
    }

    /// Resend verification code
    @MainActor private func resendCode() async {
        guard canResend else { return }

        isVerifying = true
        error = nil

        do {
            _ = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "resendPhoneCode") {
                try await apiClient.client.sendPhoneVerificationCode(phoneNumber: phoneNumber)
            }

            isVerifying = false
            canResend = false
            resendCountdown = 60
            startCountdown()
            code = ""
        } catch {
            isVerifying = false
            self.error = "Failed to resend code. Please try again."
        }
    }

    // MARK: - Countdown Timer

    private func startCountdown() {
        countdownTask?.cancel()
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
