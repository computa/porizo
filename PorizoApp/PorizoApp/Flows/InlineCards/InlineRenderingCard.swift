//
//  InlineRenderingCard.swift
//  PorizoApp
//
//  Inline rendering progress card for the All-in-Chat creation flow.
//  Sheet-style card with waveform visualization, progress bar, and
//  5-step checklist mapped to render progress.
//

import SwiftUI

struct InlineRenderingCard: View {
    var renderController: RenderController
    let isFullRender: Bool
    var onRetry: (() -> Void)?
    var onEditLyrics: (([String]) -> Void)?

    // Deterministic waveform bar heights (no randomness in body)
    private let waveformHeights: [CGFloat] = [
        12, 24, 8, 30, 16, 28, 10, 32, 14, 26,
        18, 22, 8, 30, 12, 28, 20, 14, 24, 10
    ]

    private let steps = [
        "Lyrics finalized",
        "Melody composed",
        "Arrangement",
        "Vocal synthesis",
        "Final mix & master",
    ]

    private var currentProgress: Int {
        renderController.progress ?? 0
    }

    /// Map 0-100 progress to a 0-4 step index
    private var activeStepIndex: Int {
        switch currentProgress {
        case 0..<20:  return 0
        case 20..<40: return 1
        case 40..<60: return 2
        case 60..<80: return 3
        default:      return 4
        }
    }

    private var isFailed: Bool {
        if case .failed = renderController.renderPhase { return true }
        if isFullRender, case .failed = renderController.fullRenderPhase { return true }
        return false
    }

    private var failureMessage: String? {
        if case .failed(let msg) = renderController.renderPhase { return msg }
        if isFullRender, case .failed(let msg) = renderController.fullRenderPhase { return msg }
        return nil
    }

    var body: some View {
        VStack(spacing: 0) {
            // Sheet handle
            RoundedRectangle(cornerRadius: 2)
                .fill(DesignTokens.textTertiary)
                .frame(width: 36, height: 4)
                .padding(.top, 12)
                .padding(.bottom, 20)

            if isFailed {
                failedState
            } else {
                renderingState
            }
        }
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(DesignTokens.border, lineWidth: 0.5)
        )
    }

    // MARK: - Rendering State

    private var renderingState: some View {
        VStack(spacing: 0) {
            // Waveform
            waveform
                .padding(.bottom, 20)

            // Progress section
            progressSection
                .padding(.horizontal, 16)
                .padding(.bottom, 20)

            // Step checklist
            stepChecklist
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
        }
    }

    private var waveform: some View {
        HStack(spacing: 3) {
            ForEach(0..<20, id: \.self) { i in
                RoundedRectangle(cornerRadius: 2)
                    .fill(DesignTokens.gold.opacity(i % 3 == 0 ? 0.8 : 0.3))
                    .frame(width: 4, height: waveformHeights[i])
            }
        }
        .frame(height: 36)
    }

    private var progressSection: some View {
        VStack(spacing: 12) {
            // Header row
            HStack {
                Image(systemName: "waveform")
                    .font(.system(size: 14))
                    .foregroundStyle(DesignTokens.gold)
                Text(isFullRender ? "Rendering full song..." : "Rendering your song...")
                    .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                    .foregroundStyle(DesignTokens.textPrimary)
                Spacer()
                Text("\(currentProgress)%")
                    .font(DesignTokens.bodyFont(size: 13, weight: .semibold))
                    .foregroundStyle(DesignTokens.gold)
            }

            // Progress bar
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(DesignTokens.gold.opacity(0.15))
                        .frame(height: 6)
                    RoundedRectangle(cornerRadius: 4)
                        .fill(DesignTokens.gold)
                        .frame(
                            width: geo.size.width * (Double(currentProgress) / 100.0),
                            height: 6
                        )
                        .animation(.easeInOut(duration: 0.3), value: currentProgress)
                }
            }
            .frame(height: 6)

            // Status text
            if let status = renderController.statusMessage {
                Text(status)
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.textTertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var stepChecklist: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                let isDone = index < activeStepIndex
                let isActive = index == activeStepIndex

                HStack(spacing: 10) {
                    Image(systemName: isDone ? "checkmark.circle.fill" : (isActive ? "circle.dotted" : "circle"))
                        .font(.system(size: 18))
                        .foregroundStyle(
                            isDone ? DesignTokens.success : (isActive ? DesignTokens.gold : DesignTokens.textTertiary)
                        )
                    Text(step)
                        .font(DesignTokens.bodyFont(size: 15, weight: isActive ? .bold : .regular))
                        .foregroundStyle(
                            isDone ? DesignTokens.textSecondary : (isActive ? DesignTokens.textPrimary : DesignTokens.textTertiary)
                        )
                }
            }
        }
    }

    // MARK: - Failed State

    private var failedState: some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(DesignTokens.warning)

            Text("Rendering failed")
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)

            if let message = failureMessage {
                Text(message)
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16)
            }

            VStack(spacing: 10) {
                // Retry button
                Button {
                    onRetry?()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 13))
                        Text("Try Again")
                            .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                    }
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(DesignTokens.gold)
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                }

                // Edit lyrics (for provider-policy failures with flagged terms)
                if renderController.shouldShowEditLyricsCTA() {
                    Button {
                        onEditLyrics?(renderController.errorDetail.terms)
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "pencil")
                                .font(.system(size: 13))
                            Text("Edit Lyrics")
                                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        }
                        .foregroundStyle(DesignTokens.gold)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(DesignTokens.gold.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                        .overlay(
                            RoundedRectangle(cornerRadius: DesignTokens.radiusCTA)
                                .stroke(DesignTokens.gold.opacity(0.3), lineWidth: 0.5)
                        )
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .padding(.top, 8)
    }
}

// MARK: - Preview

#Preview {
    ZStack {
        DesignTokens.background.ignoresSafeArea()

        ScrollView {
            VStack(spacing: 16) {
                // Simulated rendering state
                InlineRenderingCard(
                    renderController: {
                        let ctrl = RenderController(apiClient: APIClient(baseURL: AppConfig.apiBaseURL))
                        return ctrl
                    }(),
                    isFullRender: false
                )
            }
            .padding(.horizontal, 16)
        }
    }
}
