//
//  SongsTabView.swift
//  PorizoApp
//
//  Songs tab wrapper for MySongsView.
//  Extracted from MainTabView for better modularity.
//

import SwiftUI

// MARK: - Songs Tab View

struct SongsTabView: View {
    let apiClient: APIClient
    @ObservedObject var playerState: PlayerState
    var refreshTrigger: Int = 0
    var onCreateNew: (() -> Void)?
    var onDraftSelected: ((String, Int) -> Void)?

    var body: some View {
        NavigationStack {
            MySongsView(
                apiClient: apiClient,
                playerState: playerState,
                refreshTrigger: refreshTrigger,
                onCreateNew: { onCreateNew?() },
                onBack: { },
                onDraftSelected: onDraftSelected
            )
        }
    }
}

#Preview {
    SongsTabView(
        apiClient: APIClient(baseURL: AppConfig.apiBaseURL),
        playerState: PlayerState()
    )
}
