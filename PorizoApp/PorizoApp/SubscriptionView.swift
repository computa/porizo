//
//  SubscriptionView.swift
//  PorizoApp
//
//  Subscription paywall view for upgrading to Plus or Pro tiers.
//  Shows plan options, features, and handles StoreKit purchases.
//

import SwiftUI
import StoreKit

// MARK: - Subscription View

struct SubscriptionView: View {
    @ObservedObject var storeKit: StoreKitManager
    @Environment(\.dismiss) private var dismiss

    @State private var selectedBillingPeriod: BillingPeriod = .annual
    @State private var showError = false
    @State private var errorMessage = ""

    enum BillingPeriod: String, CaseIterable {
        case monthly = "Monthly"
        case annual = "Annual"
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.backgroundSubtle.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 24) {
                        // Header
                        headerSection

                        // Current status (if subscribed or in trial)
                        if storeKit.subscriptionState.hasActiveSubscription ||
                           storeKit.subscriptionState.isTrialActive {
                            currentStatusCard
                        }

                        // Billing period toggle
                        billingPeriodPicker

                        // Plan cards
                        planCardsSection

                        // Features comparison
                        featuresSection

                        // Trial button (if eligible)
                        if !storeKit.subscriptionState.isTrialActive &&
                           storeKit.subscriptionState.tier == "free" {
                            trialSection
                        }

                        // Restore purchases
                        restoreButton

                        // Legal text
                        legalText
                    }
                    .padding()
                }
            }
            .navigationTitle("Upgrade")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundColor(DesignTokens.rose)
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

    // MARK: - Header Section

    private var headerSection: some View {
        VStack(spacing: 12) {
            Image(systemName: "music.note.list")
                .font(.system(size: 48))
                .foregroundColor(DesignTokens.rose)

            Text("Create More Songs")
                .font(.title.bold())
                .foregroundColor(DesignTokens.textPrimary)

            Text("Unlock more songs per month and premium features")
                .font(.subheadline)
                .foregroundColor(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(.top)
    }

    // MARK: - Current Status Card

    private var currentStatusCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(DesignTokens.success)

                Text(storeKit.subscriptionState.isTrialActive ? "Free Trial Active" : "\(storeKit.subscriptionState.displayTier) Plan")
                    .font(.headline)
                    .foregroundColor(DesignTokens.textPrimary)

                Spacer()
            }

            HStack {
                Text("\(storeKit.subscriptionState.songsRemaining) songs remaining")
                    .font(.subheadline)
                    .foregroundColor(DesignTokens.textSecondary)

                if storeKit.subscriptionState.isTrialActive,
                   let expiresAt = storeKit.subscriptionState.trialExpiresAt {
                    Spacer()
                    Text("Expires \(expiresAt, style: .relative)")
                        .font(.caption)
                        .foregroundColor(DesignTokens.textTertiary)
                }
            }
        }
        .padding()
        .background(DesignTokens.cardBackground)
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(DesignTokens.success.opacity(0.3), lineWidth: 1)
        )
    }

    // MARK: - Billing Period Picker

    private var billingPeriodPicker: some View {
        HStack(spacing: 0) {
            ForEach(BillingPeriod.allCases, id: \.self) { period in
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        selectedBillingPeriod = period
                    }
                } label: {
                    VStack(spacing: 4) {
                        Text(period.rawValue)
                            .font(.subheadline.bold())

                        if period == .annual {
                            Text("Save 16%")
                                .font(.caption2)
                                .foregroundColor(DesignTokens.success)
                        } else {
                            Text(" ")
                                .font(.caption2)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(selectedBillingPeriod == period ? DesignTokens.rose : Color.clear)
                    .foregroundColor(selectedBillingPeriod == period ? .white : DesignTokens.textSecondary)
                }
            }
        }
        .background(DesignTokens.cardBackground)
        .cornerRadius(12)
    }

    // MARK: - Plan Cards

    private var planCardsSection: some View {
        VStack(spacing: 16) {
            // Plus Plan
            if let plusProduct = currentPlusProduct {
                PlanCard(
                    product: plusProduct,
                    tier: "Plus",
                    songsPerMonth: 4,
                    isCurrentPlan: storeKit.subscriptionState.tier == "plus",
                    monthlyEquivalent: storeKit.monthlyPrice(for: plusProduct),
                    onSelect: { purchase(plusProduct) }
                )
            }

            // Pro Plan
            if let proProduct = currentProProduct {
                PlanCard(
                    product: proProduct,
                    tier: "Pro",
                    songsPerMonth: 10,
                    isPopular: true,
                    isCurrentPlan: storeKit.subscriptionState.tier == "pro",
                    monthlyEquivalent: storeKit.monthlyPrice(for: proProduct),
                    onSelect: { purchase(proProduct) }
                )
            }
        }
    }

    private var currentPlusProduct: Product? {
        switch selectedBillingPeriod {
        case .monthly:
            return storeKit.product(for: .plusMonthly)
        case .annual:
            return storeKit.product(for: .plusAnnual)
        }
    }

    private var currentProProduct: Product? {
        switch selectedBillingPeriod {
        case .monthly:
            return storeKit.product(for: .proMonthly)
        case .annual:
            return storeKit.product(for: .proAnnual)
        }
    }

    // MARK: - Features Section

    private var featuresSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("What's included")
                .font(.headline)
                .foregroundColor(DesignTokens.textPrimary)

            VStack(spacing: 12) {
                FeatureRow(
                    icon: "music.note",
                    text: "Create personalized songs",
                    included: true
                )

                FeatureRow(
                    icon: "waveform",
                    text: "Voice conversion (sound like you)",
                    included: true
                )

                FeatureRow(
                    icon: "square.and.arrow.up",
                    text: "Share with friends & family",
                    included: true
                )

                FeatureRow(
                    icon: "star.fill",
                    text: "Priority rendering",
                    included: selectedBillingPeriod == .annual,
                    proOnly: true
                )

                FeatureRow(
                    icon: "infinity",
                    text: "Unlimited previews",
                    included: selectedBillingPeriod == .annual,
                    proOnly: true
                )
            }
        }
        .padding()
        .background(DesignTokens.cardBackground)
        .cornerRadius(12)
    }

    // MARK: - Trial Section

    private var trialSection: some View {
        VStack(spacing: 12) {
            Text("Not ready to commit?")
                .font(.headline)
                .foregroundColor(DesignTokens.textPrimary)

            Text("Try 2 free songs with our 7-day trial")
                .font(.subheadline)
                .foregroundColor(DesignTokens.textSecondary)

            Button {
                Task {
                    await activateTrial()
                }
            } label: {
                Text("Start Free Trial")
                    .font(.headline)
                    .foregroundColor(DesignTokens.rose)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(DesignTokens.rose, lineWidth: 2)
                    )
            }
        }
        .padding()
        .background(DesignTokens.cardBackground)
        .cornerRadius(12)
    }

    // MARK: - Restore Button

    private var restoreButton: some View {
        Button {
            Task {
                await storeKit.restore()
            }
        } label: {
            Text("Restore Purchases")
                .font(.subheadline)
                .foregroundColor(DesignTokens.textSecondary)
        }
    }

    // MARK: - Legal Text

    private var legalText: some View {
        Text("Subscriptions auto-renew. Cancel anytime in Settings > Apple ID > Subscriptions.")
            .font(.caption2)
            .foregroundColor(DesignTokens.textTertiary)
            .multilineTextAlignment(.center)
            .padding(.horizontal)
    }

    // MARK: - Loading Overlay

    private var loadingOverlay: some View {
        ZStack {
            Color.black.opacity(0.4)
                .ignoresSafeArea()

            VStack(spacing: 16) {
                ProgressView()
                    .scaleEffect(1.5)
                    .tint(.white)

                Text("Processing...")
                    .font(.headline)
                    .foregroundColor(.white)
            }
            .padding(32)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(.ultraThinMaterial)
            )
        }
    }

    // MARK: - Actions

    private func purchase(_ product: Product) {
        Task {
            await storeKit.purchase(product)
        }
    }

    private func activateTrial() async {
        do {
            try await storeKit.activateTrial()
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
    }

    private func handlePurchaseStateChange(_ state: PurchaseState) {
        switch state {
        case .success:
            // Dismiss after successful purchase
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

// MARK: - Plan Card

private struct PlanCard: View {
    let product: Product
    let tier: String
    let songsPerMonth: Int
    var isPopular: Bool = false
    var isCurrentPlan: Bool = false
    var monthlyEquivalent: String?
    let onSelect: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header with tier name and badge
            HStack {
                Text(tier)
                    .font(.title2.bold())
                    .foregroundColor(DesignTokens.textPrimary)

                if isPopular {
                    Text("POPULAR")
                        .font(.caption2.bold())
                        .foregroundColor(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(DesignTokens.rose)
                        .cornerRadius(4)
                }

                if isCurrentPlan {
                    Text("CURRENT")
                        .font(.caption2.bold())
                        .foregroundColor(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(DesignTokens.success)
                        .cornerRadius(4)
                }

                Spacer()
            }

            // Songs per month
            HStack(spacing: 4) {
                Image(systemName: "music.note")
                    .foregroundColor(DesignTokens.rose)
                Text("\(songsPerMonth) songs/month")
                    .foregroundColor(DesignTokens.textSecondary)
            }
            .font(.subheadline)

            Divider()

            // Price
            HStack(alignment: .firstTextBaseline) {
                Text(product.displayPrice)
                    .font(.title.bold())
                    .foregroundColor(DesignTokens.textPrimary)

                Text("/ \(product.id.contains("annual") ? "year" : "month")")
                    .font(.subheadline)
                    .foregroundColor(DesignTokens.textSecondary)

                Spacer()

                if let monthly = monthlyEquivalent {
                    Text("\(monthly)/mo")
                        .font(.caption)
                        .foregroundColor(DesignTokens.textTertiary)
                }
            }

            // Subscribe button
            Button(action: onSelect) {
                Text(isCurrentPlan ? "Current Plan" : "Subscribe")
                    .font(.headline)
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(isCurrentPlan ? DesignTokens.textTertiary : DesignTokens.rose)
                    .cornerRadius(12)
            }
            .disabled(isCurrentPlan)
        }
        .padding()
        .background(DesignTokens.cardBackground)
        .cornerRadius(16)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(isPopular ? DesignTokens.rose : DesignTokens.cardBorder, lineWidth: isPopular ? 2 : 1)
        )
    }
}

// MARK: - Feature Row

private struct FeatureRow: View {
    let icon: String
    let text: String
    var included: Bool = true
    var proOnly: Bool = false

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.body)
                .foregroundColor(included ? DesignTokens.rose : DesignTokens.textTertiary)
                .frame(width: 24)

            Text(text)
                .font(.subheadline)
                .foregroundColor(included ? DesignTokens.textPrimary : DesignTokens.textTertiary)

            if proOnly {
                Text("Pro")
                    .font(.caption2.bold())
                    .foregroundColor(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(DesignTokens.rose.opacity(0.8))
                    .cornerRadius(4)
            }

            Spacer()

            Image(systemName: included ? "checkmark.circle.fill" : "circle")
                .foregroundColor(included ? DesignTokens.success : DesignTokens.textTertiary)
        }
    }
}

// MARK: - Preview

#Preview {
    SubscriptionView(storeKit: StoreKitManager.preview())
}
