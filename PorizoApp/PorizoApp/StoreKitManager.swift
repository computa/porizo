//
//  StoreKitManager.swift
//  PorizoApp
//
//  StoreKit 2 manager for subscription handling.
//  Handles product loading, purchases, and transaction observation.
//

import StoreKit
import Foundation
import Combine

// MARK: - Product Identifiers

/// App Store product identifiers matching backend plan_products table
enum ProductID: String, CaseIterable {
    case plusMonthly = "com.porizo.plus_monthly"
    case plusAnnual = "com.porizo.plus_annual"
    case proMonthly = "com.porizo.pro_monthly"
    case proAnnual = "com.porizo.pro_annual"

    var tier: String {
        switch self {
        case .plusMonthly, .plusAnnual: return "plus"
        case .proMonthly, .proAnnual: return "pro"
        }
    }

    var billingPeriod: String {
        switch self {
        case .plusMonthly, .proMonthly: return "monthly"
        case .plusAnnual, .proAnnual: return "annual"
        }
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
    case failed(error: String)
    case cancelled

    var isLoading: Bool {
        switch self {
        case .loading, .purchasing: return true
        default: return false
        }
    }
}

// MARK: - Subscription State

struct SubscriptionState: Equatable {
    var tier: String = "free"
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

/// Main manager for StoreKit 2 operations
/// Uses MainActor for UI updates while keeping init synchronous for @StateObject compatibility
final class StoreKitManager: ObservableObject {

    // MARK: - Published State

    @MainActor @Published private(set) var products: [Product] = []
    @MainActor @Published private(set) var purchaseState: PurchaseState = .idle
    @MainActor @Published private(set) var subscriptionState: SubscriptionState = .free
    @MainActor @Published private(set) var isLoadingProducts = true

    // MARK: - Dependencies

    private let apiClient: APIClient
    private var transactionListener: Task<Void, Error>?

    // MARK: - Lazy Initialization

    /// Flag to prevent multiple initializations
    private var isAsyncInitialized = false

    // MARK: - Transaction Deduplication (C11)

    /// Key for persisting processed transaction IDs
    private static let processedTransactionsKey = "porizo_processed_transaction_ids"

    /// Set of transaction IDs already synced with backend
    private var processedTransactionIds: Set<UInt64> = []

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
        saveProcessedTransactions()
    }

    // MARK: - Product Organization

    @MainActor
    var monthlyProducts: [Product] {
        products.filter { $0.id.contains("monthly") }
            .sorted { $0.price < $1.price }
    }

    @MainActor
    var annualProducts: [Product] {
        products.filter { $0.id.contains("annual") }
            .sorted { $0.price < $1.price }
    }

    /// Get product by ID
    @MainActor
    func product(for id: ProductID) -> Product? {
        products.first { $0.id == id.rawValue }
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
    @MainActor
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
    @MainActor
    private func processCurrentEntitlements() async {
        for await result in Transaction.currentEntitlements {
            switch result {
            case .verified(let transaction):
                // Skip if already processed (C11)
                guard !isTransactionProcessed(transaction.id) else {
                    continue
                }
                await syncTransaction(transaction)
            case .unverified:
                continue
            }
        }
    }

    deinit {
        transactionListener?.cancel()
    }

    // MARK: - Product Loading

    /// Load products from App Store
    @MainActor
    func loadProducts() async {
        isLoadingProducts = true

        do {
            let storeProducts = try await Product.products(for: ProductID.allIdentifiers)
            products = storeProducts.sorted { $0.price < $1.price }
            isLoadingProducts = false
            print("[StoreKit] Loaded \(products.count) products")
        } catch {
            print("[StoreKit] Failed to load products: \(error)")
            isLoadingProducts = false
        }
    }

    // MARK: - Purchase

    /// Purchase a product
    /// - Parameter product: The product to purchase
    /// - Returns: Success status
    @MainActor
    @discardableResult
    func purchase(_ product: Product) async -> Bool {
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
                        // Only finish transaction if sync succeeded
                        await transaction.finish()
                        purchaseState = .success(transactionId: transaction.id)
                        return true
                    } else {
                        // Sync failed - don't finish transaction, will retry on next launch
                        // Show success to user since payment went through, but log warning
                        print("[StoreKit] Purchase succeeded but sync failed - will retry on next launch")
                        purchaseState = .success(transactionId: transaction.id)
                        return true  // Payment succeeded even if sync failed
                    }

                case .unverified(let transaction, let error):
                    print("[StoreKit] Unverified transaction: \(error)")
                    // Still finish it to clear from queue
                    await transaction.finish()
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
    @MainActor
    func restore() async {
        purchaseState = .loading

        do {
            // Sync all current entitlements
            try await AppStore.sync()

            // Process any transactions
            for await result in Transaction.currentEntitlements {
                switch result {
                case .verified(let transaction):
                    await syncTransaction(transaction)
                case .unverified:
                    continue
                }
            }

            await refreshSubscriptionState()
            purchaseState = .idle
        } catch {
            print("[StoreKit] Restore failed: \(error)")
            purchaseState = .failed(error: error.localizedDescription)
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

                case .unverified(let transaction, _):
                    // Still finish unverified transactions
                    await transaction.finish()
                }

                // Refresh state after any transaction
                await self.refreshSubscriptionState()
            }
        }
    }

    /// Sync a transaction with the backend
    /// - Returns: true if sync succeeded, false otherwise
    @MainActor
    @discardableResult
    private func syncTransaction(_ transaction: Transaction) async -> Bool {
        // Check deduplication first (C11)
        guard !isTransactionProcessed(transaction.id) else {
            print("[StoreKit] Transaction \(transaction.id) already processed, skipping")
            return true  // Already processed = success
        }

        do {
            // Send transaction ID to backend for validation
            let result = try await apiClient.syncAppleReceipt(
                transactionId: String(transaction.id)
            )

            print("[StoreKit] Synced transaction \(transaction.id): tier=\(result.subscription.tier)")

            // Mark as processed AFTER successful sync (C11)
            markTransactionProcessed(transaction.id)

            // Update local state
            await refreshSubscriptionState()
            return true
        } catch {
            print("[StoreKit] Failed to sync transaction \(transaction.id): \(error)")
            // Do NOT mark as processed - will retry on next app launch (C6)
            return false
        }
    }

    // MARK: - Subscription State

    /// Refresh subscription state from backend
    @MainActor
    func refreshSubscriptionState() async {
        do {
            let response = try await apiClient.getBillingEntitlements()

            subscriptionState = SubscriptionState(
                tier: response.tier,
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
    @MainActor
    func activateTrial() async throws {
        // Prevent trial activation during active subscription (H13)
        guard !subscriptionState.hasActiveSubscription else {
            throw TrialError.alreadySubscribed
        }

        // Prevent if trial already active
        guard !subscriptionState.isTrialActive else {
            throw TrialError.trialAlreadyUsed
        }

        let result = try await apiClient.activateTrial()
        subscriptionState.isTrialActive = true
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
        return monthlyAmount.formatted(.currency(code: product.priceFormatStyle.currencyCode ?? "USD"))
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
    @MainActor
    func resetPurchaseState() {
        purchaseState = .idle
    }
}

// MARK: - Preview Helper

extension StoreKitManager {
    /// Create a preview instance with mock data
    @MainActor
    static func preview() -> StoreKitManager {
        let manager = StoreKitManager(apiClient: APIClient(baseURL: AppConfig.apiBaseURL))
        // Set mock state for previews
        manager.subscriptionState = SubscriptionState(
            tier: "free",
            songsRemaining: 2,
            songsAllowance: 0,
            isTrialActive: true,
            trialExpiresAt: Date().addingTimeInterval(7 * 24 * 60 * 60)
        )
        return manager
    }
}
