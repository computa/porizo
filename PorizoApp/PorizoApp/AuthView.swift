//
//  AuthView.swift
//  PorizoApp
//
//  Login and Signup views for user authentication.
//

import SwiftUI
import AuthenticationServices

// MARK: - AuthView (Container)

/// Container view that switches between Login and Signup
struct AuthView: View {
    @EnvironmentObject var authManager: AuthManager
    @State private var showSignup = false
    @State private var showForgotPassword = false

    var body: some View {
        NavigationStack {
            if showSignup {
                SignupView(showSignup: $showSignup)
            } else {
                LoginView(showSignup: $showSignup, showForgotPassword: $showForgotPassword)
            }
        }
        .sheet(isPresented: $showForgotPassword) {
            ForgotPasswordView()
        }
    }
}

// MARK: - LoginView

struct LoginView: View {
    @EnvironmentObject var authManager: AuthManager
    @Binding var showSignup: Bool
    @Binding var showForgotPassword: Bool

    @State private var email = ""
    @State private var password = ""
    @State private var errorMessage: String?
    @State private var isLoading = false

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Logo/Header
                VStack(spacing: 8) {
                    Image(systemName: "music.note.house.fill")
                        .font(.system(size: 60))
                        .foregroundStyle(DesignTokens.rose)

                    Text("Welcome back")
                        .font(.title)
                        .fontWeight(.bold)

                    Text("Sign in to continue creating songs")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 40)

                // Error Banner
                if let error = errorMessage {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                        Text(error)
                            .font(.subheadline)
                        Spacer()
                    }
                    .padding()
                    .background(Color.red.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }

                // Email/Password Fields
                VStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Email")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField("your@email.com", text: $email)
                            .textContentType(.emailAddress)
                            .keyboardType(.emailAddress)
                            .autocapitalization(.none)
                            .autocorrectionDisabled()
                            .padding()
                            .background(Color(.secondarySystemBackground))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Password")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        SecureField("Password", text: $password)
                            .textContentType(.password)
                            .padding()
                            .background(Color(.secondarySystemBackground))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    }

                    HStack {
                        Spacer()
                        Button("Forgot password?") {
                            showForgotPassword = true
                        }
                        .font(.subheadline)
                        .foregroundStyle(DesignTokens.rose)
                    }
                }

                // Login Button
                Button {
                    Task { await performLogin() }
                } label: {
                    if isLoading {
                        ProgressView()
                            .tint(.white)
                    } else {
                        Text("Sign In")
                            .fontWeight(.semibold)
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .background(isFormValid ? DesignTokens.rose : Color.gray)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .disabled(!isFormValid || isLoading)

                // Divider
                HStack {
                    Rectangle()
                        .fill(Color.secondary.opacity(0.3))
                        .frame(height: 1)
                    Text("or")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Rectangle()
                        .fill(Color.secondary.opacity(0.3))
                        .frame(height: 1)
                }
                .padding(.vertical, 8)

                // Sign in with Apple
                SignInWithAppleButton(.signIn) { request in
                    request.requestedScopes = [.email, .fullName]
                } onCompletion: { result in
                    handleAppleSignIn(result)
                }
                .signInWithAppleButtonStyle(.black)
                .frame(height: 50)
                .clipShape(RoundedRectangle(cornerRadius: 12))

                Spacer()

                // Switch to Signup
                HStack {
                    Text("Don't have an account?")
                        .foregroundStyle(.secondary)
                    Button("Sign up") {
                        withAnimation {
                            showSignup = true
                        }
                    }
                    .fontWeight(.semibold)
                    .foregroundStyle(DesignTokens.rose)
                }
                .padding(.bottom, 20)
            }
            .padding(.horizontal, 24)
        }
        .navigationBarHidden(true)
    }

    private var isFormValid: Bool {
        !email.isEmpty && !password.isEmpty && password.count >= 8
    }

    private func performLogin() async {
        errorMessage = nil
        isLoading = true
        defer { isLoading = false }

        do {
            try await authManager.login(email: email, password: password)
        } catch let error as AuthError {
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = "An unexpected error occurred"
        }
    }

    private func handleAppleSignIn(_ result: Result<ASAuthorization, Error>) {
        Task {
            isLoading = true
            defer { isLoading = false }

            switch result {
            case .success(let authorization):
                do {
                    try await authManager.handleAppleSignIn(authorization: authorization)
                } catch let error as AuthError {
                    errorMessage = error.localizedDescription
                } catch {
                    errorMessage = "Apple sign-in failed"
                }
            case .failure(let error):
                // User cancelled or other error
                if (error as NSError).code != ASAuthorizationError.canceled.rawValue {
                    errorMessage = "Apple sign-in failed"
                }
            }
        }
    }
}

// MARK: - SignupView

struct SignupView: View {
    @EnvironmentObject var authManager: AuthManager
    @Binding var showSignup: Bool

    @State private var email = ""
    @State private var password = ""
    @State private var name = ""
    @State private var errorMessage: String?
    @State private var isLoading = false

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Header
                VStack(spacing: 8) {
                    Image(systemName: "music.note.house.fill")
                        .font(.system(size: 60))
                        .foregroundStyle(DesignTokens.rose)

                    Text("Create account")
                        .font(.title)
                        .fontWeight(.bold)

                    Text("Start creating personalized songs")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 40)

                // Error Banner
                if let error = errorMessage {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                        Text(error)
                            .font(.subheadline)
                        Spacer()
                    }
                    .padding()
                    .background(Color.red.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }

                // Form Fields
                VStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Name (optional)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField("Your name", text: $name)
                            .textContentType(.name)
                            .padding()
                            .background(Color(.secondarySystemBackground))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Email")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField("your@email.com", text: $email)
                            .textContentType(.emailAddress)
                            .keyboardType(.emailAddress)
                            .autocapitalization(.none)
                            .autocorrectionDisabled()
                            .padding()
                            .background(Color(.secondarySystemBackground))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("Password")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Spacer()
                            if !password.isEmpty {
                                Text(password.count >= 8 ? "Strong" : "Too short")
                                    .font(.caption)
                                    .foregroundStyle(password.count >= 8 ? .green : .orange)
                            }
                        }
                        SecureField("At least 8 characters", text: $password)
                            .textContentType(.newPassword)
                            .padding()
                            .background(Color(.secondarySystemBackground))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }

                // Signup Button
                Button {
                    Task { await performSignup() }
                } label: {
                    if isLoading {
                        ProgressView()
                            .tint(.white)
                    } else {
                        Text("Create Account")
                            .fontWeight(.semibold)
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .background(isFormValid ? DesignTokens.rose : Color.gray)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .disabled(!isFormValid || isLoading)

                // Divider
                HStack {
                    Rectangle()
                        .fill(Color.secondary.opacity(0.3))
                        .frame(height: 1)
                    Text("or")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Rectangle()
                        .fill(Color.secondary.opacity(0.3))
                        .frame(height: 1)
                }
                .padding(.vertical, 8)

                // Sign up with Apple
                SignInWithAppleButton(.signUp) { request in
                    request.requestedScopes = [.email, .fullName]
                } onCompletion: { result in
                    handleAppleSignIn(result)
                }
                .signInWithAppleButtonStyle(.black)
                .frame(height: 50)
                .clipShape(RoundedRectangle(cornerRadius: 12))

                // Terms
                Text("By creating an account, you agree to our Terms of Service and Privacy Policy")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                Spacer()

                // Switch to Login
                HStack {
                    Text("Already have an account?")
                        .foregroundStyle(.secondary)
                    Button("Sign in") {
                        withAnimation {
                            showSignup = false
                        }
                    }
                    .fontWeight(.semibold)
                    .foregroundStyle(DesignTokens.rose)
                }
                .padding(.bottom, 20)
            }
            .padding(.horizontal, 24)
        }
        .navigationBarHidden(true)
    }

    private var isFormValid: Bool {
        !email.isEmpty && password.count >= 8
    }

    private func performSignup() async {
        errorMessage = nil
        isLoading = true
        defer { isLoading = false }

        do {
            try await authManager.signup(email: email, password: password, name: name.isEmpty ? nil : name)
        } catch let error as AuthError {
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = "An unexpected error occurred"
        }
    }

    private func handleAppleSignIn(_ result: Result<ASAuthorization, Error>) {
        Task {
            isLoading = true
            defer { isLoading = false }

            switch result {
            case .success(let authorization):
                do {
                    try await authManager.handleAppleSignIn(authorization: authorization)
                } catch let error as AuthError {
                    errorMessage = error.localizedDescription
                } catch {
                    errorMessage = "Apple sign-in failed"
                }
            case .failure(let error):
                if (error as NSError).code != ASAuthorizationError.canceled.rawValue {
                    errorMessage = "Apple sign-in failed"
                }
            }
        }
    }
}

// MARK: - ForgotPasswordView

struct ForgotPasswordView: View {
    @EnvironmentObject var authManager: AuthManager
    @Environment(\.dismiss) var dismiss

    @State private var email = ""
    @State private var isLoading = false
    @State private var showSuccess = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Image(systemName: "envelope.badge.fill")
                    .font(.system(size: 50))
                    .foregroundStyle(DesignTokens.rose)
                    .padding(.top, 40)

                Text("Reset Password")
                    .font(.title2)
                    .fontWeight(.bold)

                Text("Enter your email and we'll send you a link to reset your password.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                if showSuccess {
                    HStack {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                        Text("If an account exists, you'll receive an email shortly.")
                            .font(.subheadline)
                    }
                    .padding()
                    .background(Color.green.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }

                if let error = errorMessage {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                        Text(error)
                            .font(.subheadline)
                    }
                    .padding()
                    .background(Color.red.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }

                TextField("your@email.com", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .autocapitalization(.none)
                    .autocorrectionDisabled()
                    .padding()
                    .background(Color(.secondarySystemBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 10))

                Button {
                    Task { await requestReset() }
                } label: {
                    if isLoading {
                        ProgressView()
                            .tint(.white)
                    } else {
                        Text("Send Reset Link")
                            .fontWeight(.semibold)
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .background(!email.isEmpty ? DesignTokens.rose : Color.gray)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .disabled(email.isEmpty || isLoading)

                Spacer()
            }
            .padding(.horizontal, 24)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func requestReset() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            try await authManager.requestPasswordReset(email: email)
            showSuccess = true
        } catch {
            errorMessage = "Failed to send reset email"
        }
    }
}

// MARK: - Previews

#Preview("Login") {
    LoginView(showSignup: .constant(false), showForgotPassword: .constant(false))
        .environmentObject(AuthManager())
}

#Preview("Signup") {
    SignupView(showSignup: .constant(true))
        .environmentObject(AuthManager())
}
