//
//  GiftBagView.swift
//  PorizoApp
//
//  Gift token wallet, bundle purchase, and send-a-gift entry point.
//

import SwiftUI
import StoreKit

struct GiftBagView: View {
    let apiClient: APIClient
    var storeKit: StoreKitManager
    let onSendGift: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    @State private var walletBalance = 0
    @State private var walletTransactions: [GiftWalletTransaction] = []
    @State private var isLoading = true
    @State private var isPurchasing = false
    @State private var purchaseError: String?
    @State private var dismissSubscriptionNudge = false

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                if isLoading {
                    ProgressView("Loading wallet...")
                        .foregroundStyle(DesignTokens.textSecondary)
                } else {
                    contentView
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(DesignTokens.gold)
                }
            }
            .navigationTitle("Gift Bag")
            .navigationBarTitleDisplayMode(.inline)
        }
        .task {
            await storeKit.syncPendingGiftTransactions()
            await loadWallet()
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                Task {
                    await storeKit.syncPendingGiftTransactions()
                    await loadWallet()
                }
            }
        }
    }

    @ViewBuilder
    private var contentView: some View {
        let hasTransactions = !walletTransactions.isEmpty
        let hasBalance = walletBalance > 0

        if !hasBalance && !hasTransactions {
            emptyStateNeverPurchased
        } else {
            ScrollView {
                VStack(spacing: 16) {
                    walletCard

                    if hasTransactions {
                        recentTransactionsCard
                    }

                    buyTokensSection

                    if !storeKit.subscriptionState.hasActiveSubscription && !dismissSubscriptionNudge {
                        subscriptionUpsell
                    }

                    sendGiftButton
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 32)
            }
        }
    }

    // MARK: - Empty State: Never Purchased

    private var emptyStateNeverPurchased: some View {
        VStack(spacing: 20) {
            Spacer()

            Image(systemName: "gift.fill")
                .font(.system(size: 48))
                .foregroundStyle(DesignTokens.gold)

            Text("No gift tokens yet")
                .font(DesignTokens.displayFont(size: 22))
                .foregroundStyle(DesignTokens.textPrimary)

            Text("Buy gift tokens to create and send personalized songs and poems to the people you love.")
                .font(DesignTokens.bodyFont(size: 15))
                .foregroundStyle(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            buyTokensSection
                .padding(.horizontal, 20)

            Spacer()
        }
    }

    // MARK: - Wallet Card

    private var walletCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Token Balance")
                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                .foregroundStyle(DesignTokens.textSecondary)

            Text("\(walletBalance)")
                .font(DesignTokens.displayFont(size: 36))
                .foregroundStyle(walletBalance > 0 ? DesignTokens.gold : DesignTokens.textTertiary)

            Text("gift token\(walletBalance == 1 ? "" : "s") available")
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundStyle(DesignTokens.textSecondary)

            if walletBalance == 0 && !walletTransactions.isEmpty {
                Text("All tokens used — get more below")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.warning)
                    .padding(.top, 4)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DesignTokens.cardBackground)
        .clipShape(.rect(cornerRadius: 12))
    }

    // MARK: - Recent Transactions

    private var recentTransactionsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Recent Activity")
                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                .foregroundStyle(DesignTokens.textSecondary)

            ForEach(walletTransactions.prefix(5)) { tx in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(tx.type.replacingOccurrences(of: "_", with: " ").capitalized)
                            .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                            .foregroundStyle(DesignTokens.textPrimary)
                        Text(tx.createdAt.prefix(10))
                            .font(DesignTokens.bodyFont(size: 12))
                            .foregroundStyle(DesignTokens.textTertiary)
                    }
                    Spacer()
                    Text(tx.amount > 0 ? "+\(tx.amount)" : "\(tx.amount)")
                        .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                        .foregroundStyle(tx.amount > 0 ? DesignTokens.statusSuccess : DesignTokens.textSecondary)
                }
                if tx.id != walletTransactions.prefix(5).last?.id {
                    Divider().background(DesignTokens.border)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DesignTokens.cardBackground)
        .clipShape(.rect(cornerRadius: 12))
    }

    // MARK: - Buy Tokens Section

    private var buyTokensSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Buy Tokens")
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)

            if storeKit.giftBundleProducts.isEmpty {
                Text("Gift bundles are not available right now.")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .padding(.vertical, 8)
            } else {
                ForEach(storeKit.giftBundleProducts, id: \.id) { product in
                    bundleRow(for: product)
                }
            }

            if let error = purchaseError {
                Text(error)
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.error)
            }
        }
    }

    private func bundleRow(for product: Product) -> some View {
        let config = AppConfig.giftBundles.first { $0.productId == product.id }
        let isBestValue = product.id == ProductID.giftBundle3.rawValue

        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(config?.displayName ?? product.displayName)
                        .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                        .foregroundStyle(DesignTokens.textPrimary)

                    if isBestValue {
                        Text("BEST VALUE")
                            .font(DesignTokens.bodyFont(size: 10, weight: .semibold))
                            .foregroundStyle(DesignTokens.background)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(DesignTokens.gold)
                            .clipShape(.rect(cornerRadius: 4))
                    }
                }

                Text(product.description)
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.textSecondary)
            }

            Spacer()

            Button {
                Task { await purchaseBundle(product) }
            } label: {
                Text(isPurchasing ? "..." : product.displayPrice)
                    .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                    .foregroundStyle(DesignTokens.background)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(DesignTokens.gold)
                    .clipShape(.rect(cornerRadius: 8))
            }
            .disabled(isPurchasing)
            .buttonStyle(.plain)
        }
        .padding(14)
        .background(DesignTokens.cardBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(isBestValue ? DesignTokens.gold : DesignTokens.border, lineWidth: isBestValue ? 1.5 : 0.5)
        )
        .clipShape(.rect(cornerRadius: 12))
    }

    // MARK: - Subscription Upsell

    private var subscriptionUpsell: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                HStack(spacing: 8) {
                    Image(systemName: "crown.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(DesignTokens.gold)
                    Text("Get more with a subscription")
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        .foregroundStyle(DesignTokens.textPrimary)
                }
                Spacer()
                Button {
                    dismissSubscriptionNudge = true
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(DesignTokens.textTertiary)
                }
                .buttonStyle(.plain)
            }
            Text("Gift tokens are purchased separately. Subscriptions increase creation limits and other perks.")
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textSecondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DesignTokens.surfaceMuted)
        .clipShape(.rect(cornerRadius: 12))
    }

    // MARK: - Send Gift Button

    private var sendGiftButton: some View {
        Button {
            dismiss()
            onSendGift()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 16))
                Text("Send a Gift")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
            }
            .foregroundStyle(DesignTokens.background)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 15)
            .background(
                LinearGradient(
                    colors: [DesignTokens.gold, DesignTokens.gold.opacity(0.85)],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
            .clipShape(.rect(cornerRadius: 14))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Actions

    @MainActor
    private func loadWallet() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let response = try await apiClient.getGiftWallet(limit: 10)
            walletBalance = response.balance
            walletTransactions = response.transactions
        } catch {
            // Show stale data if available
        }
    }

    @MainActor
    private func purchaseBundle(_ product: Product) async {
        isPurchasing = true
        purchaseError = nil
        defer { isPurchasing = false }

        let purchased = await storeKit.purchase(product)
        guard purchased else {
            switch storeKit.purchaseState {
            case .syncFailed:
                purchaseError = "Payment received. Tokens could not be verified with the server yet. They will appear automatically once sync succeeds."
            case .failed(let error):
                purchaseError = error
            case .cancelled:
                break
            default:
                purchaseError = "Purchase failed."
            }
            return
        }

        do {
            let wallet = try await apiClient.getGiftWallet(limit: 10)
            walletBalance = wallet.balance
            walletTransactions = wallet.transactions
            storeKit.resetPurchaseState()
        } catch {
            // Purchase succeeded, wallet will refresh on next load
        }
    }
}
