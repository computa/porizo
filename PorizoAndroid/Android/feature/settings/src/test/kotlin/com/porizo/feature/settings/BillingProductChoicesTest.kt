package com.porizo.feature.settings

import com.porizo.core.domain.platform.PlayProductSummary
import com.porizo.core.model.SubscriptionPlan
import com.porizo.core.model.SubscriptionPlanProductIds
import kotlin.test.Test
import kotlin.test.assertEquals

class BillingProductChoicesTest {
    @Test
    fun productChoicesIncludeSubscriptionsAndOneTimeProducts() {
        val state = SettingsUiState(
            loadedProducts = listOf(
                PlayProductSummary(
                    id = "com.porizo.plus_monthly",
                    productType = "subs",
                    title = "Porizo Plus",
                    price = "\$9.99",
                ),
                PlayProductSummary(
                    id = "com.porizo.gift_bundle_1",
                    productType = "inapp",
                    title = "Gift bundle",
                    price = "\$4.99",
                ),
            ),
            plans = listOf(
                SubscriptionPlan(
                    id = "plus",
                    name = "Plus",
                    tier = "plus",
                    songsPerMonth = 10,
                    poemsPerMonth = 10,
                    priceMonthlyCents = 999,
                    priceAnnualCents = null,
                    description = null,
                    features = emptyList(),
                    isActive = true,
                    sortOrder = 1,
                    googleProductIds = SubscriptionPlanProductIds(
                        monthly = "com.porizo.plus_monthly",
                        annual = null,
                    ),
                ),
            ),
        )

        assertEquals(
            listOf("com.porizo.gift_bundle_1", "com.porizo.plus_monthly"),
            billingProductChoices(state),
        )
    }
}
