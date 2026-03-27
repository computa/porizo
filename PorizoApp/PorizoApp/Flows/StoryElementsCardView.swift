//
//  StoryElementsCardView.swift
//  PorizoApp
//
//  Extracted from UnifiedCreateFlowView — collapsible tabbed card
//  showing story elements and story strength. Owns expand/tab @State
//  so toggling doesn't re-evaluate the parent body.
//

import SwiftUI

struct StoryElementsCardView: View {
    let currentBeats: [V2Beat]
    let factInventory: [StorySessionFact]
    let readiness: StoryReadinessResponse?

    @State private var isExpanded = false
    @State private var selectedTab: CardTab = .elements

    var body: some View {
        VStack(spacing: 0) {
            // Tab header
            HStack(spacing: 0) {
                ForEach(CardTab.allCases, id: \.self) { tab in
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            selectedTab = tab
                            if !isExpanded { isExpanded = true }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: tab == .elements ? "doc.text.fill" : "chart.bar.fill")
                                .font(.system(size: 11))
                            Text(tab.rawValue)
                                .font(DesignTokens.bodyFont(size: 12, weight: .semibold))
                        }
                        .foregroundStyle(selectedTab == tab ? DesignTokens.textPrimary : DesignTokens.textTertiary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(selectedTab == tab ? DesignTokens.gold.opacity(0.1) : .clear)
                    }
                }

                Button {
                    withAnimation(.easeInOut(duration: 0.25)) { isExpanded.toggle() }
                } label: {
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(DesignTokens.textTertiary)
                        .frame(width: 40)
                        .padding(.vertical, 10)
                }
            }

            if isExpanded {
                Divider().background(DesignTokens.border.opacity(0.5))

                if selectedTab == .elements {
                    elementsTabContent
                } else {
                    strengthTabContent
                }
            }
        }
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                .stroke(DesignTokens.gold.opacity(0.15), lineWidth: 0.5)
        )
    }

    // MARK: - Elements Tab

    private var elementsTabContent: some View {
        VStack(spacing: 0) {
            if factInventory.isEmpty {
                Text("Share your story to see elements appear here")
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.textTertiary)
                    .padding(14)
            } else {
                ForEach(Array(factInventory.enumerated()), id: \.offset) { index, fact in
                    if index > 0 {
                        Divider().background(DesignTokens.border.opacity(0.5)).padding(.leading, 38)
                    }
                    HStack(spacing: 10) {
                        Image(systemName: iconForBeat(fact.beat))
                            .font(.system(size: 11))
                            .foregroundStyle(DesignTokens.gold)
                            .frame(width: 20)
                        Text(fact.beat ?? "Detail")
                            .font(DesignTokens.bodyFont(size: 11))
                            .foregroundStyle(DesignTokens.textTertiary)
                            .frame(width: 65, alignment: .leading)
                        Text(fact.text)
                            .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                            .foregroundStyle(DesignTokens.textPrimary)
                            .lineLimit(2)
                        Spacer()
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                }
            }
        }
    }

    // MARK: - Strength Tab

    private var strengthTabContent: some View {
        let focusedElementId = readiness?.primaryGap?.elementId

        return VStack(spacing: 4) {
            ForEach(currentBeats) { beat in
                let isFocused = focusedElementId == beat.id
                let accentColor = beat.isFilled ? DesignTokens.success : DesignTokens.gold

                VStack(alignment: .leading, spacing: 5) {
                    HStack {
                        Circle()
                            .fill(accentColor)
                            .frame(width: 7, height: 7)
                        Text(beat.displayName)
                            .font(DesignTokens.bodyFont(size: 13, weight: beat.isFilled ? .regular : .bold))
                            .foregroundStyle(beat.isFilled ? DesignTokens.textSecondary : DesignTokens.textPrimary)
                        if isFocused {
                            Text("Current focus")
                                .font(DesignTokens.bodyFont(size: 10, weight: .semibold))
                                .foregroundStyle(DesignTokens.gold.opacity(0.85))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(DesignTokens.gold.opacity(0.14), in: Capsule())
                        }
                        Spacer()
                        if beat.isFilled {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 16))
                                .foregroundStyle(DesignTokens.success.opacity(0.7))
                        }
                    }
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 3)
                                .fill(accentColor.opacity(0.2))
                                .frame(height: 4)
                            RoundedRectangle(cornerRadius: 3)
                                .fill(accentColor)
                                .frame(width: geo.size.width * beat.strength, height: 4)
                        }
                    }
                    .frame(height: 4)
                }
                .padding(.horizontal, isFocused ? 10 : 0)
                .padding(.vertical, 6)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(isFocused ? DesignTokens.gold.opacity(0.08) : .clear)
                )
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }

    // MARK: - Helpers

    private func iconForBeat(_ beat: String?) -> String {
        switch beat?.lowercased() {
        case "setting": return "mountain.2.fill"
        case "feeling": return "heart.fill"
        case "bond": return "person.2.fill"
        case "moment": return "camera.fill"
        case "details": return "sparkle"
        case "relationship": return "heart.circle.fill"
        default: return "circle.fill"
        }
    }
}
