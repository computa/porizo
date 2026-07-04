package com.porizo.feature.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.porizo.core.ui.FrauncesTitle
import com.porizo.core.ui.PorizoCard
import com.porizo.core.ui.PorizoColors
import com.porizo.core.ui.PorizoPrimaryButton
import com.porizo.core.ui.PorizoScreen
import com.porizo.core.ui.PorizoSecondaryButton
import com.porizo.core.ui.PorizoTextField

@Composable
fun AuthScreen(
    viewModel: AuthViewModel,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.uiState.collectAsState()
    AuthScreen(
        state = state,
        onCancel = onCancel,
        onBeginPhone = viewModel::beginPhone,
        onShowOptions = viewModel::showOptions,
        onPhoneChange = viewModel::updatePhoneNumber,
        onCodeChange = viewModel::updateCode,
        onSendCode = viewModel::sendPhoneCode,
        onVerifyCode = viewModel::verifyPhoneCode,
        onCompleteRegistration = viewModel::completeRegistration,
        onGoogle = viewModel::signInWithGoogle,
        onConfirmGoogleLink = viewModel::confirmGoogleLink,
        modifier = modifier,
    )
}

@Composable
fun AuthScreen(
    state: AuthUiState,
    onCancel: () -> Unit,
    onBeginPhone: () -> Unit,
    onShowOptions: () -> Unit,
    onPhoneChange: (String) -> Unit,
    onCodeChange: (String) -> Unit,
    onSendCode: () -> Unit,
    onVerifyCode: () -> Unit,
    onCompleteRegistration: () -> Unit,
    onGoogle: () -> Unit,
    onConfirmGoogleLink: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    PorizoScreen(
        modifier = modifier,
        title = "Sign in",
        subtitle = "Save songs, poems, claimed gifts, and voice settings across devices.",
    ) {
        when (val phase = state.phase) {
            AuthPhase.SignedOut -> SignInOptions(
                isWorking = state.isWorking,
                onGoogle = onGoogle,
                onBeginPhone = onBeginPhone,
                onCancel = onCancel,
            )
            AuthPhase.PhoneEntry -> PhoneEntry(
                phoneNumber = state.phoneNumber,
                isWorking = state.isWorking,
                onPhoneChange = onPhoneChange,
                onSendCode = onSendCode,
                onBack = onShowOptions,
            )
            is AuthPhase.PhoneVerify -> PhoneVerify(
                phoneNumber = phase.phoneNumber,
                code = state.code,
                isWorking = state.isWorking,
                onCodeChange = onCodeChange,
                onVerifyCode = onVerifyCode,
                onBack = onBeginPhone,
            )
            is AuthPhase.ProfileCompletion -> ProfileCompletion(
                phoneNumber = phase.phoneNumber,
                isWorking = state.isWorking,
                onCompleteRegistration = onCompleteRegistration,
            )
            is AuthPhase.LinkConfirmation -> LinkConfirmation(
                idToken = phase.idToken,
                email = phase.email,
                isWorking = state.isWorking,
                onConfirm = onConfirmGoogleLink,
                onBack = onShowOptions,
            )
            is AuthPhase.Authenticated -> SignedIn(userId = phase.userId, onDone = onCancel)
        }

        if (state.isWorking) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircularProgressIndicator(color = PorizoColors.Accent)
                Text("Working...", color = PorizoColors.TextSecondary)
            }
        }

        state.errorMessage?.let { message ->
            PorizoCard {
                Text(
                    text = message,
                    color = PorizoColors.Error,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
    }
}

@Composable
private fun SignInOptions(
    isWorking: Boolean,
    onGoogle: () -> Unit,
    onBeginPhone: () -> Unit,
    onCancel: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        PorizoSecondaryButton(
            text = "Continue with Google",
            onClick = onGoogle,
            enabled = !isWorking,
            icon = Icons.Filled.VerifiedUser,
        )
        PorizoPrimaryButton(
            text = "Continue with phone",
            onClick = onBeginPhone,
            enabled = !isWorking,
            icon = Icons.Filled.Phone,
        )
        TextButton(onClick = onCancel) {
            Text("Not now", color = PorizoColors.TextSecondary)
        }
    }
}

@Composable
private fun PhoneEntry(
    phoneNumber: String,
    isWorking: Boolean,
    onPhoneChange: (String) -> Unit,
    onSendCode: () -> Unit,
    onBack: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        PorizoTextField(
            value = phoneNumber,
            onValueChange = onPhoneChange,
            label = "Phone number",
        )
        PorizoPrimaryButton(
            text = "Send code",
            onClick = onSendCode,
            enabled = !isWorking && phoneNumber.trim().isNotEmpty(),
            icon = Icons.AutoMirrored.Filled.Send,
        )
        TextButton(onClick = onBack) {
            Text("Back", color = PorizoColors.TextSecondary)
        }
    }
}

@Composable
private fun PhoneVerify(
    phoneNumber: String,
    code: String,
    isWorking: Boolean,
    onCodeChange: (String) -> Unit,
    onVerifyCode: () -> Unit,
    onBack: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            text = "Enter the code sent to $phoneNumber.",
            color = PorizoColors.TextSecondary,
            style = MaterialTheme.typography.bodyLarge,
        )
        PorizoTextField(
            value = code,
            onValueChange = onCodeChange,
            label = "Verification code",
        )
        PorizoPrimaryButton(
            text = "Verify",
            onClick = onVerifyCode,
            enabled = !isWorking && code.trim().isNotEmpty(),
            icon = Icons.Filled.CheckCircle,
        )
        TextButton(onClick = onBack) {
            Text("Change phone number", color = PorizoColors.TextSecondary)
        }
    }
}

@Composable
private fun ProfileCompletion(
    phoneNumber: String,
    isWorking: Boolean,
    onCompleteRegistration: () -> Unit,
) {
    PorizoCard {
        FrauncesTitle(text = "Create account", sizeSp = 24)
        Text(
            text = "Finish setting up the account for $phoneNumber.",
            color = PorizoColors.TextSecondary,
            style = MaterialTheme.typography.bodyLarge,
        )
        PorizoPrimaryButton(
            text = "Create account",
            onClick = onCompleteRegistration,
            enabled = !isWorking,
        )
    }
}

@Composable
private fun LinkConfirmation(
    idToken: String,
    email: String?,
    isWorking: Boolean,
    onConfirm: (String) -> Unit,
    onBack: () -> Unit,
) {
    PorizoCard {
        FrauncesTitle(text = "Link Google?", sizeSp = 24)
        Text(
            text = email?.let { "An account already exists for $it." } ?: "An account already exists.",
            color = PorizoColors.TextSecondary,
            style = MaterialTheme.typography.bodyLarge,
        )
        Text(
            text = "Confirm to link this Google account to the existing Porizo account.",
            color = PorizoColors.TextSecondary,
            style = MaterialTheme.typography.bodyMedium,
        )
        PorizoPrimaryButton(
            text = "Confirm and link",
            onClick = { onConfirm(idToken) },
            enabled = !isWorking,
            icon = Icons.Filled.Link,
        )
        TextButton(onClick = onBack) {
            Text("Back", color = PorizoColors.TextSecondary)
        }
    }
}

@Composable
private fun SignedIn(userId: String, onDone: () -> Unit) {
    PorizoCard {
        FrauncesTitle(text = "Signed in", sizeSp = 24)
        Text(
            text = "Account $userId is ready.",
            color = PorizoColors.TextSecondary,
            fontWeight = FontWeight.Medium,
        )
        PorizoPrimaryButton(text = "Done", onClick = onDone)
    }
}
