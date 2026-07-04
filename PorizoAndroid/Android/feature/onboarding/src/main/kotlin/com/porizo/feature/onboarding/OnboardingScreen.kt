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
import kotlinx.coroutines.delay

@Composable
fun OnboardingScreen(
    viewModel: OnboardingViewModel,
    onComplete: (OnboardingResult) -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.uiState.collectAsState()
    LaunchedEffect(state.stage) {
        if (state.stage == OnboardingStage.Processing) {
            delay(1_500)
            viewModel.showPayoff()
        }
    }

    OnboardingScreen(
        state = state,
        onAdvanceSplash = viewModel::advanceSplash,
        onAdvanceMirror = viewModel::advanceMirror,
        onAnswerSingle = viewModel::answerSingle,
        onDraftChange = viewModel::updateDraft,
        onAnswerText = viewModel::answerText,
        onBack = viewModel::back,
        onSkip = viewModel::skip,
        onComplete = { onComplete(viewModel.completeResult()) },
        modifier = modifier,
    )
}

@Composable
fun OnboardingScreen(
    state: OnboardingUiState,
    onAdvanceSplash: () -> Unit,
    onAdvanceMirror: () -> Unit,
    onAnswerSingle: (String) -> Unit,
    onDraftChange: (String) -> Unit,
    onAnswerText: () -> Unit,
    onBack: () -> Unit,
    onSkip: () -> Unit,
    onComplete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    PorizoScreen(
        modifier = modifier,
        title = "Porizo",
        subtitle = when (state.stage) {
            OnboardingStage.Splash -> "Hear the kind of gift a text message cannot carry."
            OnboardingStage.Mirror -> "Start with the person, not a blank page."
            OnboardingStage.Questionnaire -> "A few answers help shape the first gift."
            OnboardingStage.Processing -> "Finding the strongest first idea."
            OnboardingStage.Payoff -> "Your first gift is ready to shape."
        },
    ) {
        when (state.stage) {
            OnboardingStage.Splash -> {
                PorizoCard {
                    Text(
                        text = "A private song, built around one real detail.",
                        color = PorizoColors.TextPrimary,
                        style = MaterialTheme.typography.headlineSmall,
                    )
                    Text(
                        text = "Porizo turns a name, a memory, and the reason you care into something they can replay.",
                        color = PorizoColors.TextSecondary,
                        style = MaterialTheme.typography.bodyLarge,
                    )
                    PorizoPrimaryButton(text = "Continue", onClick = onAdvanceSplash)
                }
                return@PorizoScreen
            }
            OnboardingStage.Mirror -> {
                PorizoCard {
                    Text(
                        text = "Who is this really for?",
                        color = PorizoColors.TextPrimary,
                        style = MaterialTheme.typography.headlineSmall,
                    )
                    Text(
                        text = "We will ask a few focused questions, then suggest a starting point you can use immediately.",
                        color = PorizoColors.TextSecondary,
                        style = MaterialTheme.typography.bodyLarge,
                    )
                    PorizoPrimaryButton(text = "Start", onClick = onAdvanceMirror)
                    PorizoSecondaryButton(text = "Skip", onClick = onSkip)
                }
                return@PorizoScreen
            }
            OnboardingStage.Processing -> {
                PorizoCard {
                    Text(
                        text = "Finding something special for ${state.recipientName ?: "them"}...",
                        color = PorizoColors.TextPrimary,
                        style = MaterialTheme.typography.headlineSmall,
                    )
                }
                return@PorizoScreen
            }
            OnboardingStage.Payoff -> {
                PorizoCard {
                    Text(
                        text = state.suggestion?.title ?: "A personal first gift",
                        color = PorizoColors.TextPrimary,
                        style = MaterialTheme.typography.headlineSmall,
                    )
                    Text(
                        text = state.suggestion?.detail ?: "Start from the details you shared and refine from there.",
                        color = PorizoColors.TextSecondary,
                        style = MaterialTheme.typography.bodyLarge,
                    )
                    PorizoPrimaryButton(text = "Create this", onClick = onComplete)
                    PorizoSecondaryButton(text = "Skip for now", onClick = onComplete)
                }
                return@PorizoScreen
            }
            OnboardingStage.Questionnaire -> Unit
        }

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
