const { generateText, isAvailable } = require("../../../services/llm-provider");
const { parseJsonResponse } = require("../reasoner");
const { buildBudgetedPrompt } = require("./budgeter");
const {
  buildQuestionComposeProjection,
  buildConfirmComposeProjection,
} = require("./projections");

const COMPOSE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    question: { type: "string" },
    confirmation: { type: "string" },
  },
};

function buildQuestionComposePrompt({ projection }) {
  return buildBudgetedPrompt({
    stage: "question_compose",
    blocks: [
      {
        id: "system",
        required: true,
        text: [
          "You phrase one grounded follow-up question for a story interview.",
          "You do not change the target. You do not ask about a different topic.",
          "Return JSON only with a `question` field.",
        ].join(" "),
      },
      {
        id: "target",
        required: true,
        text: `Target:\n${JSON.stringify(projection, null, 2)}`,
      },
      {
        id: "rules",
        required: true,
        text: [
          "Rules:",
          "- Ask one specific question under 32 words.",
          "- Prefer concrete detail over generic reflection.",
          "- Avoid repeating the previous question.",
          "- Stay inside the chosen targetElement and targetSlot.",
        ].join("\n"),
      },
    ],
  });
}

function buildConfirmComposePrompt({ projection }) {
  return buildBudgetedPrompt({
    stage: "confirm_compose",
    blocks: [
      {
        id: "system",
        required: true,
        text: [
          "You phrase one confirmation message for a story review step.",
          "Return JSON only with a `confirmation` field.",
        ].join(" "),
      },
      {
        id: "state",
        required: true,
        text: `Review snapshot:\n${JSON.stringify(projection, null, 2)}`,
      },
      {
        id: "rules",
        required: true,
        text: [
          "Rules:",
          "- Be concise and grounded in the story state.",
          "- Do not ask for new details.",
          "- Invite the user to lock the story for lyrics.",
        ].join("\n"),
      },
    ],
  });
}

async function composeTurn({
  state,
  decision,
  gapAnalysis,
  gapQuestion,
  previousQuestion,
  fallbackQuestion,
  fallbackConfirmation,
  generateTextFn = generateText,
}) {
  if (!decision?.action) {
    return { success: false, error: "composeTurn requires a decision" };
  }
  if (generateTextFn === generateText && !isAvailable()) {
    return {
      success: true,
      data: decision.action === "CONFIRM"
        ? { confirmation: fallbackConfirmation || null }
        : { question: fallbackQuestion || null },
      stageTelemetry: null,
      fallback: true,
    };
  }

  const projection = decision.action === "CONFIRM"
    ? buildConfirmComposeProjection(state, decision, gapAnalysis)
    : buildQuestionComposeProjection(state, decision, gapAnalysis, gapQuestion, { previousQuestion });
  const budgetResult = decision.action === "CONFIRM"
    ? buildConfirmComposePrompt({ projection })
    : buildQuestionComposePrompt({ projection });

  try {
    const result = await generateTextFn({
      prompt: budgetResult.prompt,
      taskType: "story",
      temperature: 0.35,
      responseMimeType: "application/json",
      responseSchema: COMPOSE_RESPONSE_SCHEMA,
      maxOutputTokens: 250,
    });
    const parsed = parseJsonResponse(result.text || "");
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error,
        stageTelemetry: budgetResult,
      };
    }
    return {
      success: true,
      data: parsed.data,
      stageTelemetry: budgetResult,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      stageTelemetry: budgetResult,
    };
  }
}

module.exports = {
  buildQuestionComposePrompt,
  buildConfirmComposePrompt,
  composeTurn,
};
