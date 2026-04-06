const { generateText, isAvailable } = require("../../../services/llm-provider");
const { parseJsonResponse } = require("../reasoner");
const { buildBudgetedPrompt } = require("./budgeter");
const { buildIngestProjection } = require("./projections");
const { createTurnDelta } = require("./types");

const INGEST_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    updates: {
      type: "object",
      properties: {
        new_facts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              beat: { type: "string" },
            },
          },
        },
        atoms: { type: "object" },
        primitives: { type: "object" },
        motifs: { type: "array", items: { type: "string" } },
        dials: { type: "object" },
        evaluation: { type: "object" },
      },
    },
  },
};

function buildIngestPrompt({ projection, answer }) {
  const budget = buildBudgetedPrompt({
    stage: "ingest",
    blocks: [
      {
        id: "system",
        required: true,
        text: [
          "You are a story state extractor.",
          "Extract only durable state updates from the latest user answer.",
          "Do not decide what to ask next. Do not write a question. Do not write confirmation copy.",
          "Return JSON only with an `updates` object.",
        ].join(" "),
      },
      {
        id: "context",
        required: true,
        text: `Current story snapshot:\n${JSON.stringify(projection, null, 2)}`,
      },
      {
        id: "answer",
        required: true,
        text: `Latest user answer:\n${answer}`,
      },
      {
        id: "rules",
        required: true,
        text: [
          "Rules:",
          "- Only extract facts grounded in the latest answer.",
          "- Use `updates.new_facts` for new concrete details with beats like context, moment, meaning, stakes, turning_point, impact.",
          "- Patch atoms only when the answer supports them directly.",
          "- Patch primitives only when the answer directly clarifies them.",
          "- Leave fields omitted instead of inventing content.",
        ].join("\n"),
      },
    ],
  });
  return budget;
}

async function ingestTurn({ state, answer, previousQuestion, generateTextFn = generateText }) {
  if (!answer || typeof answer !== "string") {
    return { success: false, error: "ingestTurn requires answer text" };
  }

  if (generateTextFn === generateText && !isAvailable()) {
    return { success: false, error: "LLM not available" };
  }

  const projection = buildIngestProjection(state, previousQuestion);
  const budgetResult = buildIngestPrompt({ projection, answer });

  try {
    const result = await generateTextFn({
      prompt: budgetResult.prompt,
      taskType: "story",
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: INGEST_RESPONSE_SCHEMA,
      maxOutputTokens: 1200,
    });
    const parsed = parseJsonResponse(result.text || "");
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error,
        raw: parsed.raw,
        stageTelemetry: budgetResult,
      };
    }
    return {
      success: true,
      data: createTurnDelta({
        ...parsed.data,
        stageTelemetry: budgetResult,
      }),
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
  buildIngestPrompt,
  ingestTurn,
};
