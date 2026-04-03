//
//  SongsTabView.swift
//  PorizoApp
//
//  Songs tab — Warm Canvas design system with custom header.
//

import SwiftUI

// MARK: - Songs Tab View

struct SongsTabView: View {
    let apiClient: APIClient
    var playerState: PlayerState
    var refreshTrigger: Int = 0
    var onCreateNew: (() -> Void)?
    var onDraftSelected: ((String, Int) -> Void)?
    var onResumeSelected: ((String, Int, CreateFlowResumeTarget) -> Void)?

    var body: some View {
        ZStack {
            // Background: Warm parchment
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Custom header: "My Songs" + filter button
                songsHeader

                // Songs list
                MySongsView(
                    apiClient: apiClient,
                    playerState: playerState,
                    refreshTrigger: refreshTrigger,
                    onCreateNew: { onCreateNew?() },
                    onBack: { },
                    onDraftSelected: onDraftSelected,
                    onResumeSelected: onResumeSelected
                )
            }
        }
    }

    // MARK: - Header (v1.pen design)

    private var songsHeader: some View {
        HStack {
            Text("My Songs")
                .font(DesignTokens.displayFont(size: 28, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)

            Spacer()
        }
        .padding(.horizontal, 20)
        .frame(height: 60)
    }
}

#Preview {
    SongsTabView(
        apiClient: APIClient(baseURL: AppConfig.apiBaseURL),
        playerState: PlayerState()
    )
}
