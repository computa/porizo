//
//  LegalSheets.swift
//  PorizoApp
//
//  Shared Terms + Privacy sheet presentation. Used by AuthView and PhoneAuthView
//  so the URLs and offline fallback stay in one place.
//

import SwiftUI

private enum LegalLinks {
    static var termsUrl: URL? {
        URL(string: "\(AppConfig.apiBaseURL)/legal/terms")
    }

    static var privacyUrl: URL? {
        URL(string: "\(AppConfig.apiBaseURL)/legal/privacy")
    }

    static var fallbackView: some View {
        VStack(spacing: 12) {
            Text("Legal page unavailable")
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)
            Text("Please try again later.")
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundStyle(DesignTokens.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DesignTokens.background.ignoresSafeArea())
    }
}

private struct LegalSheetsModifier: ViewModifier {
    @Binding var showTerms: Bool
    @Binding var showPrivacy: Bool

    func body(content: Content) -> some View {
        content
            .sheet(isPresented: $showTerms) {
                if let url = LegalLinks.termsUrl {
                    SafariView(url: url)
                } else {
                    LegalLinks.fallbackView
                }
            }
            .sheet(isPresented: $showPrivacy) {
                if let url = LegalLinks.privacyUrl {
                    SafariView(url: url)
                } else {
                    LegalLinks.fallbackView
                }
            }
    }
}

extension View {
    func legalSheets(showTerms: Binding<Bool>, showPrivacy: Binding<Bool>) -> some View {
        modifier(LegalSheetsModifier(showTerms: showTerms, showPrivacy: showPrivacy))
    }
}
