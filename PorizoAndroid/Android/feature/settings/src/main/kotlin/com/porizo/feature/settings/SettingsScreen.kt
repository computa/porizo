package com.porizo.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.porizo.core.domain.platform.PlayProductSummary
import com.porizo.core.model.SubscriptionPlan
import com.porizo.core.ui.FrauncesTitle
import com.porizo.core.ui.PorizoCard
import com.porizo.core.ui.PorizoColors
import com.porizo.core.ui.PorizoPrimaryButton
import com.porizo.core.ui.PorizoScreen
import com.porizo.core.ui.PorizoSecondaryButton

@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel,
    isAuthenticated: Boolean,
    authenticatedUserId: String?,
    onSignInRequested: () -> Unit,
    onLogoutRequested: () -> Unit,
    innerPadding: PaddingValues,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.uiState.collectAsState()
    SettingsScreen(
        state = state,
        isAuthenticated = isAuthenticated,
        authenticatedUserId = authenticatedUserId,
        onSignInRequested = onSignInRequested,
        onLogoutRequested = onLogoutRequested,
        onLoadBilling = viewModel::loadBilling,
        onSelectProduct = viewModel::selectProduct,
        onLaunchPurchase = viewModel::launchPurchase,
        onRefreshPurchases = viewModel::refreshPurchases,
        onSyncReceipt = viewModel::syncGoogleReceipt,
        onEnablePush = viewModel::enablePush,
        onDisablePush = viewModel::disablePush,
        onLoadVoiceStatus = viewModel::loadVoiceStatus,
        onRequestMic = viewModel::requestMicrophonePermission,
        onStartEnrollment = viewModel::startEnrollment,
        onStartRecording = viewModel::startRecording,
        onStopAndUpload = viewModel::stopAndUploadRecording,
        onCreateVoiceProfile = viewModel::createVoiceProfile,
        innerPadding = innerPadding,
        modifier = modifier,
    )
}

@Composable
private fun SettingsScreen(
    state: SettingsUiState,
    isAuthenticated: Boolean,
    authenticatedUserId: String?,
    onSignInRequested: () -> Unit,
    onLogoutRequested: () -> Unit,
    onLoadBilling: () -> Unit,
    onSelectProduct: (String) -> Unit,
    onLaunchPurchase: () -> Unit,
    onRefreshPurchases: () -> Unit,
    onSyncReceipt: () -> Unit,
    onEnablePush: () -> Unit,
    onDisablePush: () -> Unit,
    onLoadVoiceStatus: () -> Unit,
    onRequestMic: () -> Unit,
    onStartEnrollment: () -> Unit,
    onStartRecording: () -> Unit,
    onStopAndUpload: () -> Unit,
    onCreateVoiceProfile: () -> Unit,
    innerPadding: PaddingValues,
    modifier: Modifier = Modifier,
) {
    PorizoScreen(
        modifier = modifier
            .fillMaxSize()
            .padding(innerPadding),
        title = "Settings",
        subtitle = "Account, subscription, voice, and notifications.",
    ) {
        AccountSection(
            isAuthenticated = isAuthenticated,
            authenticatedUserId = authenticatedUserId,
            onSignInRequested = onSignInRequested,
            onLogoutRequested = onLogoutRequested,
        )
        BillingSection(
            state = state,
            onLoadBilling = onLoadBilling,
            onSelectProduct = onSelectProduct,
            onLaunchPurchase = onLaunchPurchase,
            onRefreshPurchases = onRefreshPurchases,
            onSyncReceipt = onSyncReceipt,
        )
        PushSection(
            state = state,
            onEnablePush = onEnablePush,
            onDisablePush = onDisablePush,
        )
        VoiceSection(
            state = state,
            onLoadVoiceStatus = onLoadVoiceStatus,
            onRequestMic = onRequestMic,
            onStartEnrollment = onStartEnrollment,
            onStartRecording = onStartRecording,
            onStopAndUpload = onStopAndUpload,
            onCreateVoiceProfile = onCreateVoiceProfile,
        )
    }
}

@Composable
private fun AccountSection(
    isAuthenticated: Boolean,
    authenticatedUserId: String?,
    onSignInRequested: () -> Unit,
    onLogoutRequested: () -> Unit,
) {
    PorizoCard {
        SectionTitle("Account")
        Text(
            text = if (isAuthenticated && !authenticatedUserId.isNullOrBlank()) {
                "Signed in as $authenticatedUserId"
            } else if (isAuthenticated) {
                "Signed in"
            } else {
                "Signed out"
            },
            color = PorizoColors.TextSecondary,
            style = MaterialTheme.typography.bodyMedium,
        )
        if (!isAuthenticated) {
            PorizoPrimaryButton(
                text = "Sign in",
                onClick = onSignInRequested,
                icon = Icons.Filled.Person,
            )
        } else {
            PorizoSecondaryButton(
                text = "Sign out",
                onClick = onLogoutRequested,
            )
        }
    }
}

@Composable
private fun BillingSection(
    state: SettingsUiState,
    onLoadBilling: () -> Unit,
    onSelectProduct: (String) -> Unit,
    onLaunchPurchase: () -> Unit,
    onRefreshPurchases: () -> Unit,
    onSyncReceipt: () -> Unit,
) {
    val productChoices = billingProductChoices(state)
    PorizoCard {
        SectionTitle("Subscription")
        state.entitlements?.let { entitlements ->
            SettingLine("Song credits", "${entitlements.availableSongCredits ?: entitlements.songsRemaining ?: 0}")
            SettingLine("Poem credits", "${entitlements.poemsRemaining ?: 0}")
            SettingLine("Tier", entitlements.tier ?: "Free")
        }
        state.subscriptionStatus?.subscription?.let { subscription ->
            SettingLine("Status", subscription.status ?: "Unknown")
            subscription.productId?.let { SettingLine("Product", it) }
        }
        PorizoPrimaryButton(
            text = "Load billing",
            onClick = onLoadBilling,
            enabled = !state.isBillingWorking,
            icon = Icons.Filled.Refresh,
        )
        ProductChoices(
            products = state.loadedProducts,
            plans = state.plans,
            productChoices = productChoices,
            selectedProductId = state.selectedProductId,
            onSelectProduct = onSelectProduct,
        )
        PorizoSecondaryButton(
            text = "Open purchase sheet",
            onClick = onLaunchPurchase,
            enabled = !state.isBillingWorking && state.selectedProductId.isNotBlank(),
            icon = Icons.Filled.ShoppingCart,
        )
        PorizoSecondaryButton(
            text = "Refresh purchases",
            onClick = onRefreshPurchases,
            enabled = !state.isBillingWorking,
            icon = Icons.Filled.Refresh,
        )
        PorizoSecondaryButton(
            text = "Sync receipt",
            onClick = onSyncReceipt,
            enabled = !state.isBillingWorking && state.purchaseToken.isNotBlank() && state.selectedProductId.isNotBlank(),
            icon = Icons.Filled.CheckCircle,
        )
        StatusText(state.billingStatus)
    }
}

@Composable
private fun ProductChoices(
    products: List<PlayProductSummary>,
    plans: List<SubscriptionPlan>,
    productChoices: List<String>,
    selectedProductId: String,
    onSelectProduct: (String) -> Unit,
) {
    if (productChoices.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        productChoices.take(6).forEach { productId ->
            val product = products.firstOrNull { it.id == productId }
            val plan = plans.firstOrNull { productId in it.googleSubscriptionProductIds }
            val label = product?.title ?: plan?.name ?: productId
            val detail = product?.let { "${it.productType} • ${it.price}" }
                ?: plan?.let { "${it.songsPerMonth} songs • ${it.poemsPerMonth} poems" }
                ?: productId
            PorizoSecondaryButton(
                text = if (productId == selectedProductId) "$label selected" else label,
                onClick = { onSelectProduct(productId) },
            )
            Text(
                text = detail,
                color = PorizoColors.TextTertiary,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun PushSection(
    state: SettingsUiState,
    onEnablePush: () -> Unit,
    onDisablePush: () -> Unit,
) {
    PorizoCard {
        SectionTitle("Notifications")
        if (state.pushSubscriptionId.isNotBlank()) {
            SettingLine("Subscription", state.pushSubscriptionId)
        }
        if (state.pushToken.isNotBlank()) {
            SettingLine("Token", state.pushToken.take(18) + "...")
        }
        PorizoPrimaryButton(
            text = "Enable push",
            onClick = onEnablePush,
            enabled = !state.isPushWorking,
            icon = Icons.Filled.Notifications,
        )
        PorizoSecondaryButton(
            text = "Disable push",
            onClick = onDisablePush,
            enabled = !state.isPushWorking,
            icon = Icons.Filled.NotificationsOff,
        )
        StatusText(state.pushStatus)
    }
}

@Composable
private fun VoiceSection(
    state: SettingsUiState,
    onLoadVoiceStatus: () -> Unit,
    onRequestMic: () -> Unit,
    onStartEnrollment: () -> Unit,
    onStartRecording: () -> Unit,
    onStopAndUpload: () -> Unit,
    onCreateVoiceProfile: () -> Unit,
) {
    PorizoCard {
        SectionTitle("Voice")
        state.voiceProfileStatus?.let { status ->
            SettingLine("Profile", status.profileId ?: "Not created")
            SettingLine("Ready", if (status.myVoiceReady == true) "Yes" else "No")
            status.qualityTier?.let { SettingLine("Quality", it) }
        }
        PorizoPrimaryButton(
            text = "Load voice status",
            onClick = onLoadVoiceStatus,
            enabled = !state.isVoiceWorking,
            icon = Icons.Filled.Refresh,
        )
        if (state.voiceEnrollmentEnabled) {
            state.enrollmentPrompt?.let { prompt ->
                FrauncesTitle(text = "Read this", sizeSp = 22)
                Text(
                    text = prompt,
                    color = PorizoColors.TextSecondary,
                    style = MaterialTheme.typography.bodyLarge,
                )
            }
            PorizoSecondaryButton(
                text = "Allow microphone",
                onClick = onRequestMic,
                enabled = !state.isVoiceWorking,
            )
            PorizoSecondaryButton(
                text = "Start enrollment",
                onClick = onStartEnrollment,
                enabled = !state.isVoiceWorking,
            )
            PorizoSecondaryButton(
                text = "Record",
                onClick = onStartRecording,
                enabled = !state.isVoiceWorking,
            )
            PorizoSecondaryButton(
                text = "Stop and upload",
                onClick = onStopAndUpload,
                enabled = !state.isVoiceWorking,
            )
            PorizoSecondaryButton(
                text = "Create voice",
                onClick = onCreateVoiceProfile,
                enabled = !state.isVoiceWorking && state.activeEnrollmentId != null,
            )
        } else {
            Text(
                text = "My Voice is coming soon. AI voices and instrumental previews are available now.",
                color = PorizoColors.TextSecondary,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        StatusText(state.voiceStatus)
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text = text,
        color = PorizoColors.TextPrimary,
        fontWeight = FontWeight.SemiBold,
        style = MaterialTheme.typography.titleMedium,
    )
}

@Composable
private fun SettingLine(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            text = label,
            color = PorizoColors.TextSecondary,
            style = MaterialTheme.typography.bodyMedium,
        )
        Text(
            text = value,
            color = PorizoColors.TextPrimary,
            fontWeight = FontWeight.SemiBold,
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

@Composable
private fun StatusText(text: String) {
    Text(
        text = text,
        color = PorizoColors.TextTertiary,
        style = MaterialTheme.typography.bodySmall,
    )
}

internal fun billingProductChoices(state: SettingsUiState): List<String> =
    (
        state.loadedProducts
            .filter { it.productType == GOOGLE_SUBSCRIPTION_PRODUCT_TYPE }
            .map { it.id } +
            state.plans.flatMap { it.googleSubscriptionProductIds }
        )
        .filter { it.isNotBlank() }
        .distinct()
        .sorted()

private const val GOOGLE_SUBSCRIPTION_PRODUCT_TYPE = "subs"
