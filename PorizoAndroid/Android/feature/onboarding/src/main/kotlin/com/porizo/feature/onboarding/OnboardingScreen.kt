package com.porizo.feature.onboarding

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.porizo.core.model.OnboardingNodeType
import com.porizo.core.ui.PorizoCard
import com.porizo.core.ui.PorizoColors
import com.porizo.core.ui.PorizoPrimaryButton
import com.porizo.core.ui.PorizoScreen
import com.porizo.core.ui.PorizoSecondaryButton
import com.porizo.core.ui.PorizoTextField

@Composable
fun OnboardingScreen(
    viewModel: OnboardingViewModel,
    onComplete: (String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.uiState.collectAsState()
    LaunchedEffect(state.isComplete) {
        if (state.isComplete) {
            onComplete(state.recipientName)
        }
    }

    OnboardingScreen(
        state = state,
        onAnswerSingle = viewModel::answerSingle,
        onDraftChange = viewModel::updateDraft,
        onAnswerText = viewModel::answerText,
        onBack = viewModel::back,
        onSkip = viewModel::skip,
        modifier = modifier,
    )
}

@Composable
fun OnboardingScreen(
    state: OnboardingUiState,
    onAnswerSingle: (String) -> Unit,
    onDraftChange: (String) -> Unit,
    onAnswerText: () -> Unit,
    onBack: () -> Unit,
    onSkip: () -> Unit,
    modifier: Modifier = Modifier,
) {
    PorizoScreen(
        modifier = modifier,
        title = "Porizo",
        subtitle = "A few answers help shape the first gift.",
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (state.canGoBack) {
                TextButton(onClick = onBack) {
                    Text("Back", color = PorizoColors.TextSecondary)
                }
            } else {
                Text("")
            }
            TextButton(onClick = onSkip) {
                Text("Skip", color = PorizoColors.TextTertiary)
            }
        }

        PorizoCard {
            Text(
                text = state.question,
                color = PorizoColors.TextPrimary,
                style = MaterialTheme.typography.headlineSmall,
            )
            when (state.node.type) {
                OnboardingNodeType.SingleSelect,
                OnboardingNodeType.MultiSelect -> {
                    state.node.options.forEach { option ->
                        PorizoSecondaryButton(
                            text = option.label,
                            onClick = { onAnswerSingle(option.value) },
                            icon = Icons.AutoMirrored.Filled.ArrowForward,
                        )
                    }
                }
                OnboardingNodeType.TextInput -> {
                    PorizoTextField(
                        value = state.draftText,
                        onValueChange = onDraftChange,
                        label = "Their name",
                    )
                    PorizoPrimaryButton(
                        text = "Continue",
                        onClick = onAnswerText,
                        icon = Icons.AutoMirrored.Filled.ArrowForward,
                    )
                }
                OnboardingNodeType.Terminal -> Unit
            }
        }
    }
}
