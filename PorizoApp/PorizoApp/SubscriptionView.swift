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
    @ObservedObject var storeKit: StoreKitManager
    @Environment(\.dismiss) private var dismiss

    @State private var selectedTier: String = "pro"
    @State private var billingPeriod: BillingPeriod = .annual
    @State private var showCompare = false
    @State private var showError = false
    @State private var errorMessage = ""

    // Backend data
    @State private var plans: [SubscriptionPlan] = []
    @State private var entitlements: BillingEntitlements?
    @State private var isLoading = true

    enum BillingPeriod {
        case monthly
        case annual
    }

    // Computed from entitlements
    private var currentCredits: Int {
        entitlements?.songsRemaining ?? 0
    }
    private var songsLeftToday: Int {
        let previewsUsed = entitlements?.previewCountToday ?? 0
        let previewsAllowed = plans.first(where: { $0.tier == currentTier })?.previewsPerDay ?? 10
        return max(0, previewsAllowed - previewsUsed)
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

                        // Toggle section
                        toggleSection

                        // Plan cards
                        planCardsSection

                        Spacer(minLength: 24)

                        // Continue button
                        continueButton

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
            .onChange(of: storeKit.purchaseState) { _, newState in
                handlePurchaseStateChange(newState)
            }
            .sheet(isPresented: $showCompare) {
                ComparePlansSheet(plans: plans, storeKit: storeKit)
            }
            .task {
                await loadData()
            }
        }
    }

    private func loadData() async {
        isLoading = true
        do {
            async let plansTask = apiClient.getPlans()
            async let entitlementsTask = apiClient.getBillingEntitlements()

            let (plansResponse, ents) = try await (plansTask, entitlementsTask)
            plans = plansResponse.plans.sorted { $0.sortOrder < $1.sortOrder }
            entitlements = ents

            // Default to pro tier if available
            if let proTier = plans.first(where: { $0.tier == "pro" }) {
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
                Text("←")
                    .font(.system(size: 20))
                    .foregroundColor(.white)
                    .frame(width: 44, height: 44)
                    .background(Color(hex: "#161616"))
                    .clipShape(Circle())
            }

            Spacer()

            Text("Plans")
                .font(.custom("PlayfairDisplay-Regular", size: 20))
                .foregroundColor(Color(hex: "#F5F5F0"))

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
        VStack(spacing: 4) {
            Text("\(currentCredits) credits")
                .font(.system(size: 36, weight: .light))
                .foregroundColor(.white)

            Text("\(songsLeftToday) songs left today")
                .font(.system(size: 14))
                .foregroundColor(Color(hex: "#666666"))
        }
        .frame(maxWidth: .infinity)
        .frame(height: 120)
        .background(Color(hex: "#1A1A1A"))
    }

    // MARK: - Toggle Section (Compact)

    private var toggleSection: some View {
        HStack(spacing: 8) {
            // Save badge
            Text("Save 20%")
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(.white)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Color(hex: "#E85D5D"))
                .cornerRadius(4)

            // Toggle pill
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
            .background(Color(hex: "#2A2A2A"))
            .cornerRadius(16)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 48)
    }

    private func toggleButton(title: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(isSelected ? .white : Color.white.opacity(0.5))
                .frame(width: 94, height: 28)
                .background(isSelected ? Color(hex: "#4A4A4A") : Color(hex: "#3A3A3A"))
                .cornerRadius(14)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Plan Cards Section

    private var planCardsSection: some View {
        VStack(spacing: 10) {
            if isLoading {
                ForEach(0..<3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Color(hex: "#161616"))
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
                        description: plan.description ?? "\(plan.songsPerMonth) songs/month",
                        showCurrentBadge: isCurrent,
                        price: price,
                        billingNote: billingNote
                    )
                }
            }
        }
    }

    private func formatPrice(for plan: SubscriptionPlan) -> String? {
        if billingPeriod == .annual {
            guard let annualCents = plan.priceAnnual else { return nil }
            let monthlyEquivalent = Double(annualCents) / 12.0 / 100.0
            return String(format: "$%.2f /month", monthlyEquivalent)
        } else {
            guard let monthlyCents = plan.priceMonthly else { return nil }
            return String(format: "$%.2f /month", Double(monthlyCents) / 100.0)
        }
    }

    private func formatBillingNote(for plan: SubscriptionPlan) -> String? {
        guard billingPeriod == .annual, let annualCents = plan.priceAnnual else { return nil }
        return String(format: "$%.2f Billed Annually", Double(annualCents) / 100.0)
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
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundColor(.white)

                        if showCurrentBadge {
                            Text("Current")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundColor(.white)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color(hex: "#444444"))
                                .cornerRadius(4)
                        }
                    }

                    Text(description)
                        .font(.system(size: hasPrice ? 13 : 14))
                        .foregroundColor(hasPrice ? Color.white.opacity(0.6) : Color(hex: "#999999"))
                        .lineLimit(1)
                }

                Spacer()

                // Price (if applicable)
                if let price = price {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(price)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(isSelected ? DesignTokens.gold : .white)

                        if let note = billingNote {
                            Text(note)
                                .font(.system(size: 11))
                                .foregroundColor(Color.white.opacity(0.5))
                        }
                    }
                    .frame(width: 120, alignment: .trailing)
                }
            }
            .padding(12)
            .background(Color(hex: "#161616"))
            .cornerRadius(10)
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(
                        isSelected ? DesignTokens.gold : Color(hex: "#2A2A2A"),
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
                    .foregroundColor(Color(hex: "#1A1A1A"))
            } else {
                Circle()
                    .stroke(Color(hex: "#666666"), lineWidth: 1.5)
                    .frame(width: 18, height: 18)
            }
        }
    }

    // MARK: - Continue Button

    private var continueButton: some View {
        Button {
            purchaseSelectedPlan()
        } label: {
            Text("Continue")
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(Color(hex: "#1A1A1A"))
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(Color(hex: "#F5F5F0"))
                .cornerRadius(26)
        }
        .buttonStyle(.plain)
        .disabled(selectedTier == "free")
        .opacity(selectedTier == "free" ? 0.5 : 1)
    }

    // MARK: - Compare Plans Button

    private var comparePlansButton: some View {
        Button {
            showCompare = true
        } label: {
            HStack(spacing: 8) {
                Text("Compare all plan features")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(.white)

                Text("↓")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(.white)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(Color.clear)
            .overlay(
                RoundedRectangle(cornerRadius: 26)
                    .stroke(Color(hex: "#666666"), lineWidth: 1)
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
                    .foregroundColor(.white)
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
        guard selectedTier != "free" else { return }

        // Map tier to product ID (premier uses pro products for now)
        let productId: ProductID = billingPeriod == .annual ? .proAnnual : .proMonthly

        guard let product = storeKit.product(for: productId) else {
            errorMessage = "Unable to load subscription. Please try again."
            showError = true
            return
        }

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

// MARK: - Compare Plans Sheet
// Matches v1.pen "15 - Compare Plans" design

private struct ComparePlansSheet: View {
    let plans: [SubscriptionPlan]
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var storeKit: StoreKitManager

    private let goldLabel = Color(hex: "#D4A574")
    private let checkGreen = Color(hex: "#4ADE80")

    private var freePlan: SubscriptionPlan? { plans.first(where: { $0.tier == "free" }) }
    private var proPlan: SubscriptionPlan? { plans.first(where: { $0.tier == "pro" }) }
    private var premierPlan: SubscriptionPlan? { plans.first(where: { $0.tier == "premier" }) }

    var body: some View {
        ZStack {
            Color(hex: "#0A0A0A").ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                headerBar

                // Content
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 0) {
                        // Title
                        Text("Compare all plan features")
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundColor(.white)
                            .padding(.top, 20)
                            .padding(.bottom, 24)

                        // Table Container
                        VStack(spacing: 0) {
                            // Header Row
                            tableHeaderRow

                            // Feature Rows
                            featureRow(
                                label: "Number of songs",
                                free: freePlan.map { "\($0.previewsPerDay)/day" } ?? "10/day",
                                pro: proPlan.map { "\($0.songsPerMonth)/month" } ?? "500/month",
                                premier: premierPlan.map { "\($0.songsPerMonth)/month" } ?? "2,500/month",
                                isEven: true
                            )

                            featureRow(
                                label: "Our most advanced\nmodel, v5",
                                free: nil,
                                pro: true,
                                premier: true,
                                isEven: false
                            )

                            featureRow(
                                label: "Commercial use",
                                free: nil,
                                pro: true,
                                premier: true,
                                isEven: true
                            )

                            featureRow(
                                label: "Pro features like\nPersonas & Remaster",
                                free: nil,
                                pro: true,
                                premier: true,
                                isEven: false
                            )

                            featureRow(
                                label: "Audio upload",
                                free: "Up to 1 min",
                                pro: "Up to 8 min",
                                premier: "Up to 8 min",
                                isEven: true
                            )

                            featureRow(
                                label: "Creation queue",
                                free: "Shared",
                                pro: "Priority",
                                premier: "Priority",
                                isEven: false
                            )
                        }
                        .padding(.horizontal, 16)

                        // Footer
                        footerSection
                    }
                }
            }
        }
    }

    // MARK: - Header

    private var headerBar: some View {
        HStack {
            Button {
                dismiss()
            } label: {
                Text("←")
                    .font(.system(size: 20))
                    .foregroundColor(.white)
                    .frame(width: 44, height: 44)
                    .background(Color(hex: "#161616"))
                    .clipShape(Circle())
            }

            Spacer()

            Text("Compare all plan features")
                .font(.custom("PlayfairDisplay-Regular", size: 20))
                .foregroundColor(Color(hex: "#F5F5F0"))

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

            Text("Free")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)

            Text("Pro")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)

            Text("Premier")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
        }
        .padding(.vertical, 12)
    }

    // MARK: - Feature Row (Text Values)

    private func featureRow(
        label: String,
        free: String?,
        pro: String,
        premier: String,
        isEven: Bool
    ) -> some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(goldLabel)
                .lineSpacing(4)
                .frame(width: 130, alignment: .leading)

            if let freeVal = free {
                Text(freeVal)
                    .font(.system(size: 12))
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
            } else {
                Text("🔒")
                    .font(.system(size: 16))
                    .foregroundColor(Color(hex: "#666666"))
                    .frame(maxWidth: .infinity)
            }

            Text(pro)
                .font(.system(size: 12))
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)

            Text(premier)
                .font(.system(size: 12))
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
        }
        .padding(.vertical, 14)
        .background(isEven ? Color(hex: "#161616") : Color(hex: "#1A1A1A"))
        .overlay(
            Rectangle()
                .fill(Color(hex: "#2A2A2A"))
                .frame(height: 1),
            alignment: .bottom
        )
    }

    // MARK: - Feature Row (Boolean Values)

    private func featureRow(
        label: String,
        free: Bool?,
        pro: Bool,
        premier: Bool,
        isEven: Bool
    ) -> some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(goldLabel)
                .lineSpacing(4)
                .frame(width: 130, alignment: .leading)

            if let hasFree = free, hasFree {
                Text("✓")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(checkGreen)
                    .frame(maxWidth: .infinity)
            } else {
                Text("🔒")
                    .font(.system(size: 16))
                    .foregroundColor(Color(hex: "#666666"))
                    .frame(maxWidth: .infinity)
            }

            Text(pro ? "✓" : "—")
                .font(.system(size: 18, weight: .semibold))
                .foregroundColor(pro ? checkGreen : Color(hex: "#666666"))
                .frame(maxWidth: .infinity)

            Text(premier ? "✓" : "—")
                .font(.system(size: 18, weight: .semibold))
                .foregroundColor(premier ? checkGreen : Color(hex: "#666666"))
                .frame(maxWidth: .infinity)
        }
        .padding(.vertical, 14)
        .background(isEven ? Color(hex: "#161616") : Color(hex: "#1A1A1A"))
        .overlay(
            Rectangle()
                .fill(Color(hex: "#2A2A2A"))
                .frame(height: 1),
            alignment: .bottom
        )
    }

    // MARK: - Footer

    private var footerSection: some View {
        HStack(spacing: 24) {
            Button {
                Task {
                    do {
                        try await AppStore.sync()
                    } catch {
                        print("[ComparePlans] Restore purchases failed: \(error)")
                    }
                }
            } label: {
                Text("Restore Purchases")
                    .font(.system(size: 13))
                    .foregroundColor(Color(hex: "#666666"))
            }

            Link("Terms", destination: URL(string: "https://porizo.co/terms")!)
                .font(.system(size: 13))
                .foregroundColor(Color(hex: "#666666"))

            Link("Privacy", destination: URL(string: "https://porizo.co/privacy")!)
                .font(.system(size: 13))
                .foregroundColor(Color(hex: "#666666"))
        }
        .padding(.vertical, 20)
    }
}

// MARK: - Preview

#Preview {
    let apiClient = APIClient(baseURL: AppConfig.apiBaseURL)
    SubscriptionView(apiClient: apiClient, storeKit: StoreKitManager.preview())
}
