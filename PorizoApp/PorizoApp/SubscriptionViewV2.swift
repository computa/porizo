//
//  SubscriptionViewV2.swift
//  PorizoApp
//
//  Subscription screen matching create-flow-20260401 prototype.
//  Card-based layout with per-plan Subscribe buttons, coral/amber borders.
//

import SwiftUI
import StoreKit

struct SubscriptionViewV2: View {
    let apiClient: APIClient
    var storeKit: StoreKitManager
    @Environment(\.dismiss) private var dismiss

    @State private var billingPeriod: BillingPeriod = .monthly
    @State private var showError = false
    @State private var errorMessage = ""

    // Backend data
    @State private var plans: [SubscriptionPlan] = []
    @State private var entitlements: BillingEntitlements?
    @State private var subscriptionStatus: SubscriptionResponse?
    @State private var isLoading = true

    enum BillingPeriod {
        case monthly, annual
    }

    private var currentCredits: Int {
        (entitlements?.songsRemaining ?? 0) + (entitlements?.poemsRemaining ?? 0)
    }
    private var currentTier: String {
        entitlements?.tier ?? "free"
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                header

                ScrollView {
                    VStack(spacing: 20) {
                        creditsLabel
                        billingToggle
                        planCards
                        restoreButton
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 16)
                    .padding(.bottom, 40)
                }
            }
            .overlay {
                if storeKit.purchaseState.isLoading {
                    loadingOverlay
                }
            }
            .alert("Error", isPresented: $showError) {
                Button("OK", role: .cancel) { }
            } message: {
                Text(errorMessage)
            }
            .onChange(of: storeKit.purchaseState) { _, newState in
                handlePurchaseStateChange(newState)
            }
            .task {
                await loadData()
                await storeKit.loadProducts(identifiers: allKnownProductIdentifiers())
            }
            .task {
                await storeKit.retryUnfinishedTransactions()
            }
        }
    }

    // MARK: - Data Loading

    private func loadData() async {
        isLoading = true
        do {
            async let plansTask = apiClient.getPlans()
            async let entitlementsTask = apiClient.getBillingEntitlements()
            async let subscriptionTask: SubscriptionResponse? = try? apiClient.getSubscription()

            let (plansResponse, ents, subscription) = try await (plansTask, entitlementsTask, subscriptionTask)
            plans = plansResponse.plans.sorted { $0.sortOrder < $1.sortOrder }
            entitlements = ents
            subscriptionStatus = subscription
        } catch {
            errorMessage = "Unable to load subscription plans. Please check your connection and try again."
            showError = true
        }
        isLoading = false
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Button { dismiss() } label: {
                Image(systemName: "arrow.left")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Back")

            Spacer()

            Text("Subscription")
                .font(DesignTokens.displayFont(size: 20, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)

            Spacer()

            Color.clear.frame(width: 44, height: 44)
        }
        .padding(.horizontal, 16)
        .frame(height: 56)
    }

    // MARK: - Credits Label

    private var creditsLabel: some View {
        Text("\(currentCredits) credits remaining")
            .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
            .foregroundStyle(DesignTokens.goldDark)
            .frame(maxWidth: .infinity, alignment: .center)
    }

    // MARK: - Billing Toggle

    private var billingToggle: some View {
        HStack(spacing: 0) {
            togglePill("Monthly", isSelected: billingPeriod == .monthly) {
                withAnimation(.easeInOut(duration: 0.2)) { billingPeriod = .monthly }
            }
            togglePill("Annual", isSelected: billingPeriod == .annual, badge: "SAVE 40%") {
                withAnimation(.easeInOut(duration: 0.2)) { billingPeriod = .annual }
            }
        }
        .padding(3)
        .background(DesignTokens.surfaceMuted)
        .clipShape(.rect(cornerRadius: 20))
        .frame(maxWidth: 280)
        .frame(maxWidth: .infinity)
    }

    private func togglePill(_ title: String, isSelected: Bool, badge: String? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(title)
                    .font(DesignTokens.bodyFont(size: 14, weight: .medium))

                if let badge {
                    Text(badge)
                        .font(DesignTokens.bodyFont(size: 10, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(DesignTokens.gold)
                        .clipShape(.rect(cornerRadius: 4))
                }
            }
            .foregroundStyle(isSelected ? .white : DesignTokens.textSecondary)
            .frame(maxWidth: .infinity)
            .frame(height: 36)
            .background(isSelected ? DesignTokens.textPrimary : Color.clear)
            .clipShape(.rect(cornerRadius: 18))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Plan Cards

    private var planCards: some View {
        VStack(spacing: 16) {
            if isLoading {
                ForEach(0..<3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: DesignTokens.radiusCTA)
                        .fill(DesignTokens.surface)
                        .frame(height: 140)
                }
            } else {
                ForEach(plans) { plan in
                    planCard(for: plan)
                }
            }
        }
    }

    private func planCard(for plan: SubscriptionPlan) -> some View {
        let tier = plan.tier.lowercased()
        let isCurrent = tier == currentTier.lowercased()
        let isFree = tier == "free"
        let isUltimate = tier == "ultimate"
        let borderColor: Color = isFree ? DesignTokens.border : (isUltimate ? DesignTokens.roseGold : DesignTokens.gold)
        let borderWidth: CGFloat = isFree ? 1 : 1.5
        let accentColor: Color = isUltimate ? DesignTokens.roseGold : DesignTokens.gold

        return VStack(alignment: .leading, spacing: 12) {
            // Title row
            HStack {
                Text(plan.name)
                    .font(DesignTokens.bodyFont(size: 18, weight: .bold))
                    .foregroundStyle(isUltimate ? DesignTokens.roseGold : DesignTokens.textPrimary)

                Spacer()

                if isCurrent {
                    Text("CURRENT")
                        .font(DesignTokens.bodyFont(size: 11, weight: .bold))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .tracking(0.5)
                }
            }

            // Price
            Text(priceText(for: plan))
                .font(DesignTokens.bodyFont(size: 15))
                .foregroundStyle(DesignTokens.textSecondary)

            // Features
            VStack(alignment: .leading, spacing: 6) {
                if plan.features.isEmpty {
                    // Fallback feature list from plan data
                    featureBullet("\(plan.songsPerMonth) songs/month")
                    if isFree {
                        featureBullet("AI voice only")
                        featureBullet("Preview quality")
                    }
                } else {
                    ForEach(plan.features, id: \.self) { feature in
                        featureBullet(feature)
                    }
                }
            }

            // Subscribe button (not for free tier or current plan)
            if !isFree && !isCurrent {
                Button {
                    purchasePlan(plan)
                } label: {
                    Text("Subscribe")
                        .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 10)
                        .background(accentColor)
                        .clipShape(.rect(cornerRadius: 10))
                }
                .buttonStyle(.plain)
                .padding(.top, 4)
            }
        }
        .padding(16)
        .background(DesignTokens.surface)
        .clipShape(.rect(cornerRadius: DesignTokens.radiusCTA))
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.radiusCTA)
                .stroke(borderColor, lineWidth: borderWidth)
        )
    }

    private func featureBullet(_ text: String) -> some View {
        HStack(spacing: 8) {
            Circle()
                .fill(DesignTokens.gold)
                .frame(width: 6, height: 6)
            Text(text)
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundStyle(DesignTokens.textPrimary)
        }
    }

    private func priceText(for plan: SubscriptionPlan) -> String {
        if plan.tier.lowercased() == "free" { return "$0 / month" }

        if let storeProduct = storeProduct(for: plan) {
            let period = billingPeriod == .annual ? "year" : "month"
            return "\(storeProduct.displayPrice) / \(period)"
        }

        switch billingPeriod {
        case .monthly:
            guard let cents = plan.priceMonthly else { return "" }
            return String(format: "$%.2f / month", Double(cents) / 100.0)
        case .annual:
            guard let cents = plan.priceAnnual else { return "" }
            return String(format: "$%.2f / month", Double(cents) / 12.0 / 100.0)
        }
    }

    // MARK: - Restore

    private var restoreButton: some View {
        Button {
            Task { await storeKit.restore() }
        } label: {
            Text("Restore Purchases")
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundStyle(DesignTokens.textTertiary)
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.top, 8)
    }

    // MARK: - Loading Overlay

    private var loadingOverlay: some View {
        ZStack {
            Color.black.opacity(0.3).ignoresSafeArea()
            VStack(spacing: 12) {
                ProgressView()
                    .tint(DesignTokens.gold)
                    .scaleEffect(1.2)
                Text("Processing...")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textPrimary)
            }
            .padding(24)
            .background(DesignTokens.surface)
            .clipShape(.rect(cornerRadius: DesignTokens.radiusMedium))
            .elevation(.level3)
        }
    }

    // MARK: - Purchase Logic

    private func purchasePlan(_ plan: SubscriptionPlan) {
        Task {
            guard let productId = resolveProductId(plan: plan, tier: plan.tier, period: billingPeriod) else {
                errorMessage = "Selected plan is not linked to an App Store product yet."
                showError = true
                return
            }

            if storeKit.product(forIdentifier: productId) == nil {
                await storeKit.loadProducts(identifiers: allKnownProductIdentifiers())
            }

            guard let product = storeKit.product(forIdentifier: productId) else {
                errorMessage = "This subscription is not available for this build yet."
                showError = true
                return
            }

            await storeKit.purchase(product)
        }
    }

    private func storeProduct(for plan: SubscriptionPlan) -> Product? {
        guard let productId = resolveProductId(plan: plan, tier: plan.tier, period: billingPeriod) else {
            return nil
        }
        return storeKit.product(forIdentifier: productId)
    }

    private func allKnownProductIdentifiers() -> [String] {
        var identifiers = Set(ProductID.allIdentifiers)
        for plan in plans {
            if let monthly = plan.appleProductIds?.monthly, !monthly.isEmpty {
                identifiers.insert(monthly)
            }
            if let annual = plan.appleProductIds?.annual, !annual.isEmpty {
                identifiers.insert(annual)
            }
        }
        return Array(identifiers).sorted()
    }

    private func handlePurchaseStateChange(_ state: PurchaseState) {
        switch state {
        case .success:
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { dismiss() }
        case .syncFailed:
            errorMessage = "Payment received, but server verification failed. Please reopen the app or use Restore Purchases."
            showError = true
            storeKit.resetPurchaseState()
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

    // MARK: - Product Identifier Resolution

    private func resolveProductId(plan: SubscriptionPlan?, tier: String, period: BillingPeriod) -> String? {
        let mapped: String? = switch period {
        case .monthly: plan?.appleProductIds?.monthly
        case .annual: plan?.appleProductIds?.annual
        }
        if let mapped, !mapped.isEmpty { return mapped }

        switch (tier.lowercased(), period) {
        case ("plus", .monthly):   return ProductID.plusMonthly.rawValue
        case ("plus", .annual):    return ProductID.plusAnnual.rawValue
        case ("pro", .monthly), ("premier", .monthly):  return ProductID.proMonthly.rawValue
        case ("pro", .annual), ("premier", .annual):     return ProductID.proAnnual.rawValue
        default: return nil
        }
    }
}

#Preview {
    SubscriptionViewV2(
        apiClient: APIClient(baseURL: "http://localhost:3000"),
        storeKit: StoreKitManager(apiClient: APIClient(baseURL: "http://localhost:3000"))
    )
}
