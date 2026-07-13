package com.porizo.feature.auth

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.MailOutline
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.porizo.core.ui.FrauncesTitle
import com.porizo.core.ui.PorizoCard
import com.porizo.core.ui.PorizoColors
import com.porizo.core.ui.PorizoPrimaryButton
import com.porizo.core.ui.PorizoScreen
import com.porizo.core.ui.PorizoTextField

@Composable
fun AuthScreen(
    viewModel: AuthViewModel,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    AuthScreen(
        state = state,
        onCancel = onCancel,
        onBeginPhone = viewModel::beginPhone,
        onBeginMagic = viewModel::beginMagicLogin,
        onEmailChange = viewModel::updateEmail,
        onSendMagic = viewModel::sendMagicLink,
        onOpenMail = {
            runCatching {
                context.startActivity(Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_EMAIL))
            }
        },
        onResendMagic = viewModel::resendMagicLink,
        onChangeMagicEmail = viewModel::changeMagicLoginEmail,
        onRetryMagicStatus = viewModel::refreshMagicLoginStatus,
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
    onBeginMagic: () -> Unit,
    onEmailChange: (String) -> Unit,
    onSendMagic: () -> Unit,
    onOpenMail: () -> Unit,
    onResendMagic: () -> Unit,
    onChangeMagicEmail: () -> Unit,
    onRetryMagicStatus: () -> Unit,
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
        title = when (state.phase) {
            is AuthPhase.MagicLinkSent -> "Check your email"
            AuthPhase.MagicLinkExchanging -> "Signing you in"
            is AuthPhase.MagicLinkExpired -> "Link expired"
            AuthPhase.MagicLinkWrongDevice -> "Use the requesting device"
            is AuthPhase.MagicLinkConflict -> "Recover your account"
            is AuthPhase.MagicLinkLegacyRecovery -> "Recover your account"
            is AuthPhase.MagicLinkLocked -> "Sign-in link locked"
            else -> "Sign in"
        },
        subtitle = when (state.phase) {
            is AuthPhase.MagicLinkSent -> "Open the sign-in link on this Android device."
            else -> "Save songs, poems, claimed gifts, and voice settings across devices."
        },
    ) {
        when (val phase = state.phase) {
            AuthPhase.SignedOut -> SignInOptions(
                isWorking = state.isWorking,
                onBeginMagic = onBeginMagic,
                onRecoverLegacyAccount = onBeginPhone,
                onCancel = onCancel,
            )
            AuthPhase.MagicEmailEntry -> MagicEmailEntry(
                email = state.email,
                canSend = state.canSendMagicLink,
                onEmailChange = onEmailChange,
                onSend = onSendMagic,
                onBack = onShowOptions,
            )
            is AuthPhase.MagicLinkSent -> CheckEmail(
                email = phase.email,
                resendSecondsRemaining = phase.resendSecondsRemaining,
                isWorking = state.isWorking,
                isChecking = state.isCheckingMagicLink,
                onOpenMail = onOpenMail,
                onResend = onResendMagic,
                onChangeEmail = onChangeMagicEmail,
                onRetryStatus = onRetryMagicStatus,
            )
            AuthPhase.MagicLinkExchanging -> MagicLinkStatus("Signing you in...")
            is AuthPhase.MagicLinkExpired -> MagicLinkProblem(
                message = "The sign-in link sent to ${phase.email} has expired.",
                action = "Send a new link",
                onAction = onChangeMagicEmail,
            )
            AuthPhase.MagicLinkWrongDevice -> MagicLinkProblem(
                message = "This device does not have the private sign-in request. Open the link on the Android device that requested it.",
                action = "Use a different email",
                onAction = onChangeMagicEmail,
            )
            is AuthPhase.MagicLinkConflict -> MagicLinkProblem(
                message = "${phase.email} was previously added to an existing account. Recover that account before linking this email.",
                action = "Use a different email",
                onAction = onChangeMagicEmail,
            )
            is AuthPhase.MagicLinkLegacyRecovery -> LegacyRecovery(
                phase = phase,
                onPhone = onBeginPhone,
                onGoogle = onGoogle,
                onChangeEmail = onChangeMagicEmail,
            )
            is AuthPhase.MagicLinkLocked -> MagicLinkProblem(
                message = "The sign-in request for ${phase.email} was locked after too many attempts.",
                action = "Send a new link",
                onAction = onChangeMagicEmail,
            )
            AuthPhase.PhoneEntry -> PhoneEntry(
                phoneNumber = state.phoneNumber,
                canSend = state.canSendPhoneCode,
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

        state.pushWarningMessage?.let { message ->
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
    onBeginMagic: () -> Unit,
    onRecoverLegacyAccount: () -> Unit,
    onCancel: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        PorizoPrimaryButton(
            text = "Continue with email",
            onClick = onBeginMagic,
            enabled = !isWorking,
            icon = Icons.Filled.Email,
        )
        TextButton(
            onClick = onRecoverLegacyAccount,
            enabled = !isWorking,
        ) {
            Text("Recover an older account", color = PorizoColors.TextSecondary)
        }
        TextButton(onClick = onCancel) {
            Text("Not now", color = PorizoColors.TextSecondary)
        }
    }
}

@Composable
private fun MagicEmailEntry(
    email: String,
    canSend: Boolean,
    onEmailChange: (String) -> Unit,
    onSend: () -> Unit,
    onBack: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        PorizoTextField(value = email, onValueChange = onEmailChange, label = "Email")
        PorizoPrimaryButton(
            text = "Email me a sign-in link",
            onClick = onSend,
            enabled = canSend,
            icon = Icons.AutoMirrored.Filled.Send,
        )
        TextButton(onClick = onBack) { Text("Back", color = PorizoColors.TextSecondary) }
    }
}

@Composable
private fun MagicLinkStatus(message: String) {
    PorizoCard(modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
        Text(message, color = PorizoColors.TextSecondary, style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
private fun CheckEmail(
    email: String,
    resendSecondsRemaining: Int,
    isWorking: Boolean,
    isChecking: Boolean,
    onOpenMail: () -> Unit,
    onResend: () -> Unit,
    onChangeEmail: () -> Unit,
    onRetryStatus: () -> Unit,
) {
    Column(
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = "We sent a sign-in link to $email.",
            color = PorizoColors.TextPrimary,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.Medium,
        )
        Text(
            text = "For your security, open it on this device. If your browser confirms the email first, return to Porizo to finish signing in.",
            color = PorizoColors.TextSecondary,
            style = MaterialTheme.typography.bodyMedium,
        )
        PorizoPrimaryButton(
            text = "Open Mail",
            onClick = onOpenMail,
            enabled = !isWorking,
            icon = Icons.Filled.MailOutline,
        )
        TextButton(
            onClick = onResend,
            enabled = resendSecondsRemaining == 0 && !isWorking,
        ) {
            androidx.compose.material3.Icon(Icons.Filled.Refresh, contentDescription = null)
            Text(
                if (resendSecondsRemaining > 0) "Resend link in ${resendSecondsRemaining}s" else "Resend link",
                color = if (resendSecondsRemaining == 0 && !isWorking) {
                    PorizoColors.Accent
                } else {
                    PorizoColors.TextSecondary
                },
            )
        }
        TextButton(onClick = onChangeEmail, enabled = !isWorking) {
            Text("Use a different email", color = PorizoColors.TextSecondary)
        }
        if (isChecking) {
            Text("Checking sign-in status...", color = PorizoColors.TextSecondary)
        } else {
            TextButton(onClick = onRetryStatus, enabled = !isWorking) {
                Text("I've confirmed my email", color = PorizoColors.Accent)
            }
        }
    }
}

@Composable
private fun MagicLinkProblem(message: String, action: String, onAction: () -> Unit) {
    PorizoCard(modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
        Text(message, color = PorizoColors.TextSecondary, style = MaterialTheme.typography.bodyLarge)
        PorizoPrimaryButton(text = action, onClick = onAction)
    }
}

@Composable
private fun LegacyRecovery(
    phase: AuthPhase.MagicLinkLegacyRecovery,
    onPhone: () -> Unit,
    onGoogle: () -> Unit,
    onChangeEmail: () -> Unit,
) {
    val methods = phase.authMethods.map(String::lowercase).toSet()
    PorizoCard(modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
        Text(
            text = buildString {
                append(phase.maskedEmail ?: phase.email)
                append(" belongs to an existing Porizo account. Use its original sign-in method so your songs and purchases stay together.")
            },
            color = PorizoColors.TextSecondary,
            style = MaterialTheme.typography.bodyLarge,
        )
        if ("phone" in methods) {
            PorizoPrimaryButton(text = "Recover with phone", onClick = onPhone)
        }
        if ("google" in methods) {
            PorizoPrimaryButton(text = "Recover with Google", onClick = onGoogle)
        }
        if ("apple" in methods) {
            Text(
                "This account uses Apple sign-in. Recover it in Porizo on an iPhone, then add this email to the account.",
                color = PorizoColors.TextSecondary,
            )
        }
        TextButton(onClick = onChangeEmail) {
            Text("Use a different email", color = PorizoColors.TextSecondary)
        }
    }
}

@Composable
private fun PhoneEntry(
    phoneNumber: String,
    canSend: Boolean,
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
        Text(
            text = "Use a valid mobile number. We'll send codes in international format.",
            color = PorizoColors.TextSecondary,
            style = MaterialTheme.typography.bodyMedium,
        )
        PorizoPrimaryButton(
            text = "Send code",
            onClick = onSendCode,
            enabled = canSend,
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
