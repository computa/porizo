//
//  SubscriptionView.swift
//  PorizoApp
//
//  Premium subscription paywall with credits header, billing toggle,
//  and three-tier plan selection. Matches v1.pen "14 - Subscription Plans".
//

import SwiftUI
import StoreKit

// MARK: - Subscription View

struct SubscriptionView: View {
    let apiClient: APIClient
    var storeKit: StoreKitManager
    @Environment(\.dismiss) private var dismiss

    @State private var selectedTier: String = "pro"
    @State private var billingPeriod: BillingPeriod = .monthly
    @State private var showCompare = false
    @State private var showError = false
    @State private var showPurchaseAuthHelp = false
    @State private var errorMessage = ""

    // Backend data
    @State private var plans: [SubscriptionPlan] = []
    @State private var entitlements: BillingEntitlements?
    @State private var subscriptionStatus: SubscriptionResponse?
    @State private var isLoading = true

    enum BillingPeriod {
        case monthly
        case annual
    }

    // Computed from entitlements
    private var currentCredits: Int {
        entitlements?.songsRemaining ?? 0
    }
    private var baseSongCredits: Int {
        entitlements?.baseSongsRemaining ?? max(currentCredits - trialSongCredits, 0)
    }
    private var trialSongCredits: Int {
        entitlements?.trialSongsRemaining ?? 0
    }
    private var currentPoemCredits: Int {
        entitlements?.poemsRemaining ?? 0
    }
    private var currentTier: String {
        entitlements?.tier ?? "free"
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                header

                ScrollView {
                    VStack(spacing: 16) {
                        // Credits header
                        creditsHeader

                        // Pay-per-song hero (one-off, the "face" of the wall)
                        payPerSongHero

                        // Toggle section
                        toggleSection

                        // Plan cards
                        planCardsSection

                        Spacer(minLength: 24)

                        // Continue button
                        continueButton

                        // Token purchase section
                        tokenPurchaseSection

                        // App Review disclosure + legal links
                        subscriptionDisclosure

                        // Compare plans button
                        comparePlansButton
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 24)
                    .padding(.bottom, 20)
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
            .alert("Purchase Sign-In Help", isPresented: $showPurchaseAuthHelp) {
                Button("Open Subscriptions") {
                    openManageSubscription()
                }
                Button("OK", role: .cancel) { }
            } message: {
                Text(
                    """
                    App Store purchases are authenticated by Apple, not by the app. If Face ID/Touch ID is enabled for App Store purchases, Apple uses biometrics. Otherwise Apple asks for your Apple Account password.

                    To reduce password prompts:
                    1. Open Settings.
                    2. Open Face ID & Passcode (or Touch ID & Passcode).
                    3. Enable iTunes & App Store.
                    4. Confirm you are signed into the correct Apple Account in App Store.
                    """
                )
            }
            .onChange(of: storeKit.purchaseState) { _, newState in
                handlePurchaseStateChange(newState)
            }
            .sheet(isPresented: $showCompare) {
                ComparePlansSheet(plans: plans, storeKit: storeKit)
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

            // Default selection:
            // 1) user's current tier (least surprising)
            // 2) pro (upsell default for free users)
            // 3) first paid plan
            if let currentPlan = plans.first(where: { $0.tier.lowercased() == currentTier.lowercased() }) {
                selectedTier = currentPlan.tier
            } else if let proTier = plans.first(where: { $0.tier.lowercased() == "pro" }) {
                selectedTier = proTier.tier
            } else if let firstPaid = plans.first(where: { $0.priceMonthly != nil }) {
                selectedTier = firstPaid.tier
            }
        } catch {
            print("[SubscriptionView] Load error: \(error)")
            errorMessage = "Unable to load subscription plans. Please check your connection and try again."
            showError = true
        }
        isLoading = false
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(DesignTokens.surface)
                    .clipShape(Circle())
            }
            .accessibilityLabel("Close plans")

            Spacer()

            Text("Plans")
                .font(DesignTokens.displayFont(size: 20))
                .foregroundStyle(DesignTokens.textPrimary)

            Spacer()

            // Spacer to balance header
            Color.clear
                .frame(width: 44, height: 44)
        }
        .padding(.horizontal, 20)
        .frame(height: 56)
    }

    // MARK: - Credits Header (Compact)

    private var creditsHeader: some View {
        VStack(spacing: 8) {
            HStack(spacing: 24) {
                VStack(spacing: 2) {
                    Text("\(currentCredits)")
                        .font(DesignTokens.bodyFont(size: 36, weight: .light))
                        .foregroundStyle(.white)
                    Text(currentCredits == 1 ? "song" : "songs")
                        .font(DesignTokens.bodyFont(size: 13))
                        .foregroundStyle(DesignTokens.textSecondary)
                }
                VStack(spacing: 2) {
                    Text("\(currentPoemCredits)")
                        .font(DesignTokens.bodyFont(size: 36, weight: .light))
                        .foregroundStyle(.white)
                    Text(currentPoemCredits == 1 ? "poem" : "poems")
                        .font(DesignTokens.bodyFont(size: 13))
                        .foregroundStyle(DesignTokens.textSecondary)
                }
            }

            Text("\(currentTier.capitalized) Plan")
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundStyle(DesignTokens.gold)

            if trialSongCredits > 0 {
                Text(
                    baseSongCredits > 0
                    ? "\(baseSongCredits) regular + \(trialSongCredits) trial songs"
                    : "\(trialSongCredits) trial songs available"
                )
                .font(DesignTokens.bodyFont(size: 12))
                .foregroundStyle(DesignTokens.textSecondary)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(minHeight: 120)
        .background(DesignTokens.surfaceMuted)
        .clipShape(.rect(cornerRadius: DesignTokens.radiusMedium))
    }

    // MARK: - Toggle Section (Compact)

    private var toggleSection: some View {
        // Toggle pill with Save badge overlay outside the clip
        HStack(spacing: 0) {
            toggleButton(title: "Monthly", isSelected: billingPeriod == .monthly) {
                withAnimation(.easeInOut(duration: 0.2)) {
                    billingPeriod = .monthly
                }
            }

            toggleButton(title: "Annual", isSelected: billingPeriod == .annual) {
                withAnimation(.easeInOut(duration: 0.2)) {
                    billingPeriod = .annual
                }
            }
        }
        .padding(3)
        .background(DesignTokens.border)
        .clipShape(.rect(cornerRadius: 16))
        .frame(maxWidth: .infinity)
        .frame(height: 48)
        .overlay(alignment: .topTrailing) {
            Text("Save 20%")
                .font(DesignTokens.bodyFont(size: 9, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(DesignTokens.error)
                .clipShape(.rect(cornerRadius: 4))
                .offset(x: 8, y: -6)
        }
    }

    private func toggleButton(title: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                .foregroundStyle(isSelected ? DesignTokens.background : DesignTokens.textSecondary)
                .frame(width: 94, height: 28)
                .background(isSelected ? DesignTokens.gold : Color.clear)
                .clipShape(.rect(cornerRadius: 14))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Plan Cards Section

    private var planCardsSection: some View {
        VStack(spacing: 10) {
            if isLoading {
                ForEach(0..<3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                        .fill(DesignTokens.surface)
                        .frame(height: 64)
                }
            } else {
                ForEach(plans) { plan in
                    let isCurrent = plan.tier == currentTier
                    let price = formatPrice(for: plan)
                    let billingNote = formatBillingNote(for: plan)

                    planCard(
                        tier: plan.tier,
                        title: plan.name,
                        description: plan.description ?? planSummary(for: plan),
                        showCurrentBadge: isCurrent,
                        price: price,
                        billingNote: billingNote
                    )
                }
            }
        }
    }

    private func formatPrice(for plan: SubscriptionPlan) -> String? {
        if let storeProduct = storeProduct(for: plan.tier, billingPeriod: billingPeriod) {
            let period = billingPeriod == .annual ? "year" : "month"
            return "\(storeProduct.displayPrice) /\(period)"
        }

        switch billingPeriod {
        case .annual:
            guard let annualCents = plan.priceAnnual else { return nil }
            return String(format: "$%.2f /month", Double(annualCents) / 12.0 / 100.0)
        case .monthly:
            guard let monthlyCents = plan.priceMonthly else { return nil }
            return String(format: "$%.2f /month", Double(monthlyCents) / 100.0)
        }
    }

    private func formatBillingNote(for plan: SubscriptionPlan) -> String? {
        guard billingPeriod == .annual else { return nil }
        if let storeProduct = storeProduct(for: plan.tier, billingPeriod: .annual) {
            return "\(storeProduct.displayPrice) billed annually"
        }
        guard let annualCents = plan.priceAnnual else { return nil }
        return String(format: "$%.2f billed annually", Double(annualCents) / 100.0)
    }

    private func planSummary(for plan: SubscriptionPlan) -> String {
        let songsText = "\(plan.songsPerMonth) " + (plan.songsPerMonth == 1 ? "song" : "songs")
        let poemsText = "\(plan.poemsPerMonth) " + (plan.poemsPerMonth == 1 ? "poem" : "poems")

        if plan.poemsPerMonth > 0 {
            return "\(songsText) • \(poemsText) / month"
        }

        return "\(songsText) / month"
    }

    private func planCard(
        tier: String,
        title: String,
        description: String,
        showCurrentBadge: Bool,
        price: String?,
        billingNote: String?
    ) -> some View {
        let isSelected = selectedTier == tier
        let hasPrice = price != nil

        return Button {
            withAnimation(.easeInOut(duration: 0.15)) {
                selectedTier = tier
            }
        } label: {
            HStack(alignment: .center, spacing: 12) {
                // Radio button
                radioButton(isSelected: isSelected)

                // Content
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(title)
                            .font(DesignTokens.bodyFont(size: 17, weight: .semibold))
                            .foregroundStyle(.white)

                        if showCurrentBadge {
                            Text("Current")
                                .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(DesignTokens.borderSubtle)
                                .clipShape(.rect(cornerRadius: 4))
                        }
                    }

                    Text(description)
                        .font(DesignTokens.bodyFont(size: hasPrice ? 13 : 14))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .lineLimit(1)
                }

                Spacer()

                // Price (if applicable)
                if let price = price {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(price)
                            .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                            .foregroundStyle(isSelected ? DesignTokens.gold : .white)

                        if let note = billingNote {
                            Text(note)
                                .font(DesignTokens.bodyFont(size: 11))
                                .foregroundStyle(DesignTokens.textSecondary)
                        }
                    }
                    .frame(width: 120, alignment: .trailing)
                }
            }
            .padding(12)
            .background(isSelected ? DesignTokens.gold.opacity(0.08) : DesignTokens.surface)
            .clipShape(.rect(cornerRadius: DesignTokens.radiusMedium))
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                    .stroke(
                        isSelected ? DesignTokens.gold : DesignTokens.border,
                        lineWidth: isSelected ? 2 : 1
                    )
            )
        }
        .buttonStyle(.plain)
    }

    private func radioButton(isSelected: Bool) -> some View {
        ZStack {
            if isSelected {
                Circle()
                    .fill(DesignTokens.gold)
                    .frame(width: 18, height: 18)

                Image(systemName: "checkmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(DesignTokens.background)
            } else {
                Circle()
                    .stroke(DesignTokens.textTertiary, lineWidth: 1.5)
                    .frame(width: 18, height: 18)
            }
        }
    }

    // MARK: - Pay-Per-Song Hero (one-off)

    /// The "pay for one song" face of the wall. Shown only when the server
    /// enables pay-per-song AND the gift_bundle_1 product is available.
    /// Buying it credits one gift-wallet token; the create flow's existing
    /// post-dismiss entitlement re-check then lets the song proceed.
    @ViewBuilder
    private var payPerSongHero: some View {
        if entitlements?.payPerSongEnabled == true,
           let product = storeKit.payPerSongProduct {
            VStack(alignment: .leading, spacing: 10) {
                Text("Make one song now")
                    .font(DesignTokens.displayFont(size: 22))
                    .foregroundStyle(DesignTokens.textPrimary)

                Text("One song, made from your words — yours to keep. No subscription.")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                Button {
                    Task { await storeKit.purchase(product) }
                } label: {
                    Text("Pay \(product.displayPrice) — make this song")
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundStyle(DesignTokens.background)
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .background(DesignTokens.gold)
                        .clipShape(.rect(cornerRadius: 26))
                }
                .buttonStyle(.plain)
                .goldGlow()
                .disabled(storeKit.purchaseState.isLoading)
                .opacity(storeKit.purchaseState.isLoading ? 0.5 : 1)
                .accessibilityLabel("Pay \(product.displayPrice) to make one song")
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(DesignTokens.surface)
            .clipShape(.rect(cornerRadius: DesignTokens.radiusMedium))
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                    .stroke(DesignTokens.gold, lineWidth: 1.5)
            )
        }
    }

    // MARK: - Continue Button

    private var continueButton: some View {
        Button {
            purchaseSelectedPlan()
        } label: {
            Text("Continue")
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(DesignTokens.background)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(DesignTokens.gold)
                .clipShape(.rect(cornerRadius: 26))
        }
        .buttonStyle(.plain)
        .goldGlow()
        .disabled(isContinueDisabled)
        .opacity(isContinueDisabled ? 0.5 : 1)
    }

    // MARK: - Token Purchase Section

    private var tokenPurchaseSection: some View {
        VStack(spacing: 12) {
            // Divider with label
            HStack(spacing: 12) {
                Rectangle()
                    .fill(DesignTokens.border)
                    .frame(height: 1)
                Text("or buy individual songs")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textTertiary)
                    .layoutPriority(1)
                Rectangle()
                    .fill(DesignTokens.border)
                    .frame(height: 1)
            }
            .padding(.top, 8)

            if storeKit.giftBundleProducts.isEmpty && storeKit.giftTokenProduct == nil {
                Text("Song tokens are not available right now.")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textSecondary)
            } else {
                let allTokenProducts = tokenProducts
                ForEach(allTokenProducts, id: \.id) { product in
                    tokenRow(for: product)
                }
            }
        }
    }

    private var tokenProducts: [Product] {
        var result: [Product] = []
        // When the pay-per-song hero is active it already offers a single song
        // (gift_bundle_1, $1.99); hide the deprecated one-off ($2.99) so we
        // don't show two single-song prices.
        let heroActive =
            entitlements?.payPerSongEnabled == true && storeKit.payPerSongProduct != nil
        if !heroActive, let single = storeKit.giftTokenProduct {
            result.append(single)
        }
        result.append(contentsOf: storeKit.giftBundleProducts)
        return result.sorted { $0.price < $1.price }
    }

    private func tokenRow(for product: Product) -> some View {
        let isBestValue = product.id == ProductID.giftBundle3.rawValue
        let songCount = tokenSongCount(for: product)

        return Button {
            Task { await storeKit.purchase(product) }
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(songCount == 1 ? "1 Song" : "\(songCount) Songs")
                            .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                            .foregroundStyle(.white)

                        if isBestValue {
                            Text("BEST VALUE")
                                .font(DesignTokens.bodyFont(size: 9, weight: .bold))
                                .foregroundStyle(DesignTokens.background)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(DesignTokens.gold)
                                .clipShape(.rect(cornerRadius: 4))
                        }
                    }

                    if songCount > 1 {
                        let perSong = product.price / Decimal(songCount)
                        Text(String(format: "$%.2f per song", NSDecimalNumber(decimal: perSong).doubleValue))
                            .font(DesignTokens.bodyFont(size: 12))
                            .foregroundStyle(DesignTokens.textSecondary)
                    }
                }

                Spacer()

                Text(product.displayPrice)
                    .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                    .foregroundStyle(DesignTokens.background)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(DesignTokens.gold)
                    .clipShape(.rect(cornerRadius: 8))
            }
            .padding(12)
            .background(DesignTokens.surface)
            .clipShape(.rect(cornerRadius: DesignTokens.radiusMedium))
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                    .stroke(isBestValue ? DesignTokens.gold : DesignTokens.border, lineWidth: isBestValue ? 1.5 : 0.5)
            )
        }
        .buttonStyle(.plain)
        .disabled(storeKit.purchaseState.isLoading)
        .opacity(storeKit.purchaseState.isLoading ? 0.5 : 1)
    }

    private func tokenSongCount(for product: Product) -> Int {
        switch ProductID(rawValue: product.id) {
        case .giftBundle3: return 3
        case .giftBundle5: return 5
        default: return 1
        }
    }

    private var subscriptionDisclosure: some View {
        VStack(spacing: 10) {
            Text(subscriptionDisclosureText)
                .font(DesignTokens.bodyFont(size: 12))
                .foregroundStyle(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)

            HStack(spacing: 20) {
                Button {
                    Task { await storeKit.restore() }
                } label: {
                    Text("Restore Purchases")
                        .font(DesignTokens.bodyFont(size: 12))
                        .foregroundStyle(DesignTokens.textSecondary)
                }

                Link("Terms", destination: AppConfig.termsURL)
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.textSecondary)

                Link("Privacy", destination: AppConfig.privacyURL)
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.textSecondary)

                Button {
                    openManageSubscription()
                } label: {
                    Text("Manage Subscription")
                        .font(DesignTokens.bodyFont(size: 12))
                        .foregroundStyle(DesignTokens.textSecondary)
                }
            }

            Button {
                showPurchaseAuthHelp = true
            } label: {
                Text("Purchase Sign-In Help")
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.textSecondary)
            }
        }
    }

    private var subscriptionDisclosureText: String {
        let periodText = billingPeriod == .annual ? "year" : "month"
        if let product = selectedStoreProduct {
            return "\(product.displayName): \(product.displayPrice)/\(periodText). Subscription auto-renews unless canceled at least 24 hours before the end of the current period. Payment will be charged to your Apple ID account. App Store purchase authentication is handled by Apple (Face ID/Touch ID when enabled). Manage subscriptions in Settings > Apple ID > Subscriptions."
        }
        let billingText = billingPeriod == .annual ? "Billed annually." : "Billed monthly."
        return "\(billingText) Subscription auto-renews unless canceled at least 24 hours before the end of the current period. Payment will be charged to your Apple ID account. App Store purchase authentication is handled by Apple (Face ID/Touch ID when enabled). Manage subscriptions in Settings > Apple ID > Subscriptions."
    }

    // MARK: - Compare Plans Button

    private var comparePlansButton: some View {
        Button {
            showCompare = true
        } label: {
            HStack(spacing: 8) {
                Text("Compare all plan features")
                    .font(DesignTokens.bodyFont(size: 15, weight: .medium))
                    .foregroundStyle(DesignTokens.gold)

                Image(systemName: "chevron.down")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(DesignTokens.gold)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(Color.clear)
            .overlay(
                RoundedRectangle(cornerRadius: 26)
                    .stroke(DesignTokens.border, lineWidth: 1.5)
            )
        }
        .buttonStyle(.plain)
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
                    .foregroundStyle(.white)
            }
            .padding(32)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(.ultraThinMaterial)
            )
        }
    }

    // MARK: - Helper Functions

    private func purchaseSelectedPlan() {
        if selectedTier.lowercased() == "free" {
            if currentTier.lowercased() != "free" {
                guard hasManageableAppleSubscription else {
                    errorMessage = "No active Porizo App Store subscription was found for this account. Use Restore Purchases, or sign in with the Apple ID that purchased Porizo."
                    showError = true
                    return
                }
                errorMessage = "To move to Free, Apple requires managing the subscription in App Store settings. Opening now."
                showError = true
                openManageSubscription()
            }
            return
        }

        Task {
            guard let productIdentifier = selectedProductIdentifier(for: selectedTier, billingPeriod: billingPeriod) else {
                errorMessage = "Selected plan is not linked to an App Store product yet."
                showError = true
                return
            }

            if storeKit.product(forIdentifier: productIdentifier) == nil {
                await storeKit.loadProducts(identifiers: allKnownProductIdentifiers())
            }

            guard let product = storeKit.product(forIdentifier: productIdentifier) else {
                let loadedProducts = storeKit.products.map(\.id)
                print("[SubscriptionView] Product not available: \(productIdentifier). Loaded products: \(loadedProducts)")
                let requestedTier = selectedTier.lowercased()
                let current = currentTier.lowercased()
                let isTierChange = requestedTier != current && current != "free"

                if isTierChange {
                    guard hasManageableAppleSubscription else {
                        errorMessage = "No active Porizo App Store subscription was found for this account. Use Restore Purchases, or sign in with the Apple ID that purchased Porizo."
                        showError = true
                        return
                    }
                    errorMessage = "To switch from \(currentTier.capitalized) to \(selectedTier.capitalized), Apple requires managing the subscription in App Store settings. Opening now."
                    showError = true
                    openManageSubscription()
                    return
                }

                errorMessage = loadedProducts.isEmpty
                    ? "Unable to load App Store subscription products. Check your App Store sign-in and network, then use Restore Purchases or try again."
                    : "This subscription is not available for this build yet. Contact support if the issue persists."
                showError = true
                return
            }

            await storeKit.purchase(product)
        }
    }

    private var selectedStoreProduct: Product? {
        guard let productIdentifier = selectedProductIdentifier(for: selectedTier, billingPeriod: billingPeriod) else {
            return nil
        }
        return storeKit.product(forIdentifier: productIdentifier)
    }

    private var isContinueDisabled: Bool {
        let selected = selectedTier.lowercased()
        let current = currentTier.lowercased()

        if selected == current { return true }
        if isLoading || storeKit.purchaseState.isLoading { return true }
        if selected != "free" && storeKit.isLoadingProducts && selectedStoreProduct == nil { return true }
        return false
    }

    private func openManageSubscription() {
        guard let url = URL(string: "itms-apps://apps.apple.com/account/subscriptions") else {
            return
        }
        UIApplication.shared.open(url)
    }

    private var hasManageableAppleSubscription: Bool {
        guard let subscriptionStatus, subscriptionStatus.hasActiveSubscription else {
            return false
        }
        guard let platform = subscriptionStatus.subscription?.platform?.lowercased(), !platform.isEmpty else {
            return true
        }
        return platform == "ios" || platform == "apple"
    }

    private func selectedProductIdentifier(for tier: String, billingPeriod: BillingPeriod) -> String? {
        let plan = plans.first { $0.tier.lowercased() == tier.lowercased() }
        return resolveProductIdentifier(plan: plan, tier: tier, billingPeriod: billingPeriod)
    }

    private func storeProduct(for tier: String, billingPeriod: BillingPeriod) -> Product? {
        guard let productIdentifier = selectedProductIdentifier(for: tier, billingPeriod: billingPeriod) else {
            return nil
        }
        return storeKit.product(forIdentifier: productIdentifier)
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
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                dismiss()
                // Clear the shared manager's terminal .success so a re-presented
                // wall starts from .idle and can't act on a stale success.
                storeKit.resetPurchaseState()
            }
        case .syncFailed:
            errorMessage = "Payment was received, but subscription verification with the server failed. Please reopen the app or use Restore Purchases."
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
}

// MARK: - Shared Product ID Resolution

/// Resolves a tier + billing period to an App Store product identifier.
/// Checks plan-level overrides first, then falls back to hardcoded ProductID mapping.
private func resolveProductIdentifier(
    plan: SubscriptionPlan?,
    tier: String,
    billingPeriod: SubscriptionView.BillingPeriod
) -> String? {
    // Plan-level override from backend
    let mapped: String? = switch billingPeriod {
    case .monthly: plan?.appleProductIds?.monthly
    case .annual: plan?.appleProductIds?.annual
    }
    if let mapped, !mapped.isEmpty {
        return mapped
    }

    // Hardcoded fallback
    switch (tier.lowercased(), billingPeriod) {
    case ("plus", .monthly):    return ProductID.plusMonthly.rawValue
    case ("plus", .annual):     return ProductID.plusAnnual.rawValue
    case ("pro", .monthly), ("premier", .monthly):  return ProductID.proMonthly.rawValue
    case ("pro", .annual), ("premier", .annual):     return ProductID.proAnnual.rawValue
    default: return nil
    }
}

// MARK: - Compare Plans Sheet
// Matches v1.pen "15 - Compare Plans" design

private struct ComparePlansSheet: View {
    let plans: [SubscriptionPlan]
    @Environment(\.dismiss) private var dismiss
    var storeKit: StoreKitManager

    private let goldLabel = DesignTokens.gold
    private let checkGreen = DesignTokens.statusSuccess

    private struct FeatureRow: Identifiable {
        let key: String
        let label: String

        var id: String { key }
    }

    private var sortedPlans: [SubscriptionPlan] {
        plans.sorted { lhs, rhs in
            if lhs.sortOrder == rhs.sortOrder {
                return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
            }
            return lhs.sortOrder < rhs.sortOrder
        }
    }

    private var normalizedFeatureSets: [String: Set<String>] {
        Dictionary(uniqueKeysWithValues: sortedPlans.map { plan in
            (
                plan.id,
                Set(
                    plan.features
                        .map(normalizedFeatureKey)
                        .filter { !$0.isEmpty }
                )
            )
        })
    }

    private var featureRows: [FeatureRow] {
        var labelsByKey: [String: String] = [:]

        for plan in sortedPlans {
            for feature in plan.features {
                let trimmed = feature.trimmingCharacters(in: .whitespacesAndNewlines)
                let key = normalizedFeatureKey(trimmed)
                guard !key.isEmpty else { continue }
                if labelsByKey[key] == nil {
                    labelsByKey[key] = trimmed
                }
            }
        }

        return labelsByKey
            .map { FeatureRow(key: $0.key, label: $0.value) }
            .sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                headerBar

                // Content
                ScrollView {
                    VStack(spacing: 0) {
                        // Title
                        Text("Compare all plan features")
                            .font(DesignTokens.bodyFont(size: 20, weight: .semibold))
                            .foregroundStyle(.white)
                            .padding(.top, 20)
                            .padding(.bottom, 24)

                        // Table Container
                        ScrollView(.horizontal) {
                            VStack(spacing: 0) {
                                tableHeaderRow

                                textFeatureRow(
                                    label: "Songs",
                                    values: sortedPlans.map(songAllowanceText),
                                    isEven: true
                                )

                                textFeatureRow(
                                    label: "Poems",
                                    values: sortedPlans.map(poemAllowanceText),
                                    isEven: false
                                )

                                textFeatureRow(
                                    label: "Monthly price",
                                    values: sortedPlans.map { priceText(for: $0, billingPeriod: .monthly) },
                                    isEven: true
                                )

                                textFeatureRow(
                                    label: "Annual price",
                                    values: sortedPlans.map { priceText(for: $0, billingPeriod: .annual) },
                                    isEven: false
                                )

                                ForEach(Array(featureRows.enumerated()), id: \.element.id) { index, feature in
                                    boolFeatureRow(
                                        label: feature.label,
                                        values: sortedPlans.map { plan in
                                            normalizedFeatureSets[plan.id]?.contains(feature.key) ?? false
                                        },
                                        isEven: index.isMultiple(of: 2)
                                    )
                                }
                            }
                            .padding(.horizontal, 16)
                        }
                        .scrollIndicators(.hidden)

                        // Footer
                        footerSection
                    }
                }
                .scrollIndicators(.hidden)
            }
        }
    }

    // MARK: - Header

    private var headerBar: some View {
        HStack {
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(DesignTokens.surface)
                    .clipShape(Circle())
            }
            .accessibilityLabel("Close compare plans")

            Spacer()

            Text("Compare all plan features")
                .font(DesignTokens.displayFont(size: 20))
                .foregroundStyle(DesignTokens.textPrimary)

            Spacer()

            Color.clear.frame(width: 44, height: 44)
        }
        .padding(.horizontal, 20)
        .frame(height: 56)
    }

    // MARK: - Table Header

    private var tableHeaderRow: some View {
        HStack(spacing: 8) {
            // Feature column (empty header)
            Color.clear
                .frame(width: 130, height: 20)

            ForEach(sortedPlans) { plan in
                Text(plan.name)
                    .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 120)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.vertical, 12)
    }

    // MARK: - Feature Row (Text Values)

    private func textFeatureRow(
        label: String,
        values: [String],
        isEven: Bool
    ) -> some View {
        HStack(spacing: 8) {
            Text(label)
                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                .foregroundStyle(goldLabel)
                .lineSpacing(4)
                .frame(width: 130, alignment: .leading)

            ForEach(Array(values.enumerated()), id: \.offset) { _, value in
                Text(value)
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(.white)
                    .frame(width: 120)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.vertical, 14)
        .background(isEven ? DesignTokens.surface : DesignTokens.surfaceMuted)
        .overlay(
            Rectangle()
                .fill(DesignTokens.border)
                .frame(height: 1),
            alignment: .bottom
        )
    }

    // MARK: - Feature Row (Boolean Values)

    private func boolFeatureRow(
        label: String,
        values: [Bool],
        isEven: Bool
    ) -> some View {
        HStack(spacing: 8) {
            Text(label)
                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                .foregroundStyle(goldLabel)
                .lineSpacing(4)
                .frame(width: 130, alignment: .leading)

            ForEach(Array(values.enumerated()), id: \.offset) { _, isAvailable in
                Text(isAvailable ? "✓" : "—")
                    .font(DesignTokens.bodyFont(size: 18, weight: .semibold))
                    .foregroundStyle(isAvailable ? checkGreen : DesignTokens.textTertiary)
                    .frame(width: 120)
            }
        }
        .padding(.vertical, 14)
        .background(isEven ? DesignTokens.surface : DesignTokens.surfaceMuted)
        .overlay(
            Rectangle()
                .fill(DesignTokens.border)
                .frame(height: 1),
            alignment: .bottom
        )
    }

    private func songAllowanceText(for plan: SubscriptionPlan) -> String {
        if plan.tier.lowercased() == "free" && plan.songsPerMonth <= 1 {
            return plan.songsPerMonth == 1 ? "1 one-time" : "Free"
        }
        return "\(plan.songsPerMonth)/month"
    }

    private func poemAllowanceText(for plan: SubscriptionPlan) -> String {
        if plan.poemsPerMonth <= 0 {
            return "—"
        }
        return "\(plan.poemsPerMonth)/month"
    }

    private func priceText(for plan: SubscriptionPlan, billingPeriod: SubscriptionView.BillingPeriod) -> String {
        if let product = storeProduct(for: plan, billingPeriod: billingPeriod) {
            return product.displayPrice
        }

        let cents: Int?
        switch billingPeriod {
        case .monthly:
            cents = plan.priceMonthly
        case .annual:
            cents = plan.priceAnnual
        }

        guard let cents else {
            return plan.tier.lowercased() == "free" ? "Free" : "—"
        }

        return String(format: "$%.2f", Double(cents) / 100.0)
    }

    private func storeProduct(for plan: SubscriptionPlan, billingPeriod: SubscriptionView.BillingPeriod) -> Product? {
        guard let productIdentifier = productIdentifier(for: plan, billingPeriod: billingPeriod) else {
            return nil
        }
        return storeKit.product(forIdentifier: productIdentifier)
    }

    private func productIdentifier(for plan: SubscriptionPlan, billingPeriod: SubscriptionView.BillingPeriod) -> String? {
        resolveProductIdentifier(plan: plan, tier: plan.tier, billingPeriod: billingPeriod)
    }

    private func normalizedFeatureKey(_ feature: String) -> String {
        feature
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
    }

    // MARK: - Footer

    private var footerSection: some View {
        HStack(spacing: 24) {
            Button {
                Task { await storeKit.restore() }
            } label: {
                Text("Restore Purchases")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textTertiary)
            }

            Link("Terms", destination: AppConfig.termsURL)
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textTertiary)

            Link("Privacy", destination: AppConfig.privacyURL)
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textTertiary)
        }
        .padding(.vertical, 20)
    }
}

// MARK: - Preview

#Preview {
    let apiClient = APIClient(baseURL: AppConfig.apiBaseURL)
    SubscriptionView(apiClient: apiClient, storeKit: StoreKitManager.preview())
}
