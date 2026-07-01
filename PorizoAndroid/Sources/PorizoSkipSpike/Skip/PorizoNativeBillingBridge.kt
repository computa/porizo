package porizo.skip.spike

import android.app.Activity
import android.content.Context
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import java.util.concurrent.ConcurrentHashMap

object PorizoNativeBillingBridge {
    private var currentActivity: Activity? = null
    private var billingClient: BillingClient? = null
    private val productDetailsById = ConcurrentHashMap<String, ProductDetails>()
    private val productTypesById = ConcurrentHashMap<String, String>()
    private val purchaseTokensByProductId = ConcurrentHashMap<String, String>()
    private var lastStatus: String = "Play Billing has not started."
    private var pendingSubscriptionIds: List<String> = emptyList()
    private var pendingOneTimeIds: List<String> = emptyList()

    private val purchaseListener = PurchasesUpdatedListener { billingResult, purchases ->
        lastStatus = "Purchase update: ${describeBillingResult(billingResult)}"
        if (billingResult.responseCode == BillingClient.BillingResponseCode.OK && purchases != null) {
            rememberPurchases(purchases)
        }
    }

    fun setActivity(activity: Activity?) {
        currentActivity = activity
    }

    fun queryProducts(context: Context, subscriptionProductIdsCsv: String, oneTimeProductIdsCsv: String): String {
        pendingSubscriptionIds = parseCsv(subscriptionProductIdsCsv)
        pendingOneTimeIds = parseCsv(oneTimeProductIdsCsv)
        val client = ensureClient(context)
        if (client.isReady) {
            queryProductsNow(client, pendingSubscriptionIds, pendingOneTimeIds)
            queryPurchasesNow(client)
        } else {
            connect(client, queryAfterConnect = true)
        }
        return lastStatus
    }

    fun launchPurchase(productId: String, obfuscatedAccountId: String?): String {
        val activity = currentActivity ?: return "No foreground Android activity is available for Play Billing."
        val client = billingClient ?: return "Play Billing client is not initialized."
        if (!client.isReady) {
            connect(client, queryAfterConnect = false)
            return "Play Billing is connecting. Try purchase again after products load."
        }

        val details = productDetailsById[productId] ?: return "Product $productId has not been loaded from Play Billing."
        val detailsBuilder = BillingFlowParams.ProductDetailsParams.newBuilder()
            .setProductDetails(details)

        if (details.productType == BillingClient.ProductType.SUBS) {
            val offerToken = details.subscriptionOfferDetails?.firstOrNull()?.offerToken
            if (offerToken.isNullOrBlank()) {
                return "Subscription $productId has no Play Billing offer token."
            }
            detailsBuilder.setOfferToken(offerToken)
        }

        val flowBuilder = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(detailsBuilder.build()))
        val accountId = obfuscatedAccountId?.takeIf { it.isNotBlank() }?.take(64)
        if (accountId != null) {
            flowBuilder.setObfuscatedAccountId(accountId)
        }

        val result = client.launchBillingFlow(activity, flowBuilder.build())
        lastStatus = "Purchase sheet launch: ${describeBillingResult(result)}"
        return lastStatus
    }

    fun queryActivePurchases(context: Context): String {
        val client = ensureClient(context)
        if (client.isReady) {
            queryPurchasesNow(client)
        } else {
            connect(client, queryAfterConnect = true)
        }
        return lastStatus
    }

    fun lastPurchaseToken(productId: String): String? {
        return if (productId.isBlank()) {
            purchaseTokensByProductId.values.firstOrNull()
        } else {
            purchaseTokensByProductId[productId]
        }
    }

    fun loadedProductsSummary(): String {
        if (productDetailsById.isEmpty()) {
            return "No Play Billing products loaded yet."
        }
        return productDetailsById.values
            .sortedBy { it.productId }
            .joinToString("\n") { details ->
                val price = if (details.productType == BillingClient.ProductType.SUBS) {
                    details.subscriptionOfferDetails
                        ?.firstOrNull()
                        ?.pricingPhases
                        ?.pricingPhaseList
                        ?.firstOrNull()
                        ?.formattedPrice
                } else {
                    details.oneTimePurchaseOfferDetails?.formattedPrice
                } ?: "price unavailable"
                "${details.productId}|${details.productType}|${details.title}|$price"
            }
    }

    fun status(): String {
        return lastStatus
    }

    private fun ensureClient(context: Context): BillingClient {
        val existing = billingClient
        if (existing != null) {
            return existing
        }
        val client = BillingClient.newBuilder(context.applicationContext)
            .setListener(purchaseListener)
            .enablePendingPurchases(
                PendingPurchasesParams.newBuilder()
                    .enableOneTimeProducts()
                    .build()
            )
            .enableAutoServiceReconnection()
            .build()
        billingClient = client
        return client
    }

    private fun connect(client: BillingClient, queryAfterConnect: Boolean) {
        if (client.isReady) {
            if (queryAfterConnect) {
                queryProductsNow(client, pendingSubscriptionIds, pendingOneTimeIds)
                queryPurchasesNow(client)
            }
            return
        }
        lastStatus = "Connecting to Play Billing."
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(billingResult: BillingResult) {
                lastStatus = "Billing setup: ${describeBillingResult(billingResult)}"
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK && queryAfterConnect) {
                    queryProductsNow(client, pendingSubscriptionIds, pendingOneTimeIds)
                    queryPurchasesNow(client)
                }
            }

            override fun onBillingServiceDisconnected() {
                lastStatus = "Play Billing service disconnected."
            }
        })
    }

    private fun queryProductsNow(client: BillingClient, subscriptionIds: List<String>, oneTimeIds: List<String>) {
        val products = buildList {
            subscriptionIds.forEach { productId ->
                add(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(productId)
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build()
                )
                productTypesById[productId] = BillingClient.ProductType.SUBS
            }
            oneTimeIds.forEach { productId ->
                add(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(productId)
                        .setProductType(BillingClient.ProductType.INAPP)
                        .build()
                )
                productTypesById[productId] = BillingClient.ProductType.INAPP
            }
        }
        if (products.isEmpty()) {
            lastStatus = "No Play Billing product IDs supplied."
            return
        }

        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(products)
            .build()
        lastStatus = "Querying ${products.size} Play Billing products."
        client.queryProductDetailsAsync(params) { billingResult, productDetailsResult ->
            val loaded = productDetailsResult.productDetailsList
            loaded.forEach { productDetailsById[it.productId] = it }
            lastStatus = "Product query: ${describeBillingResult(billingResult)} Loaded ${loaded.size} of ${products.size}."
        }
    }

    private fun queryPurchasesNow(client: BillingClient) {
        queryPurchasesForType(client, BillingClient.ProductType.SUBS)
        queryPurchasesForType(client, BillingClient.ProductType.INAPP)
    }

    private fun queryPurchasesForType(client: BillingClient, productType: String) {
        val params = QueryPurchasesParams.newBuilder()
            .setProductType(productType)
            .build()
        client.queryPurchasesAsync(params) { billingResult, purchases ->
            if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                rememberPurchases(purchases)
            }
            lastStatus = "Purchase restore query: ${describeBillingResult(billingResult)}"
        }
    }

    private fun rememberPurchases(purchases: List<Purchase>) {
        purchases.forEach { purchase ->
            purchase.products.forEach { productId ->
                purchaseTokensByProductId[productId] = purchase.purchaseToken
            }
        }
    }

    private fun parseCsv(value: String): List<String> {
        return value
            .split(",")
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .distinct()
    }

    private fun describeBillingResult(result: BillingResult): String {
        val debug = result.debugMessage.takeIf { it.isNotBlank() } ?: "no debug message"
        return "${result.responseCode} $debug"
    }
}
