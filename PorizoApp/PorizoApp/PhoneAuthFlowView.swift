//
//  PhoneAuthFlowView.swift
//  PorizoApp
//
//  Orchestrates the phone authentication flow screens.
//

import SwiftUI

struct PhoneAuthFlowView: View {
    @EnvironmentObject private var authManager: AuthManager

    var body: some View {
        switch authManager.phoneAuthState {
        case .idle:
            EmptyView()
        case .phoneEntry:
            PhoneAuthView(
                onContinue: { phoneNumber, _ in
                    authManager.onPhoneCodeSent(phoneNumber: phoneNumber)
                },
                onBack: {
                    authManager.cancelPhoneAuth()
                }
            )
        case .phoneVerification(let phoneNumber):
            PhoneVerificationView(
                phoneNumber: phoneNumber,
                onVerified: { response in
                    Task {
                        do {
                            try await authManager.handlePhoneVerification(response)
                        } catch {
                            // PhoneVerificationView handles UI errors; keep flow state.
                        }
                    }
                },
                onBack: {
                    authManager.phoneAuthGoBack()
                }
            )
        case .usernameSelection(let registrationToken, let phoneNumber):
            UsernameView(
                registrationToken: registrationToken,
                phoneNumber: phoneNumber,
                onComplete: { response in
                    Task {
                        do {
                            try await authManager.handlePhoneRegistrationResponse(response)
                        } catch {
                            // UsernameView handles UI errors; keep flow state.
                        }
                    }
                },
                onBack: {
                    authManager.phoneAuthGoBack()
                }
            )
        }
    }
}
