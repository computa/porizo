//
//  StoreKitManager.swift
//  PorizoApp
//
//  StoreKit 2 manager for subscription handling.
//  Handles product loading, purchases, and transaction observation.
//

import StoreKit
import Foundation
import Observation

// MARK: - Product Identifiers

/// App Store product identifiers matching backend plan_products table
enum ProductID: String, CaseIterable {
    case plusMonthly = "com.porizo.plus_monthly"
    case plusAnnual = "com.porizo.plus_annual"
    case proMonthly = "com.porizo.pro_monthly"
    case proAnnual = "com.porizo.pro_annual"
    case giftTokenOneOff = "com.porizo.gift_token_oneoff"
    case giftBundle1 = "com.porizo.gift_bundle_1"
    case giftBundle3 = "com.porizo.gift_bundle_3"
    case giftBundle5 = "com.porizo.gift_bundle_5"

    var tier: String {
        switch self {
        case .plusMonthly, .plusAnnual: return "plus"
        case .proMonthly, .proAnnual: return "pro"
        case .giftTokenOneOff, .giftBundle1, .giftBundle3, .giftBundle5: return "gift"
        }
    }

    var billingPeriod: String {
        switch self {
        case .plusMonthly, .proMonthly: return "monthly"
        case .plusAnnual, .proAnnual: return "annual"
        case .giftTokenOneOff, .giftBundle1, .giftBundle3, .giftBundle5: return "one_time"
        }
    }

    var isGiftBundleProduct: Bool {
        switch self {
        case .giftBundle1, .giftBundle3, .giftBundle5, .giftTokenOneOff: return true
        default: return false
        }
    }

    static var subscriptionIdentifiers: [String] {
        [
            plusMonthly.rawValue,
            plusAnnual.rawValue,
            proMonthly.rawValue,
            proAnnual.rawValue
        ]
    }

    static var allIdentifiers: [String] {
        allCases.map { $0.rawValue }
    }
}

// MARK: - Purchase State

enum PurchaseState: Equatable {
    case idle
    case loading
    case purchasing
    case success(transactionId: UInt64)
    case syncFailed
    case failed(error: String)
    case cancelled

    var isLoading: Bool {
        switch self {
        case .loading, .purchasing: return true
        default: return false
        }
    }

    /// True while a purchase is in flight OR just succeeded — used to keep a
    /// consumable buy button disabled until the paywall dismisses, so a stray
    /// second tap can't trigger a duplicate charge (LB1).
    var blocksRepeatPurchase: Bool {
        switch self {
        case .loading, .purchasing, .success: return true
        default: return false
        }
    }
}

// MARK: - Subscription State

struct SubscriptionState: Equatable {
    var tier: String = "free"
    var baseSongsRemaining: Int = 0
    var trialSongsRemaining: Int = 0
    var songsRemaining: Int = 0
    var songsAllowance: Int = 0
    var isTrialActive: Bool = false
    var trialExpiresAt: Date?
    var subscriptionExpiresAt: Date?
    var autoRenewEnabled: Bool = false
    var isInGracePeriod: Bool = false

    var hasActiveSubscription: Bool {
        tier != "free" && !isExpired
    }

    var isExpired: Bool {
        guard let expiresAt = subscriptionExpiresAt else { return tier == "free" }
        return Date() > expiresAt
    }

    var displayTier: String {
        switch tier {
        case "plus": return "Plus"
        case "pro": return "Pro"
        default: return "Free"
        }
    }

    static let free = SubscriptionState()
}

// MARK: - StoreKit Manager

/// Main manager for StoreKit 2 operations (Observation framework)
@MainActor
@Observable
final class StoreKitManager {

    // MARK: - Observable State

    private(set) var products: [Product] = []
    private(set) var purchaseState: PurchaseState = .idle
    private(set) var subscriptionState: SubscriptionState = .free
    private(set) var isLoadingProducts = true

    // MARK: - Dependencies

    @ObservationIgnored private let apiClient: APIClient
    @ObservationIgnored private var transactionListener: Task<Void, Error>?

    // MARK: - Lazy Initialization

    /// Flag to prevent multiple initializations
    @ObservationIgnored private var isAsyncInitialized = false

    /// Flag to prevent stacked retryUnfinishedTransactions calls
    @ObservationIgnored private var isRetryingUnfinished = false

    /// Flag to prevent stacked restore() calls
    @ObservationIgnored private var isRestoring = false

    // MARK: - Transaction Deduplication (C11)

    /// Key for persisting processed transaction IDs
    private static let processedTransactionsKey = "porizo_processed_transaction_ids"

    /// Set of transaction IDs already synced with backend
    @ObservationIgnored private var processedTransactionIds: Set<UInt64> = []

    /// Load processed transaction IDs from persistent storage
    private func loadProcessedTransactions() {
        if let data = UserDefaults.standard.data(forKey: Self.processedTransactionsKey),
           let ids = try? JSONDecoder().decode(Set<UInt64>.self, from: data) {
            processedTransactionIds = ids
        }
    }

    /// Save processed transaction IDs to persistent storage
    private func saveProcessedTransactions() {
        if let data = try? JSONEncoder().encode(processedTransactionIds) {
            UserDefaults.standard.set(data, forKey: Self.processedTransactionsKey)
        }
    }

    /// Check if a transaction has already been processed
    private func isTransactionProcessed(_ transactionId: UInt64) -> Bool {
        processedTransactionIds.contains(transactionId)
    }

    /// Mark a transaction as processed
    private func markTransactionProcessed(_ transactionId: UInt64) {
        processedTransactionIds.insert(transactionId)
        // Cap at 500 entries to prevent unbounded growth in UserDefaults.
        // Keep larger (newer) IDs since Apple assigns them sequentially.
        if processedTransactionIds.count > 500 {
            let sorted = processedTransactionIds.sorted()
            processedTransactionIds = Set(sorted.suffix(300))
        }
        saveProcessedTransactions()
    }

    // MARK: - Product Organization

    var monthlyProducts: [Product] {
        products.filter { $0.id.contains("monthly") }
            .sorted { $0.price < $1.price }
    }

    var annualProducts: [Product] {
        products.filter { $0.id.contains("annual") }
            .sorted { $0.price < $1.price }
    }

    var giftTokenProduct: Product? {
        product(for: .giftTokenOneOff)
    }

    /// The single-song consumable (`gift_bundle_1`) surfaced as the
    /// "pay for one song" option. Deliberately separate from
    /// `giftBundleProducts` (which lists multi-token gift bundles).
    var payPerSongProduct: Product? {
        product(for: .giftBundle1)
    }

    var giftBundleProducts: [Product] {
        products.filter {
            let pid = ProductID(rawValue: $0.id)
            return pid?.isGiftBundleProduct == true && pid != .giftTokenOneOff && pid != .giftBundle1
        }.sorted { $0.price < $1.price }
    }

    /// Get product by ID
    func product(for id: ProductID) -> Product? {
        product(forIdentifier: id.rawValue)
    }

    /// Get product by raw App Store product identifier
    func product(forIdentifier id: String) -> Product? {
        products.first { $0.id == id }
    }

    /// Load a single product from App Store without replacing cached product list.
    func fetchProduct(identifier: String) async -> Product? {
        do {
            let items = try await Product.products(for: [identifier])
            return items.first
        } catch {
            print("[StoreKit] Failed to fetch product \(identifier): \(error.localizedDescription)")
            return nil
        }
    }

    // MARK: - Initialization

    init(apiClient: APIClient) {
        self.apiClient = apiClient

        // Load processed transaction IDs from persistent storage (C11)
        loadProcessedTransactions()

        // Start listening for transactions (lightweight - no network calls)
        transactionListener = listenForTransactions()

        // NOTE: Network calls moved to initializeAsync() for lazy loading
        // This prevents blocking MainTabView creation
    }

    /// Lazy initialization for network-dependent operations.
    /// Call this from MainTabView.onAppear to load products and sync state
    /// AFTER the UI is already visible.
    func initializeAsync() async {
        guard !isAsyncInitialized else { return }
        isAsyncInitialized = true

        await loadProducts()
        // Process any existing entitlements (C7)
        // This catches transactions that completed while app was killed
        await processCurrentEntitlements()
        // Then sync with backend for authoritative state
        await refreshSubscriptionState()
    }

    /// Process any current entitlements on app launch (C7)
    /// This catches transactions that completed while the app was killed
    private func processCurrentEntitlements() async {
        await BackgroundTaskManager.shared.executeWithBackgroundTime(
            taskName: "processEntitlements"
        ) {
            await self.processUnfinishedTransactions(forceSync: true)
            await self.syncCurrentEntitlements(force: false)
        }
    }

    /// Iterate current entitlements and sync each with backend.
    /// - Parameter force: If true, re-syncs even if already processed (C11).
    private func syncCurrentEntitlements(force: Bool) async {
        for await result in Transaction.currentEntitlements {
            switch result {
            case .verified(let transaction):
                if !force, isTransactionProcessed(transaction.id) { continue }
                await syncTransaction(transaction, force: force)
            case .unverified:
                continue
            }
        }
    }

    /// Process unfinished transactions and finish only after successful sync.
    private func processUnfinishedTransactions(
        filter: ((Transaction) -> Bool)? = nil,
        forceSync: Bool = false
    ) async {
        for await result in Transaction.unfinished {
            switch result {
            case .verified(let transaction):
                if let filter, !filter(transaction) {
                    continue
                }
                let synced = await syncTransaction(transaction, force: forceSync)
                if synced {
                    await transaction.finish()
                }
            case .unverified(_, let error):
                // Do NOT finish unverified transactions — they may become verifiable
                // after a certificate rollover or clock-skew resolution.
                print("[StoreKit] Skipping unverified unfinished transaction: \(error)")
            }
        }
    }

    /// Retry any unfinished subscription transactions that failed backend sync.
    /// Safe to call multiple times — guarded by isRetryingUnfinished flag.
    func retryUnfinishedTransactions() async {
        guard !isRetryingUnfinished else { return }
        isRetryingUnfinished = true
        defer { isRetryingUnfinished = false }

        await processUnfinishedTransactions(forceSync: true)
        await refreshSubscriptionState()
    }

    /// Retry sync for any unfinished gift bundle transactions.
    /// Call on view appear to catch purchases that failed to sync previously.
    func syncPendingGiftTransactions() async {
        await processUnfinishedTransactions(
            filter: { transaction in
                guard let pid = ProductID(rawValue: transaction.productID) else {
                    return false
                }
                return pid.isGiftBundleProduct
            },
            forceSync: true
        )
    }

    deinit {
        transactionListener?.cancel()
    }

    // MARK: - Product Loading

    /// Load products from App Store
    func loadProducts(identifiers: [String] = ProductID.allIdentifiers) async {
        isLoadingProducts = true
        let normalizedIdentifiers = Array(Set(
            identifiers
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
        )).sorted()

        guard !normalizedIdentifiers.isEmpty else {
            products = []
            isLoadingProducts = false
            print("[StoreKit] No product identifiers provided")
            return
        }

        do {
            let storeProducts = try await Product.products(for: normalizedIdentifiers)
            products = storeProducts.sorted { $0.price < $1.price }
            isLoadingProducts = false
            print("[StoreKit] Loaded \(products.count) products for \(normalizedIdentifiers.count) identifiers")
        } catch {
            print("[StoreKit] Failed to load products: \(error)")
            isLoadingProducts = false
        }
    }

    // MARK: - Purchase

    /// Purchase a product
    /// - Parameter product: The product to purchase
    /// - Returns: Success status
    @discardableResult
    func purchase(_ product: Product) async -> Bool {
        // Single chokepoint against duplicate charges: reject while ANY purchase is
        // in flight or just succeeded (not only `.purchasing`). Covers a second tap
        // on a different product on the same screen (hero / bundle / subscribe) and
        // the post-`.success` window before the paywall dismisses (LB1).
        guard !purchaseState.blocksRepeatPurchase else { return false }
        purchaseState = .purchasing

        do {
            let result = try await product.purchase()

            switch result {
            case .success(let verification):
                // Verify the transaction
                switch verification {
                case .verified(let transaction):
                    // Send to backend for validation (C6)
                    let syncSucceeded = await syncTransaction(transaction)

                    if syncSucceeded {
                        await transaction.finish()
                        await refreshSubscriptionState()
                        // Ship purchase event to AppsFlyer (AFEventPurchase) + backend +
                        // Firebase + Amplitude through the unified AnalyticsService pipeline.
                        // This is the signal ad networks use for ROAS-based optimization.
                        AnalyticsService.shared.logPurchase(
                            amount: product.price,
                            currency: product.priceFormatStyle.currencyCode,
                            productId: product.id
                        )
                        purchaseState = .success(transactionId: transaction.id)
                        return true
                    } else {
                        // Sync failed - don't finish transaction, will retry on next launch
                        print("[StoreKit] Purchase succeeded but sync failed - will retry on next launch")
                        purchaseState = .syncFailed
                        return false
                    }

                case .unverified(_, let error):
                    print("[StoreKit] Unverified purchase transaction: \(error)")
                    purchaseState = .failed(error: "Transaction verification failed")
                    return false
                }

            case .pending:
                // Transaction is pending (ask to buy, etc.)
                purchaseState = .idle
                return false

            case .userCancelled:
                purchaseState = .cancelled
                return false

            @unknown default:
                purchaseState = .failed(error: "Unknown purchase result")
                return false
            }
        } catch {
            print("[StoreKit] Purchase failed: \(error)")
            purchaseState = .failed(error: error.localizedDescription)
            return false
        }
    }

    /// Restore purchases
    func restore() async {
        guard !isRestoring else { return }
        isRestoring = true
        defer { isRestoring = false }
        purchaseState = .loading

        await BackgroundTaskManager.shared.executeWithBackgroundTime(
            taskName: "restorePurchases"
        ) {
            do {
                try await AppStore.sync()
                await self.processUnfinishedTransactions(forceSync: true)
                await self.syncCurrentEntitlements(force: true)
                await self.refreshSubscriptionState()
                self.purchaseState = .idle
            } catch {
                print("[StoreKit] Restore failed: \(error)")
                self.purchaseState = .failed(error: error.localizedDescription)
            }
        }
    }

    // MARK: - Transaction Handling

    /// Listen for transaction updates (renewals, refunds, etc.)
    private func listenForTransactions() -> Task<Void, Error> {
        Task.detached { [weak self] in
            for await result in Transaction.updates {
                guard let self = self else { break }

                switch result {
                case .verified(let transaction):
                    // Only finish transaction if sync succeeded (C6)
                    // If sync fails, transaction stays unfinished and will retry on next launch
                    let syncSucceeded = await self.syncTransaction(transaction)
                    if syncSucceeded {
                        await transaction.finish()
                    } else {
                        print("[StoreKit] Transaction \(transaction.id) not finished - will retry on next launch")
                    }

                case .unverified(_, let error):
                    print("[StoreKit] Skipping unverified transaction update: \(error)")
                }

                // Refresh state after any transaction
                await self.refreshSubscriptionState()
            }
        }
    }

    /// Sync a transaction with the backend
    /// - Returns: true if sync succeeded, false otherwise
    @discardableResult
    private func syncTransaction(_ transaction: Transaction, force: Bool = false) async -> Bool {
        // Check deduplication first (C11)
        guard force || !isTransactionProcessed(transaction.id) else {
            print("[StoreKit] Transaction \(transaction.id) already processed, skipping")
            return true  // Already processed = success
        }

        // Wrap in background task - payment sync is CRITICAL
        // Must complete even if user backgrounds the app
        do {
            return try await BackgroundTaskManager.shared.executeWithBackgroundTime(
                taskName: "paymentSync-\(transaction.id)"
            ) {
                // Send transaction ID to backend for validation
                if let pid = ProductID(rawValue: transaction.productID), pid.isGiftBundleProduct {
                    let result = try await self.apiClient.syncAppleGiftConsumable(
                        transactionId: String(transaction.id)
                    )
                    print("[StoreKit] Synced gift token transaction \(transaction.id): balance=\(result.balance)")
                } else {
                    let result = try await self.apiClient.syncAppleReceipt(
                        transactionId: String(transaction.id)
                    )
                    print("[StoreKit] Synced transaction \(transaction.id): tier=\(result.subscription.tier)")
                }

                // Mark as processed AFTER successful sync (C11)
                self.markTransactionProcessed(transaction.id)
                return true
            }
        } catch {
            print("[StoreKit] Failed to sync transaction \(transaction.id): \(error)")
            // Do NOT mark as processed - will retry on next app launch (C6)
            return false
        }
    }

    // MARK: - Subscription State

    /// Refresh subscription state from backend
    func refreshSubscriptionState() async {
        do {
            let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(
                taskName: "refreshEntitlements"
            ) { [self] in
                try await apiClient.getBillingEntitlements()
            }

            subscriptionState = SubscriptionState(
                tier: response.tier,
                baseSongsRemaining: response.baseSongsRemaining,
                trialSongsRemaining: response.trialSongsRemaining,
                songsRemaining: response.songsRemaining,
                songsAllowance: response.songsAllowance,
                isTrialActive: response.isTrialActive,
                trialExpiresAt: response.trialExpiresAtDate,
                subscriptionExpiresAt: response.subscriptionExpiresAtDate,
                autoRenewEnabled: response.autoRenewEnabled ?? false,
                isInGracePeriod: response.isInGracePeriod ?? false
            )
        } catch {
            print("[StoreKit] Failed to refresh subscription state: \(error)")
        }
    }

    // MARK: - Trial Activation

    /// Error thrown when trial activation is not allowed
    enum TrialError: LocalizedError {
        case alreadySubscribed
        case trialAlreadyUsed

        var errorDescription: String? {
            switch self {
            case .alreadySubscribed:
                return "You already have an active subscription"
            case .trialAlreadyUsed:
                return "Free trial has already been used"
            }
        }
    }

    /// Activate free trial
    /// - Throws: TrialError.alreadySubscribed if user has active subscription (H13)
    func activateTrial() async throws {
        // Prevent trial activation during active subscription (H13)
        guard !subscriptionState.hasActiveSubscription else {
            throw TrialError.alreadySubscribed
        }

        // Prevent if trial already active
        guard !subscriptionState.isTrialActive else {
            throw TrialError.trialAlreadyUsed
        }

        let result = try await BackgroundTaskManager.shared.executeWithBackgroundTime(
            taskName: "activateTrial"
        ) { [self] in
            try await apiClient.activateTrial()
        }
        subscriptionState.isTrialActive = true
        subscriptionState.baseSongsRemaining = max(result.songsRemaining - result.songsGranted, 0)
        subscriptionState.trialSongsRemaining = result.songsGranted
        subscriptionState.songsRemaining = result.songsRemaining
        subscriptionState.trialExpiresAt = result.trialExpiresAtDate
    }

    // MARK: - Helpers

    /// Check if user is eligible for introductory offer
    func isEligibleForIntro(for product: Product) async -> Bool {
        guard let subscription = product.subscription else { return false }
        return await subscription.isEligibleForIntroOffer
    }

    /// Get formatted price for a product
    func formattedPrice(for product: Product) -> String {
        product.displayPrice
    }

    /// Get price per month for annual products
    func monthlyPrice(for product: Product) -> String? {
        guard product.id.contains("annual") else { return nil }
        let monthlyAmount = product.price / 12
        return monthlyAmount.formatted(.currency(code: product.priceFormatStyle.currencyCode))
    }

    /// Calculate savings percentage for annual vs monthly
    func annualSavings(annual: Product, monthly: Product) -> Int {
        let annualCost = NSDecimalNumber(decimal: annual.price).doubleValue
        let monthlyEquivalent = NSDecimalNumber(decimal: monthly.price).doubleValue * 12
        guard monthlyEquivalent > 0 else { return 0 }
        let savings = (1 - (annualCost / monthlyEquivalent)) * 100
        return Int(savings.rounded())
    }

    /// Reset purchase state (for UI)
    func resetPurchaseState() {
        purchaseState = .idle
    }
}

// MARK: - Preview Helper

extension StoreKitManager {
    /// Create a preview instance with mock data
    static func preview() -> StoreKitManager {
        let manager = StoreKitManager(apiClient: APIClient(baseURL: AppConfig.apiBaseURL))
        // Set mock state for previews
        manager.subscriptionState = SubscriptionState(
            tier: "free",
            baseSongsRemaining: 0,
            trialSongsRemaining: 2,
            songsRemaining: 2,
            songsAllowance: 0,
            isTrialActive: true,
            trialExpiresAt: Date().addingTimeInterval(7 * 24 * 60 * 60)
        )
        return manager
    }
}
