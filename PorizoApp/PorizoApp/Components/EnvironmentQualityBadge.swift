//
//  EnvironmentQualityBadge.swift
//  PorizoApp
//

import SwiftUI

#if os(iOS)

struct EnvironmentQualityBadge: View {
    let qualityLevel: Int
    let qualityDescription: String
    var compact: Bool = false

    private var badgeColor: Color {
        switch qualityLevel {
        case 3: return .green
        case 2: return Color.green.opacity(0.7)
        case 1: return .yellow
        default: return .orange
        }
    }

    private var iconName: String {
        switch qualityLevel {
        case 3: return "checkmark.circle.fill"
        case 2: return "checkmark.circle"
        case 1: return "exclamationmark.triangle.fill"
        default: return "exclamationmark.triangle.fill"
        }
    }

    var body: some View {
        if compact {
            compactView
        } else {
            fullView
        }
    }

    private var compactView: some View {
        Image(systemName: iconName)
            .font(.system(size: 16, weight: .semibold))
            .foregroundColor(badgeColor)
    }

    private var fullView: some View {
        HStack(spacing: 6) {
            Image(systemName: iconName)
                .font(.system(size: 12, weight: .semibold))

            Text(qualityDescription)
                .font(.system(size: 12, weight: .medium))
        }
        .foregroundColor(textColor)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(badgeColor.opacity(0.2))
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(badgeColor.opacity(0.5), lineWidth: 1)
        )
    }

    private var textColor: Color {
        switch qualityLevel {
        case 3, 2: return .green
        case 1: return .yellow
        default: return .orange
        }
    }
}

extension EnvironmentQualityBadge {
    init(metrics: LiveAudioMetrics, compact: Bool = false) {
        self.qualityLevel = metrics.qualityLevel
        self.qualityDescription = metrics.qualityDescription
        self.compact = compact
    }
}

// MARK: - Previews

#Preview("Environment Badges") {
    VStack(spacing: 16) {
        EnvironmentQualityBadge(qualityLevel: 3, qualityDescription: "Great")
        EnvironmentQualityBadge(qualityLevel: 2, qualityDescription: "Good")
        EnvironmentQualityBadge(qualityLevel: 1, qualityDescription: "Noisy")
        EnvironmentQualityBadge(qualityLevel: 0, qualityDescription: "Very Noisy")

        Divider()

        HStack(spacing: 20) {
            EnvironmentQualityBadge(qualityLevel: 3, qualityDescription: "Great", compact: true)
            EnvironmentQualityBadge(qualityLevel: 2, qualityDescription: "Good", compact: true)
            EnvironmentQualityBadge(qualityLevel: 1, qualityDescription: "Noisy", compact: true)
            EnvironmentQualityBadge(qualityLevel: 0, qualityDescription: "Very Noisy", compact: true)
        }
    }
    .padding()
    .background(Color.black)
}

#endif
