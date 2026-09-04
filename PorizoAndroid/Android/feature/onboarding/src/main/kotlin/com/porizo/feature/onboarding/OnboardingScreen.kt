package com.porizo.feature.onboarding

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.porizo.core.model.OnboardingNodeType
import com.porizo.core.model.OnboardingOption
import com.porizo.core.ui.Fraunces
import com.porizo.core.ui.PorizoColors
import com.porizo.core.ui.PorizoRadius
import kotlinx.coroutines.delay

@Composable
fun OnboardingScreen(
    viewModel: OnboardingViewModel,
    onComplete: (OnboardingResult) -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.uiState.collectAsState()

    LaunchedEffect(state.stage) {
        when (state.stage) {
            OnboardingStage.Splash -> {
                delay(4_000)
                viewModel.advanceSplash()
            }
            OnboardingStage.Processing -> {
                delay(1_500)
                viewModel.showPayoff()
            }
            OnboardingStage.Mirror,
            OnboardingStage.Questionnaire,
            OnboardingStage.Payoff -> Unit
        }
    }

    OnboardingScreen(
        state = state,
        onAdvanceSplash = viewModel::advanceSplash,
        onAdvanceMirror = viewModel::advanceMirror,
        onAnswerSingle = viewModel::answerSingle,
        onToggleMulti = viewModel::toggleMulti,
        onAnswerMultiple = viewModel::answerMultiple,
        onDraftChange = viewModel::updateDraft,
        onAnswerText = viewModel::answerText,
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
    onToggleMulti: (String) -> Unit,
    onAnswerMultiple: () -> Unit,
    onDraftChange: (String) -> Unit,
    onAnswerText: () -> Unit,
    onComplete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    when (state.stage) {
        OnboardingStage.Splash -> LivingSplashScreen(
            onAdvance = onAdvanceSplash,
            modifier = modifier,
        )
        OnboardingStage.Mirror -> MirrorScreen(
            onContinue = onAdvanceMirror,
            modifier = modifier,
        )
        OnboardingStage.Processing -> ProcessingScreen(
            recipientName = state.recipientName,
            modifier = modifier,
        )
        OnboardingStage.Payoff -> PayoffScreen(
            recipientName = state.recipientName,
            suggestion = state.suggestion,
            onCreate = onComplete,
            onSkip = onComplete,
            modifier = modifier,
        )
        OnboardingStage.Questionnaire -> QuestionnaireScreen(
            state = state,
            onAnswerSingle = onAnswerSingle,
            onToggleMulti = onToggleMulti,
            onAnswerMultiple = onAnswerMultiple,
            onDraftChange = onDraftChange,
            onAnswerText = onAnswerText,
            modifier = modifier,
        )
    }
}

@Composable
private fun LivingSplashScreen(
    onAdvance: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val interaction = remember { MutableInteractionSource() }
    val pulse by rememberInfiniteTransition(label = "onboarding-wave").animateFloat(
        initialValue = 0.82f,
        targetValue = 1.08f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1_500),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "waveform-pulse",
    )

    OnboardingShell(
        modifier = modifier.clickable(
            interactionSource = interaction,
            indication = null,
            role = Role.Button,
            onClick = onAdvance,
        ),
        bottom = {
            Text(
                text = "Tap anywhere to continue",
                color = PorizoColors.TextTertiary,
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        },
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(200.dp)
                    .clip(RoundedCornerShape(PorizoRadius.Overlay.dp))
                    .background(
                        Brush.linearGradient(
                            colors = listOf(PorizoColors.Accent, PorizoColors.AccentEnd),
                        ),
                    )
                    .semantics {
                        contentDescription = "A personal song preview for Mom"
                    },
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    MiniCoverMark()
                    Text(
                        text = "For Mom",
                        color = Color.White,
                        fontFamily = Fraunces,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 22.sp,
                    )
                    Text(
                        text = "Summer at the Lake",
                        color = Color.White.copy(alpha = 0.7f),
                        style = MaterialTheme.typography.labelLarge,
                    )
                    WaveformBars(scale = pulse)
                }
            }

            Text(
                text = "Remember when the water was too cold but we jumped in anyway...",
                color = PorizoColors.TextSecondary,
                fontFamily = Fraunces,
                fontSize = 16.sp,
                fontStyle = FontStyle.Italic,
                textAlign = TextAlign.Center,
                lineHeight = 22.sp,
                modifier = Modifier.padding(horizontal = 32.dp),
            )
        }
    }
}

@Composable
private fun MirrorScreen(
    onContinue: () -> Unit,
    modifier: Modifier = Modifier,
) {
    OnboardingShell(
        modifier = modifier,
        bottom = {
            OnboardingCtaButton(
                text = "Continue",
                onClick = onContinue,
                modifier = Modifier.semantics { contentDescription = "Continue onboarding" },
            )
        },
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp),
            modifier = Modifier.padding(horizontal = 20.dp),
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                MirrorLine("Think about the last birthday you celebrated.")
                MirrorLine("Did you send a text? Flowers? A gift card?")
                MirrorLine("Do you still remember what you sent?")
            }

            ScreenTitle(
                text = "Most gifts fade. A song stays.",
                sizeSp = 24,
            )
        }
    }
}

@Composable
private fun QuestionnaireScreen(
    state: OnboardingUiState,
    onAnswerSingle: (String) -> Unit,
    onToggleMulti: (String) -> Unit,
    onAnswerMultiple: () -> Unit,
    onDraftChange: (String) -> Unit,
    onAnswerText: () -> Unit,
    modifier: Modifier = Modifier,
) {
    when (state.node.type) {
        OnboardingNodeType.MultiSelect -> PainPointsScreen(
            question = state.question,
            subtitle = state.node.subtitle ?: "Pick all that apply.",
            options = state.node.options,
            selectedValues = state.selectedValues,
            minSelections = state.node.minSelections,
            onToggle = onToggleMulti,
            onContinue = onAnswerMultiple,
            modifier = modifier,
        )
        OnboardingNodeType.SingleSelect -> when (state.currentNodeId) {
            "relationship_picker" -> RecipientPickerScreen(
                options = state.node.options,
                onSelect = onAnswerSingle,
                modifier = modifier,
            )
            else -> AdaptiveSelectScreen(
                state = state,
                onSelect = onAnswerSingle,
                modifier = modifier,
            )
        }
        OnboardingNodeType.SingleSelectOrText -> AdaptiveSelectScreen(
            state = state,
            onSelect = onAnswerSingle,
            modifier = modifier,
        )
        OnboardingNodeType.TextInput -> RecipientNameScreen(
            question = state.question,
            value = state.draftText,
            onValueChange = onDraftChange,
            onContinue = onAnswerText,
            modifier = modifier,
        )
        OnboardingNodeType.Terminal -> ProcessingScreen(
            recipientName = state.recipientName,
            modifier = modifier,
        )
    }
}

@Composable
private fun PainPointsScreen(
    question: String,
    subtitle: String,
    options: List<OnboardingOption>,
    selectedValues: Set<String>,
    minSelections: Int,
    onToggle: (String) -> Unit,
    onContinue: () -> Unit,
    modifier: Modifier = Modifier,
) {
    OnboardingShell(
        modifier = modifier,
        bottom = {
            OnboardingCtaButton(
                text = "Continue",
                enabled = selectedValues.size >= minSelections,
                onClick = onContinue,
            )
        },
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            ScreenTitle(question)
            Text(
                text = subtitle,
                color = PorizoColors.TextSecondary,
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
            )
            Column(
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                options.forEach { option ->
                    SelectableChip(
                        label = option.label,
                        selected = option.value in selectedValues,
                        onClick = { onToggle(option.value) },
                    )
                }
            }
        }
    }
}

@Composable
private fun RecipientPickerScreen(
    options: List<OnboardingOption>,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    OnboardingShell(modifier = modifier) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            ScreenTitle("Who deserves something\nunforgettable?")
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                options.chunked(2).forEach { row ->
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        row.forEach { option ->
                            RelationshipTile(
                                option = option,
                                onClick = { onSelect(option.value) },
                                modifier = Modifier.weight(1f),
                            )
                        }
                        if (row.size == 1) {
                            Spacer(Modifier.weight(1f))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RecipientNameScreen(
    question: String,
    value: String,
    onValueChange: (String) -> Unit,
    onContinue: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val trimmed = value.trim()
    OnboardingShell(
        modifier = modifier,
        bottom = {
            OnboardingCtaButton(
                text = "Continue",
                enabled = trimmed.length >= 2,
                onClick = onContinue,
            )
        },
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            ScreenTitle(question)
            OutlinedTextField(
                value = value,
                onValueChange = onValueChange,
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                label = { Text("Their name") },
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = PorizoColors.TextPrimary),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { onContinue() }),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = PorizoColors.Surface,
                    unfocusedContainerColor = PorizoColors.Surface,
                    focusedIndicatorColor = PorizoColors.Accent,
                    unfocusedIndicatorColor = PorizoColors.Border,
                    focusedLabelColor = PorizoColors.AccentDark,
                    cursorColor = PorizoColors.Accent,
                ),
                shape = RoundedCornerShape(PorizoRadius.Medium.dp),
            )
        }
    }
}

@Composable
private fun AdaptiveSelectScreen(
    state: OnboardingUiState,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var selectedValue by remember(state.currentNodeId) { mutableStateOf<String?>(null) }
    var showFreeText by remember(state.currentNodeId) { mutableStateOf(false) }
    var freeText by remember(state.currentNodeId) { mutableStateOf("") }

    LaunchedEffect(selectedValue) {
        val value = selectedValue ?: return@LaunchedEffect
        delay(300)
        onSelect(value)
    }

    OnboardingShell(
        modifier = modifier,
        bottom = {
            if (showFreeText) {
                OnboardingCtaButton(
                    text = "Continue",
                    enabled = freeText.trim().length >= 2,
                    onClick = { onSelect(freeText.trim()) },
                )
            }
        },
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            ScreenTitle(state.question)
            state.supportingText?.let {
                Text(
                    text = it,
                    color = PorizoColors.TextSecondary,
                    style = MaterialTheme.typography.bodyLarge,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 8.dp),
                )
            }
            Column(
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                state.node.options.forEach { option ->
                    SelectableChip(
                        label = option.label,
                        selected = selectedValue == option.value && !showFreeText,
                        onClick = {
                            showFreeText = false
                            selectedValue = option.value
                        },
                    )
                }
                if (state.node.allowFreeText) {
                    SelectableChip(
                        label = "Write your own",
                        selected = showFreeText,
                        onClick = {
                            selectedValue = null
                            showFreeText = true
                        },
                    )
                    if (showFreeText) {
                        OutlinedTextField(
                            value = freeText,
                            onValueChange = { freeText = it },
                            modifier = Modifier.fillMaxWidth(),
                            minLines = 3,
                            maxLines = 5,
                            label = { Text("Type your message") },
                            colors = TextFieldDefaults.colors(
                                focusedContainerColor = PorizoColors.Surface,
                                unfocusedContainerColor = PorizoColors.Surface,
                                focusedIndicatorColor = PorizoColors.Accent,
                                unfocusedIndicatorColor = PorizoColors.Border,
                                focusedLabelColor = PorizoColors.AccentDark,
                                cursorColor = PorizoColors.Accent,
                            ),
                            shape = RoundedCornerShape(PorizoRadius.Medium.dp),
                        )
                    }
                }
                if (state.currentNodeId == "occasion_picker") {
                    TextButton(
                        onClick = { onSelect("just_because") },
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 52.dp),
                    ) {
                        Text(
                            text = "Continue",
                            color = PorizoColors.TextSecondary,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ProcessingScreen(
    recipientName: String?,
    modifier: Modifier = Modifier,
) {
    val pulse by rememberInfiniteTransition(label = "processing").animateFloat(
        initialValue = 0.45f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1_000),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "processing-alpha",
    )
    OnboardingShell(modifier = modifier) {
        Text(
            text = "Finding something special for ${recipientName?.takeIf { it.isNotBlank() } ?: "them"}...",
            color = PorizoColors.TextPrimary,
            fontFamily = Fraunces,
            fontSize = 20.sp,
            lineHeight = 26.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .alpha(pulse)
                .semantics { heading() },
        )
    }
}

@Composable
private fun PayoffScreen(
    recipientName: String?,
    suggestion: OnboardingSuggestion?,
    onCreate: () -> Unit,
    onSkip: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val resolvedRecipient = recipientName?.takeIf { it.isNotBlank() } ?: "someone special"
    OnboardingShell(
        modifier = modifier,
        bottom = {
            Column(
                verticalArrangement = Arrangement.spacedBy(12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.fillMaxWidth(),
            ) {
                OnboardingCtaButton(
                    text = "Make This Song - Free",
                    onClick = onCreate,
                    icon = true,
                )
                TextButton(onClick = onSkip) {
                    Text(
                        text = "Maybe later",
                        color = PorizoColors.TextSecondary,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }
        },
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            ScreenTitle("Your first song is free\nfor $resolvedRecipient")
            if (suggestion == null) {
                SuggestionSkeleton()
                CircularProgressIndicator(color = PorizoColors.Accent, strokeWidth = 2.dp)
            } else {
                SuggestionCard(suggestion)
            }
        }
    }
}

@Composable
private fun OnboardingShell(
    modifier: Modifier = Modifier,
    bottom: @Composable () -> Unit = {},
    content: @Composable () -> Unit,
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(PorizoColors.Background)
            .windowInsetsPadding(WindowInsets.statusBars)
            .windowInsetsPadding(WindowInsets.navigationBars),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp, vertical = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                content()
            }
            Spacer(Modifier.height(24.dp))
            bottom()
        }
    }
}

@Composable
private fun ScreenTitle(
    text: String,
    sizeSp: Int = 28,
) {
    Text(
        text = text,
        color = PorizoColors.TextPrimary,
        fontFamily = Fraunces,
        fontWeight = FontWeight.Bold,
        fontSize = sizeSp.sp,
        lineHeight = (sizeSp + 5).sp,
        textAlign = TextAlign.Center,
        modifier = Modifier.semantics { heading() },
    )
}

@Composable
private fun MirrorLine(text: String) {
    Text(
        text = text,
        color = PorizoColors.TextSecondary,
        style = MaterialTheme.typography.bodyLarge,
        textAlign = TextAlign.Center,
        lineHeight = 23.sp,
    )
}

@Composable
private fun OnboardingCtaButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: Boolean = false,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = PorizoColors.Accent,
            contentColor = Color.White,
            disabledContainerColor = PorizoColors.Accent.copy(alpha = 0.42f),
            disabledContentColor = Color.White.copy(alpha = 0.82f),
        ),
        shape = RoundedCornerShape(PorizoRadius.Cta.dp),
    ) {
        if (icon) {
            androidx.compose.material3.Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(8.dp))
        }
        Text(text = text, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun SelectableChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(PorizoRadius.Chip.dp)
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .semantics {
                this.selected = selected
                contentDescription = label
            }
            .clip(shape)
            .clickable(role = Role.Button, onClick = onClick),
        shape = shape,
        color = if (selected) PorizoColors.Accent else PorizoColors.Surface,
        border = BorderStroke(
            width = if (selected) 1.5.dp else 1.dp,
            color = if (selected) PorizoColors.Accent.copy(alpha = 0.7f) else PorizoColors.Border,
        ),
        shadowElevation = if (selected) 3.dp else 1.dp,
    ) {
        Text(
            text = label,
            color = if (selected) Color.White else PorizoColors.TextPrimary,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 13.dp),
        )
    }
}

@Composable
private fun RelationshipTile(
    option: OnboardingOption,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier
            .heightIn(min = 94.dp)
            .clip(RoundedCornerShape(PorizoRadius.Chip.dp))
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = option.label },
        shape = RoundedCornerShape(PorizoRadius.Chip.dp),
        color = PorizoColors.Surface,
        border = BorderStroke(1.dp, PorizoColors.Border),
        shadowElevation = 1.dp,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            modifier = Modifier.padding(vertical = 14.dp, horizontal = 10.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(34.dp)
                    .clip(CircleShape)
                    .background(PorizoColors.SurfaceMuted),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = option.label.firstOrNull()?.uppercase() ?: "?",
                    color = PorizoColors.AccentDark,
                    fontWeight = FontWeight.Bold,
                )
            }
            Spacer(Modifier.height(8.dp))
            Text(
                text = option.label,
                color = PorizoColors.TextPrimary,
                style = MaterialTheme.typography.labelLarge,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun SuggestionCard(suggestion: OnboardingSuggestion) {
    Column(
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(PorizoRadius.Medium.dp))
            .background(PorizoColors.Surface)
            .border(1.dp, PorizoColors.Border, RoundedCornerShape(PorizoRadius.Medium.dp))
            .padding(16.dp)
            .semantics {
                contentDescription = "Song suggestion. ${suggestion.title}. ${suggestion.emotionalAngle}. ${suggestion.previewLine}"
            },
    ) {
        Text(
            text = suggestion.previewLine,
            color = PorizoColors.TextPrimary,
            fontFamily = Fraunces,
            fontSize = 18.sp,
            lineHeight = 24.sp,
            fontStyle = FontStyle.Italic,
        )
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .clip(RoundedCornerShape(PorizoRadius.Medium.dp))
                    .background(
                        Brush.linearGradient(
                            colors = listOf(PorizoColors.Accent, PorizoColors.AccentEnd),
                        ),
                    ),
                contentAlignment = Alignment.Center,
            ) {
                MiniCoverMark(size = 22)
            }
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = suggestion.title,
                    color = PorizoColors.TextSecondary,
                    style = MaterialTheme.typography.labelLarge,
                )
                Text(
                    text = suggestion.emotionalAngle,
                    color = PorizoColors.TextSecondary,
                    style = MaterialTheme.typography.bodyMedium,
                    lineHeight = 19.sp,
                )
            }
        }
    }
}

@Composable
private fun SuggestionSkeleton() {
    Column(
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(PorizoRadius.Medium.dp))
            .background(PorizoColors.Surface)
            .border(1.dp, PorizoColors.Border, RoundedCornerShape(PorizoRadius.Medium.dp))
            .padding(16.dp),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(14.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(PorizoColors.SurfaceMuted),
        )
        Box(
            modifier = Modifier
                .fillMaxWidth(0.72f)
                .height(14.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(PorizoColors.SurfaceMuted),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .clip(RoundedCornerShape(PorizoRadius.Medium.dp))
                    .background(PorizoColors.SurfaceMuted),
            )
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(
                    modifier = Modifier
                        .width(140.dp)
                        .height(12.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(PorizoColors.SurfaceMuted),
                )
                Box(
                    modifier = Modifier
                        .width(190.dp)
                        .height(12.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(PorizoColors.SurfaceMuted),
                )
            }
        }
    }
}

@Composable
private fun WaveformBars(scale: Float) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        listOf(6, 12, 18, 24, 18, 12, 6).forEachIndexed { index, height ->
            Box(
                modifier = Modifier
                    .width(3.dp)
                    .height((height * if (index % 2 == 0) 1f else scale).dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Color.White.copy(alpha = 0.72f)),
            )
        }
    }
}

@Composable
private fun MiniCoverMark(size: Int = 32) {
    Box(
        modifier = Modifier
            .size(size.dp)
            .clip(CircleShape)
            .border(2.dp, Color.White.copy(alpha = 0.55f), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .size((size / 3).dp)
                .clip(CircleShape)
                .background(Color.White.copy(alpha = 0.55f)),
        )
    }
}
