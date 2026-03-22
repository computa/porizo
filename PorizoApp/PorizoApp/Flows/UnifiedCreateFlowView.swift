//
//  UnifiedCreateFlowView.swift
//  PorizoApp
//
//  Production unified creation flow — single-thread chat-to-player experience.
//  Behind feature flag: AppConfig.useUnifiedCreateFlow
//
//  Accepts identical parameters to CreateFlowView for drop-in routing.
//  Reuses existing CreateFlowResumeCoordinator with CreateFlowState milestones.
//

import SwiftUI

struct UnifiedCreateFlowView: View {
    let apiClient: APIClient
    var preselectedOccasion: Occasion?
    var preselectedType: CreateFlowKind?
    var resumeTrackId: String?
    var resumeVersionNum: Int?
    var resumeTarget: CreateFlowResumeTarget?
    var variationSourcePoem: Poem?
    var maxSongRerolls: Int? = nil
    var initialSongRerollsUsed: Int = 0
    var allowedRerollTypes: [RerollType] = RerollType.allCases
    var onSongRerollUsed: ((Int) -> Void)? = nil
    var onPoemComplete: ((Poem) -> Void)? = nil
    let onComplete: (String, Int) -> Void
    let onCancel: () -> Void

    // Engine + coordinators (same as CreateFlowView)
    @State private var storyEngine: V2StoryEngine
    @State private var apiWrapper: APIClientWrapper
    @State private var setup = StorySetup()
    @State private var songFlow = SongFlowCoordinator()
    @State private var selectedType: CreateFlowKind?

    // Resume
    private let resumeCoordinator: CreateFlowResumeCoordinator

    init(
        apiClient: APIClient,
        preselectedOccasion: Occasion? = nil,
        preselectedType: CreateFlowKind? = nil,
        resumeTrackId: String? = nil,
        resumeVersionNum: Int? = nil,
        resumeTarget: CreateFlowResumeTarget? = nil,
        variationSourcePoem: Poem? = nil,
        maxSongRerolls: Int? = nil,
        initialSongRerollsUsed: Int = 0,
        allowedRerollTypes: [RerollType] = RerollType.allCases,
        onSongRerollUsed: ((Int) -> Void)? = nil,
        onPoemComplete: ((Poem) -> Void)? = nil,
        onComplete: @escaping (String, Int) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.apiClient = apiClient
        self.preselectedOccasion = preselectedOccasion
        self.preselectedType = preselectedType
        self.resumeTrackId = resumeTrackId
        self.resumeVersionNum = resumeVersionNum
        self.resumeTarget = resumeTarget
        self.variationSourcePoem = variationSourcePoem
        self.maxSongRerolls = maxSongRerolls
        self.initialSongRerollsUsed = initialSongRerollsUsed
        self.allowedRerollTypes = allowedRerollTypes
        self.onSongRerollUsed = onSongRerollUsed
        self.onPoemComplete = onPoemComplete
        self.onComplete = onComplete
        self.onCancel = onCancel
        self.resumeCoordinator = CreateFlowResumeCoordinator()
        _storyEngine = State(initialValue: V2StoryEngine(apiClient: apiClient))
        _apiWrapper = State(initialValue: APIClientWrapper(client: apiClient))
        _selectedType = State(initialValue: preselectedType)
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 20) {
                Spacer()

                Image(systemName: "sparkles")
                    .font(.system(size: 48))
                    .foregroundStyle(DesignTokens.gold)

                Text("Unified Creation Flow")
                    .font(DesignTokens.displayFont(size: 24))
                    .foregroundStyle(DesignTokens.textPrimary)

                Text("Coming in Phase 2")
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundStyle(DesignTokens.textSecondary)

                Text("This will be the single-thread\nchat-to-player experience.")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textTertiary)
                    .multilineTextAlignment(.center)

                Spacer()

                Button {
                    onCancel()
                } label: {
                    Text("Close")
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(DesignTokens.gold)
                        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
            }
        }
    }
}
