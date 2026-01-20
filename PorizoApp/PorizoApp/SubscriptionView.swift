//
//  SubscriptionView.swift
//  PorizoApp
//
//  Premium subscription paywall with hero section, plan selection cards,
//  and benefits list. Designed to match polished competitor apps.
//

import SwiftUI
import StoreKit

// MARK: - Subscription View

struct SubscriptionView: View {
    @ObservedObject var storeKit: StoreKitManager
    @Environment(\.dismiss) private var dismiss

    @State private var selectedPlan: SelectedPlan = .annual
    @State private var showError = false
    @State private var errorMessage = ""

    enum SelectedPlan {
        case monthly
        case annual
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: DesignTokens.spacing28) {
                        // Hero section with social proof
                        heroSection

                        // Popular badge
                        popularBadge

                        // Plan selection cards
                        planSelectionSection

                        // Benefits list
                        benefitsSection

                        // Cancel anytime reassurance
                        reassuranceText

                        // CTA button
                        ctaButton

                        // Footer with legal links
                        footerSection
                    }
                    .padding(.horizontal, DesignTokens.spacing16)
                    .padding(.top, DesignTokens.spacing16)
                    .padding(.bottom, DesignTokens.spacing28)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(DesignTokens.textSecondary)
                            .frame(width: 28, height: 28)
                            .background(DesignTokens.backgroundSubtle)
                            .clipShape(Circle())
                    }
                }
            }
            .alert("Error", isPresented: $showError) {
                Button("OK", role: .cancel) { }
            } message: {
                Text(errorMessage)
            }
            .overlay {
                if storeKit.purchaseState.isLoading {
                    loadingOverlay
                }
            }
            .onChange(of: storeKit.purchaseState) { _, newState in
                handlePurchaseStateChange(newState)
            }
        }
    }

    // MARK: - Hero Section

    private var heroSection: some View {
        VStack(spacing: DesignTokens.spacing16) {
            // Social proof with laurel wreath
            HStack(spacing: DesignTokens.spacing8) {
                Image(systemName: "laurel.leading")
                    .font(.title3)
                    .foregroundColor(DesignTokens.rose)

                Text("1,000+ Songs Created")
                    .font(.subheadline.bold())
                    .foregroundColor(DesignTokens.textPrimary)

                Image(systemName: "laurel.trailing")
                    .font(.title3)
                    .foregroundColor(DesignTokens.rose)
            }

            // Hero headline
            VStack(spacing: DesignTokens.spacing8) {
                Text("Create Personalized")
                    .font(.title.bold())
                    .foregroundColor(DesignTokens.textPrimary)

                Text("Songs with Porizo")
                    .font(.title.bold())
                    .foregroundColor(DesignTokens.rose)
            }
        }
        .padding(.top, DesignTokens.spacing16)
    }

    // MARK: - Popular Badge

    private var popularBadge: some View {
        HStack(spacing: DesignTokens.spacing8) {
            Image(systemName: "party.popper.fill")
                .font(.subheadline)

            Text("82% of users choose this")
                .font(.subheadline.weight(.medium))
        }
        .foregroundColor(DesignTokens.rose)
        .padding(.horizontal, DesignTokens.spacing16)
        .padding(.vertical, DesignTokens.spacing12)
        .background(DesignTokens.roseMuted)
        .clipShape(Capsule())
    }

    // MARK: - Plan Selection

    private var planSelectionSection: some View {
        VStack(spacing: DesignTokens.spacing12) {
            // Annual plan
            if let product = storeKit.product(for: .proAnnual) {
                PlanSelectionCard(
                    isSelected: selectedPlan == .annual,
                    planName: "Annual",
                    price: product.displayPrice,
                    pricePerWeek: calculateWeeklyPrice(from: product),
                    savings: "Save 33%",
                    onSelect: { selectedPlan = .annual }
                )
            }

            // Monthly plan
            if let product = storeKit.product(for: .proMonthly) {
                PlanSelectionCard(
                    isSelected: selectedPlan == .monthly,
                    planName: "Monthly",
                    price: product.displayPrice,
                    pricePerWeek: nil,
                    savings: nil,
                    onSelect: { selectedPlan = .monthly }
                )
            }
        }
    }

    // MARK: - Benefits Section

    private var benefitsSection: some View {
        VStack(spacing: DesignTokens.spacing12) {
            BenefitRow(icon: "music.note.list", text: "Create personalized songs")
            BenefitRow(icon: "waveform", text: "Voice conversion technology")
            BenefitRow(icon: "square.and.arrow.up", text: "Share with friends & family")
            BenefitRow(icon: "star.fill", text: "Priority rendering queue")
        }
        .padding(DesignTokens.spacing16)
        .background(DesignTokens.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusLarge))
        .elevation(.level1)
    }

    // MARK: - Reassurance Text

    private var reassuranceText: some View {
        HStack(spacing: DesignTokens.spacing8) {
            Image(systemName: "checkmark.shield.fill")
                .foregroundColor(DesignTokens.success)

            Text("Cancel Anytime")
                .font(.subheadline.weight(.medium))
                .foregroundColor(DesignTokens.textSecondary)
        }
    }

    // MARK: - CTA Button

    private var ctaButton: some View {
        Button {
            purchaseSelectedPlan()
        } label: {
            Text("Continue")
                .font(.headline)
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 56)
                .background(
                    LinearGradient(
                        colors: [DesignTokens.rose, DesignTokens.roseDark],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
                .accentShadow()
        }
    }

    // MARK: - Footer Section

    private var footerSection: some View {
        VStack(spacing: DesignTokens.spacing12) {
            Text("Renews automatically. Cancel anytime.")
                .font(.caption)
                .foregroundColor(DesignTokens.textTertiary)

            HStack(spacing: DesignTokens.spacing16) {
                Link("Terms", destination: URL(string: "https://porizo.com/terms")!)
                    .font(.caption.weight(.medium))
                    .foregroundColor(DesignTokens.textSecondary)

                Text("•")
                    .font(.caption)
                    .foregroundColor(DesignTokens.textTertiary)

                Link("Privacy", destination: URL(string: "https://porizo.com/privacy")!)
                    .font(.caption.weight(.medium))
                    .foregroundColor(DesignTokens.textSecondary)

                Text("•")
                    .font(.caption)
                    .foregroundColor(DesignTokens.textTertiary)

                Button("Restore") {
                    Task { await storeKit.restore() }
                }
                .font(.caption.weight(.medium))
                .foregroundColor(DesignTokens.textSecondary)
            }
        }
    }

    // MARK: - Loading Overlay

    private var loadingOverlay: some View {
        ZStack {
            Color.black.opacity(0.4)
                .ignoresSafeArea()

            VStack(spacing: DesignTokens.spacing16) {
                ProgressView()
                    .scaleEffect(1.5)
                    .tint(.white)

                Text("Processing...")
                    .font(.headline)
                    .foregroundColor(.white)
            }
            .padding(32)
            .background(
                RoundedRectangle(cornerRadius: DesignTokens.radiusLarge)
                    .fill(.ultraThinMaterial)
            )
        }
    }

    // MARK: - Helper Functions

    private func calculateWeeklyPrice(from product: Product) -> String {
        let annualPrice = product.price
        let weeklyPrice = annualPrice / 52
        return String(format: "$%.2f/week", NSDecimalNumber(decimal: weeklyPrice).doubleValue)
    }

    private func purchaseSelectedPlan() {
        let productId: ProductID = selectedPlan == .annual ? .proAnnual : .proMonthly
        guard let product = storeKit.product(for: productId) else { return }

        Task {
            await storeKit.purchase(product)
        }
    }

    private func handlePurchaseStateChange(_ state: PurchaseState) {
        switch state {
        case .success:
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                dismiss()
            }
        case .failed(let error):
            errorMessage = error
            showError = true
            storeKit.resetPurchaseState()
        case .cancelled:
            storeKit.resetPurchaseState()
        default:
            break
        }
    }
}

// MARK: - Plan Selection Card

private struct PlanSelectionCard: View {
    let isSelected: Bool
    let planName: String
    let price: String
    let pricePerWeek: String?
    let savings: String?
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: DesignTokens.spacing12) {
                // Radio button
                ZStack {
                    Circle()
                        .stroke(isSelected ? DesignTokens.rose : DesignTokens.cardBorder, lineWidth: 2)
                        .frame(width: 24, height: 24)

                    if isSelected {
                        Circle()
                            .fill(DesignTokens.rose)
                            .frame(width: 14, height: 14)
                    }
                }

                // Plan details
                VStack(alignment: .leading, spacing: DesignTokens.spacing2) {
                    HStack(spacing: DesignTokens.spacing8) {
                        Text(planName)
                            .font(.headline)
                            .foregroundColor(DesignTokens.textPrimary)

                        if let savings = savings {
                            Text(savings)
                                .font(.caption.bold())
                                .foregroundColor(.white)
                                .padding(.horizontal, DesignTokens.spacing8)
                                .padding(.vertical, DesignTokens.spacing2)
                                .background(DesignTokens.success)
                                .clipShape(Capsule())
                        }
                    }

                    if let weekly = pricePerWeek {
                        Text("just \(price)/year")
                            .font(.caption)
                            .foregroundColor(DesignTokens.textSecondary)
                    }
                }

                Spacer()

                // Price
                VStack(alignment: .trailing, spacing: DesignTokens.spacing2) {
                    Text(price)
                        .font(.title3.bold())
                        .foregroundColor(DesignTokens.textPrimary)

                    if let weekly = pricePerWeek {
                        Text(weekly)
                            .font(.caption)
                            .foregroundColor(DesignTokens.rose)
                    } else {
                        Text("/month")
                            .font(.caption)
                            .foregroundColor(DesignTokens.textSecondary)
                    }
                }
            }
            .padding(DesignTokens.spacing16)
            .background(DesignTokens.cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusLarge))
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.radiusLarge)
                    .stroke(isSelected ? DesignTokens.rose : DesignTokens.cardBorder, lineWidth: isSelected ? 2 : 1)
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Benefit Row

private struct BenefitRow: View {
    let icon: String
    let text: String

    var body: some View {
        HStack(spacing: DesignTokens.spacing12) {
            // Checkmark
            Image(systemName: "checkmark.circle.fill")
                .font(.body)
                .foregroundColor(DesignTokens.success)

            // Icon
            Image(systemName: icon)
                .font(.body)
                .foregroundColor(DesignTokens.rose)
                .frame(width: 24)

            // Text
            Text(text)
                .font(.subheadline)
                .foregroundColor(DesignTokens.textPrimary)

            Spacer()
        }
    }
}

// MARK: - Preview

#Preview {
    SubscriptionView(storeKit: StoreKitManager.preview())
}
