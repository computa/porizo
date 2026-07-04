package com.porizo.core.platform

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
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class PlayBillingProvider @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val activityHolder: ActivityHolder,
) {
    private var billingClient: BillingClient? = null
    private val productDetailsById = ConcurrentHashMap<String, ProductDetails>()
    private val purchaseTokensByProductId = ConcurrentHashMap<String, String>()
    private var lastStatus: String = "Play Billing has not started."
    private var pendingSubscriptionIds: List<String> = emptyList()
    private var pendingOneTimeIds: List<String> = emptyList()

    private val purchaseListener = PurchasesUpdatedListener { billingResult, purchases ->
        lastStatus = "Purchase update: ${billingResult.describe()}"
        if (billingResult.responseCode == BillingClient.BillingResponseCode.OK && purchases != null) {
            rememberPurchases(purchases)
        }
    }

    fun queryProducts(subscriptionIds: List<String>, oneTimeIds: List<String>): String {
        pendingSubscriptionIds = subscriptionIds.cleaned()
        pendingOneTimeIds = oneTimeIds.cleaned()
        val client = ensureClient()
        if (client.isReady) {
            queryProductsNow(client, pendingSubscriptionIds, pendingOneTimeIds)
            queryPurchasesNow(client)
        } else {
            connect(client, queryAfterConnect = true)
        }
        return lastStatus
    }

    fun launchPurchase(productId: String, obfuscatedAccountId: String?): String {
        val activity = activityHolder.current() ?: return "No foreground Android activity is available for Play Billing."
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
        obfuscatedAccountId
            ?.takeIf { it.isNotBlank() }
            ?.take(64)
            ?.let(flowBuilder::setObfuscatedAccountId)

        val result = client.launchBillingFlow(activity, flowBuilder.build())
        lastStatus = "Purchase sheet launch: ${result.describe()}"
        return lastStatus
    }

    fun queryActivePurchases(): String {
        val client = ensureClient()
        if (client.isReady) {
            queryPurchasesNow(client)
        } else {
            connect(client, queryAfterConnect = true)
        }
        return lastStatus
    }

    fun lastPurchaseToken(productId: String): String? =
        if (productId.isBlank()) {
            purchaseTokensByProductId.values.firstOrNull()
        } else {
            purchaseTokensByProductId[productId]
        }

    fun loadedProducts(): List<PlayProductSummary> =
        productDetailsById.values
            .sortedBy { it.productId }
            .map { details ->
                PlayProductSummary(
                    id = details.productId,
                    productType = details.productType,
                    title = details.title,
                    price = details.displayPrice(),
                )
            }

    fun status(): String = lastStatus

    private fun ensureClient(): BillingClient {
        val existing = billingClient
        if (existing != null) return existing
        val client = BillingClient.newBuilder(context.applicationContext)
            .setListener(purchaseListener)
            .enablePendingPurchases(
                PendingPurchasesParams.newBuilder()
                    .enableOneTimeProducts()
                    .build(),
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
                lastStatus = "Billing setup: ${billingResult.describe()}"
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
                        .build(),
                )
            }
            oneTimeIds.forEach { productId ->
                add(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(productId)
                        .setProductType(BillingClient.ProductType.INAPP)
                        .build(),
                )
            }
        }
        if (products.isEmpty()) {
            lastStatus = "No Play Billing product IDs supplied."
            return
        }

        lastStatus = "Querying ${products.size} Play Billing products."
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(products)
            .build()
        client.queryProductDetailsAsync(params) { billingResult, productDetailsResult ->
            val loaded = productDetailsResult.productDetailsList
            loaded.forEach { productDetailsById[it.productId] = it }
            lastStatus = "Product query: ${billingResult.describe()} Loaded ${loaded.size} of ${products.size}."
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
            lastStatus = "Purchase restore query: ${billingResult.describe()}"
        }
    }

    private fun rememberPurchases(purchases: List<Purchase>) {
        purchases.forEach { purchase ->
            purchase.products.forEach { productId ->
                purchaseTokensByProductId[productId] = purchase.purchaseToken
            }
        }
    }

    private fun ProductDetails.displayPrice(): String =
        if (productType == BillingClient.ProductType.SUBS) {
            subscriptionOfferDetails
                ?.firstOrNull()
                ?.pricingPhases
                ?.pricingPhaseList
                ?.firstOrNull()
                ?.formattedPrice
        } else {
            oneTimePurchaseOfferDetails?.formattedPrice
        } ?: "price unavailable"

    private fun BillingResult.describe(): String {
        val debug = debugMessage.takeIf { it.isNotBlank() } ?: "no debug message"
        return "$responseCode $debug"
    }

    private fun List<String>.cleaned(): List<String> =
        map { it.trim() }
            .filter { it.isNotEmpty() }
            .distinct()
}
