//
//  MainTabView.swift
//  PorizoApp
//
//  Main tab bar shell with prominent center Create button.
//  Light mode with rose accent - conveying love and friendship.
//
//  Tab views and flows are extracted to separate files:
//  - Tabs/SongsTabView.swift
//  - Tabs/PoemsTabView.swift
//  - Tabs/ExploreTabView.swift
//  - Tabs/SettingsTabView.swift
//  - Flows/CreateFlowView.swift
//

import SwiftUI

// DesignTokens and Color(hex:) extension are in DesignTokens.swift

struct MainTabView: View {
    let apiClient: APIClient

    @State private var selectedTab: Tab = .songs
    @State private var showCreateFlow = false
    @State private var preselectedOccasion: Occasion?

    // Track creation state (passed to create flow)
    @State private var currentTrackId: String?
    @State private var currentVersionNum: Int?

    enum Tab: Int, CaseIterable {
        case songs = 0
        case poems = 1
        case create = 2
        case explore = 3
        case settings = 4

        var title: String {
            switch self {
            case .songs: return "Songs"
            case .poems: return "Poems"
            case .create: return "Create"
            case .explore: return "Explore"
            case .settings: return "Settings"
            }
        }

        var icon: String {
            switch self {
            case .songs: return "music.note.list"
            case .poems: return "text.book.closed"
            case .create: return "plus.circle.fill"
            case .explore: return "safari"
            case .settings: return "gearshape"
            }
        }
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            // Light background
            DesignTokens.backgroundSubtle.ignoresSafeArea()

            // Content area
            TabView(selection: $selectedTab) {
                // Songs Tab
                SongsTabView(
                    apiClient: apiClient,
                    onDraftSelected: { trackId, versionNum in
                        currentTrackId = trackId
                        currentVersionNum = versionNum
                        showCreateFlow = true
                    }
                )
                .tag(Tab.songs)

                // Poems Tab
                PoemsTabView(apiClient: apiClient)
                    .tag(Tab.poems)

                // Create Tab (placeholder - actual flow is modal)
                Color.clear
                    .tag(Tab.create)

                // Explore Tab
                ExploreTabView(
                    apiClient: apiClient,
                    onOccasionSelected: { occasion in
                        preselectedOccasion = occasion
                        showCreateFlow = true
                    }
                )
                .tag(Tab.explore)

                // Settings Tab
                SettingsTabView(apiClient: apiClient)
                    .tag(Tab.settings)
            }

            // Custom Tab Bar
            customTabBar
        }
        .fullScreenCover(isPresented: $showCreateFlow) {
            CreateFlowView(
                apiClient: apiClient,
                preselectedOccasion: preselectedOccasion,
                resumeTrackId: currentTrackId,
                resumeVersionNum: currentVersionNum,
                onComplete: { trackId, versionNum in
                    currentTrackId = trackId
                    currentVersionNum = versionNum
                    showCreateFlow = false
                    preselectedOccasion = nil
                    selectedTab = .songs
                },
                onCancel: {
                    showCreateFlow = false
                    preselectedOccasion = nil
                    currentTrackId = nil
                    currentVersionNum = nil
                }
            )
        }
        .onChange(of: selectedTab) { _, newTab in
            if newTab == .create {
                currentTrackId = nil
                currentVersionNum = nil
                preselectedOccasion = nil
                showCreateFlow = true
                // Reset to previous tab since Create is a modal
                selectedTab = .songs
            }
        }
    }

    // MARK: - Custom Tab Bar

    private var customTabBar: some View {
        HStack(spacing: 0) {
            ForEach(Tab.allCases, id: \.rawValue) { tab in
                if tab == .create {
                    // Prominent center button
                    createButton
                } else {
                    tabButton(for: tab)
                }
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 8)
        .padding(.bottom, 24) // Safe area
        .background(
            DesignTokens.cardBackground
                .shadow(color: Color.black.opacity(0.05), radius: 8, y: -4)
                .ignoresSafeArea()
        )
    }

    private func tabButton(for tab: Tab) -> some View {
        Button {
            selectedTab = tab
        } label: {
            VStack(spacing: 4) {
                Image(systemName: tab.icon)
                    .font(.system(size: 22))
                Text(tab.title)
                    .font(.caption2)
            }
            .foregroundColor(selectedTab == tab ? DesignTokens.rose : DesignTokens.textSecondary)
            .frame(maxWidth: .infinity)
        }
    }

    private var createButton: some View {
        Button {
            currentTrackId = nil
            currentVersionNum = nil
            preselectedOccasion = nil
            showCreateFlow = true
        } label: {
            ZStack {
                // Solid rose circle (no gradient per design guide)
                Circle()
                    .fill(DesignTokens.rose)
                    .frame(width: 56, height: 56)
                    .accentShadow()

                Image(systemName: "plus")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundColor(.white)
            }
            .offset(y: -16) // Raise above tab bar
        }
        .frame(maxWidth: .infinity)
    }
}

#Preview {
    MainTabView(apiClient: APIClient(baseURL: "http://localhost:3000"))
}
