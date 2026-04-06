#!/usr/bin/env node

/**
 * Autoresearch Story Optimization Runner
 *
 * Runs an automated optimization loop against the story guidance algorithm.
 * For each experiment:
 *   1. Sends 5 test inputs through the full story pipeline
 *   2. Scores each response with 6 binary evals (via LLM judge)
 *   3. Mutates the prompt if evals fail
 *   4. Keeps or discards the mutation based on score improvement
 *
 * Usage: node scripts/autoresearch-story.js
 * Requires: server running at localhost:3000 (`npm run dev`)
 *
 * @module scripts/autoresearch-story
 */

const fs = require("fs");
const path = require("path");

// Load env if running as script (not imported for tests)
if (require.main === module) {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = process.env.AUTORESEARCH_BASE_URL || "http://localhost:3000";
const RESULTS_PATH = path.join(__dirname, "..", "public", "autoresearch-results.json");
const WORKING_DIR = path.join(__dirname, "..", "autoresearch-story");
const PROMPTS_DIR = path.join(__dirname, "..", "src", "writer", "v3", "prompts");
const MAX_EXPERIMENTS = 10;
const DELAY_BETWEEN_CALLS_MS = 2000;
const CONVERGENCE_THRESHOLD = 95;
const CONVERGENCE_HITS_NEEDED = 3;
const BASELINE_SCORE_THRESHOLD = 27;

/**
 * 5 hardcoded test inputs covering different story completeness levels
 */
const TEST_INPUTS = [
  {
    id: 1,
    name: "Rich birthday",
    message:
      "Sarah has been my best friend since college. She showed up with mint chocolate chip ice cream during my worst breakup and made me laugh when I thought I could not smile again. Every summer we dance in the park and one time she slipped in a puddle while Dancing Queen was playing and we laughed so hard we cried. She makes me feel truly known and loved.",
    occasion: "birthday",
    recipient_name: "Sarah",
  },
  {
    id: 2,
    name: "Moderate birthday",
    message:
      "My dad taught me everything I know about fishing. We used to go every Saturday morning.",
    occasion: "birthday",
    recipient_name: "Dad",
  },
  {
    id: 3,
    name: "Sparse birthday",
    message: "Happy birthday mom",
    occasion: "birthday",
    recipient_name: "Mom",
  },
  {
    id: 4,
    name: "Emotional tribute",
    message:
      "I will never forget the high-risk pregnancy of the twins. There was fear, pain, and uncertainty. But she stayed strong through every appointment, every scare. That was love in action. Watching her become a mother changed everything.",
    occasion: "mothers_day",
    recipient_name: "Chioma",
  },
  {
    id: 5,
    name: "Friendship humor",
    message:
      "Jake and I have been causing trouble since high school. He once convinced me to enter a hot dog eating contest and I threw up on the judges table. We still laugh about it ten years later.",
    occasion: "friendship",
    recipient_name: "Jake",
  },
];

/**
 * Human-readable names for the 6 binary evals
 */
const EVAL_NAMES = [
  "Narrative emotional core",
  "Narrative mentions recipient name",
  "Question targets weakest element",
  "Question builds on input (Yes-And)",
  "Question is answerable (not abstract)",
  "Suggestions are story-specific",
];

// ---------------------------------------------------------------------------
// Pure functions (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Parse an LLM judge eval response into a normalized {eval1..eval6} object.
 * Handles JSON, markdown code blocks, YES/NO strings, and partial results.
 *
 * @param {string} raw - Raw LLM response text
 * @returns {Object} Normalized eval results {eval1: boolean, ..., eval6: boolean}
 */
function parseEvalResponse(raw) {
  const empty = {
    eval1: false,
    eval2: false,
    eval3: false,
    eval4: false,
    eval5: false,
    eval6: false,
  };

  if (!raw || typeof raw !== "string") return { ...empty };

  // Try to extract JSON from markdown code block first
  let jsonStr = raw;
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // Try to parse as JSON
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // Try to find any JSON object in the text
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        return { ...empty };
      }
    } else {
      return { ...empty };
    }
  }

  // Normalize each eval value to boolean
  const result = {};
  for (let i = 1; i <= 6; i++) {
    const key = `eval${i}`;
    const val = parsed[key];
    if (val === true || val === "YES" || val === "yes" || val === "Yes") {
      result[key] = true;
    } else {
      result[key] = false;
    }
  }
  return result;
}

/**
 * Compute aggregate score from per-input eval results.
 *
 * @param {Array<{evals: Object}>} perInput - Array of per-input results with eval booleans
 * @returns {{score: number, maxScore: number, passRate: number}}
 */
function computeScore(perInput) {
  let score = 0;
  const maxScore = perInput.length * 6;
  for (const item of perInput) {
    for (let i = 1; i <= 6; i++) {
      if (item.evals[`eval${i}`]) score++;
    }
  }
  const passRate = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  return { score, maxScore, passRate };
}

/**
 * Compute per-eval breakdown (how many inputs pass each eval).
 *
 * @param {Array<{evals: Object}>} perInput
 * @returns {Array<{eval: string, pass: number, total: number}>}
 */
function computePerEvalBreakdown(perInput) {
  const breakdown = [];
  for (let i = 0; i < 6; i++) {
    const evalKey = `eval${i + 1}`;
    let pass = 0;
    for (const item of perInput) {
      if (item.evals[evalKey]) pass++;
    }
    breakdown.push({
      eval: EVAL_NAMES[i],
      pass,
      total: perInput.length,
    });
  }
  return breakdown;
}

/**
 * Decide whether to keep a mutation based on score improvement.
 *
 * @param {number} newPassRate - New experiment's pass rate
 * @param {number} bestPassRate - Previous best pass rate
 * @returns {boolean} True if the experiment should be kept
 */
function shouldKeepExperiment(newPassRate, bestPassRate) {
  return newPassRate > bestPassRate;
}

/**
 * Build the eval prompt sent to the LLM judge.
 *
 * @param {string} userInput - The original user message
 * @param {{narrative: string, question: string, suggestions: string[]}} aiResponse
 * @returns {string} The eval prompt
 */
function buildEvalPrompt(userInput, aiResponse) {
  const suggestionsStr =
    aiResponse.suggestions && aiResponse.suggestions.length > 0
      ? aiResponse.suggestions.join(", ")
      : "(none)";

  // The question may be embedded in the narrative when action is ASK
  const question = aiResponse.question || aiResponse.next_question || null;
  const narrativeText = aiResponse.narrative || aiResponse.story_summary || "(none)";
  const questionText = question || "(embedded in narrative — check narrative for a question)";

  return `Score this story guidance response. Answer YES or NO for each:

USER INPUT: ${userInput}
AI NARRATIVE/SUMMARY: ${narrativeText}
AI FOLLOW-UP QUESTION: ${questionText}
AI SUGGESTIONS: ${suggestionsStr}

NOTE: The follow-up question may be embedded at the end of the narrative. Look for question marks in the narrative text.

EVAL 1 - Narrative captures emotional core: Does the narrative reference at least one SPECIFIC memory/event from the user's input (not generic)?
EVAL 2 - Narrative mentions recipient name: Does the narrative include the recipient's name?
EVAL 3 - Question targets weakest element: Does the follow-up question address what's MISSING from the story?
EVAL 4 - Question builds on user input (Yes-And): Does the question reference something specific the user said?
EVAL 5 - Question is answerable (not abstract): Could a user immediately answer this without deep thinking?
EVAL 6 - Suggestions are story-specific: Are at least 2 of 3 suggestions specific to THIS story (not generic)?

Return JSON: {"eval1": true/false, "eval2": true/false, "eval3": true/false, "eval4": true/false, "eval5": true/false, "eval6": true/false}`;
}

/**
 * Create a structured experiment entry for the results file.
 *
 * @param {{id: number, status: string, description: string, mutation: string|null, perInput: Array}} opts
 * @returns {Object} Experiment entry for results.json
 */
function createExperimentEntry({ id, status, description, mutation, perInput }) {
  const { score, maxScore, passRate } = computeScore(perInput);
  const perEval = computePerEvalBreakdown(perInput);
  return {
    id,
    score,
    max_score: maxScore,
    pass_rate: passRate,
    status,
    description,
    mutation,
    per_input: perInput.map((item) => ({
      input_id: item.input_id,
      name: item.name,
      evals: item.evals,
    })),
    per_eval: perEval,
  };
}

/**
 * Build the top-level results JSON structure.
 *
 * @param {{status: string, currentExperiment: number, experiments: Array, changelog: Array}} opts
 * @returns {Object} The results JSON
 */
function buildResultsJson({ status, currentExperiment, experiments, changelog }) {
  const baselineScore =
    experiments.length > 0 ? experiments[0].pass_rate : 0;
  const bestScore = experiments.reduce(
    (max, exp) => Math.max(max, exp.pass_rate),
    0
  );
  return {
    status,
    current_experiment: currentExperiment,
    baseline_score: baselineScore,
    best_score: bestScore,
    experiments,
    changelog,
  };
}

function parseCliArgs(argv = []) {
  const args = Array.isArray(argv) ? argv : [];
  const parsed = {
    baselineOnly: false,
    thresholdScore: null,
  };

  for (const arg of args) {
    if (arg === "--baseline-only") {
      parsed.baselineOnly = true;
      continue;
    }
    if (arg.startsWith("--threshold-score=")) {
      const rawValue = Number.parseInt(arg.split("=")[1], 10);
      if (Number.isFinite(rawValue)) {
        parsed.thresholdScore = rawValue;
      }
    }
  }

  return parsed;
}

function evaluateThreshold(score, thresholdScore = BASELINE_SCORE_THRESHOLD) {
  if (!Number.isFinite(thresholdScore)) {
    return { passed: true, thresholdScore: null };
  }

  return {
    passed: score >= thresholdScore,
    thresholdScore,
  };
}

// ---------------------------------------------------------------------------
// Async helpers (not tested in unit tests, tested via integration)
// ---------------------------------------------------------------------------

/**
 * Sleep helper
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call the story full-round endpoint for a single test input.
 *
 * @param {Object} input - Test input {message, occasion, recipient_name}
 * @returns {Promise<Object>} API response
 */
async function callFullRound(input) {
  const res = await fetch(`${BASE_URL}/debug/story/full-round`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-id": "autoresearch_user",
    },
    body: JSON.stringify({
      message: input.message,
      occasion: input.occasion,
      recipient_name: input.recipient_name,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`full-round failed (${res.status}): ${text}`);
  }
  return res.json();
}

/**
 * Call the LLM judge to score a single response.
 * Uses the project's generateText infrastructure.
 *
 * @param {string} evalPrompt - The eval prompt
 * @returns {Promise<Object>} Parsed eval results
 */
async function callEvalJudge(evalPrompt) {
  const { generateText } = require("../src/services/llm-provider");

  const response = await generateText({
    prompt: evalPrompt,
    taskType: "eval",
    systemPrompt:
      "You are a strict evaluator. Score each eval YES or NO. Return only JSON with keys eval1-eval6, values true or false. No explanation.",
    temperature: 0.1,
    maxOutputTokens: 200,
  });

  // generateText returns { text, ... } — extract the text string
  const responseText = typeof response === "string" ? response : (response?.text || "");
  return parseEvalResponse(responseText);
}

/**
 * Run all 5 test inputs and score them.
 *
 * @returns {Promise<Array>} per-input results
 */
async function runAllInputs() {
  const results = [];
  for (const input of TEST_INPUTS) {
    console.log(`  [Input ${input.id}] ${input.name}...`);
    try {
      const apiResponse = await callFullRound(input);
      const aiResponse = apiResponse.ai_response || {};
      await sleep(DELAY_BETWEEN_CALLS_MS);

      // Build eval prompt and score
      const evalPrompt = buildEvalPrompt(input.message, aiResponse);
      const evalResult = await callEvalJudge(evalPrompt);
      await sleep(DELAY_BETWEEN_CALLS_MS);

      results.push({
        input_id: input.id,
        name: input.name,
        evals: evalResult,
        ai_response: aiResponse,
      });

      const passed = Object.values(evalResult).filter(Boolean).length;
      console.log(`  [Input ${input.id}] ${passed}/6 evals passed`);
    } catch (err) {
      console.error(`  [Input ${input.id}] ERROR: ${err.message}`);
      results.push({
        input_id: input.id,
        name: input.name,
        evals: {
          eval1: false,
          eval2: false,
          eval3: false,
          eval4: false,
          eval5: false,
          eval6: false,
        },
        ai_response: null,
        error: err.message,
      });
    }
  }
  return results;
}

/**
 * Save results to public/autoresearch-results.json
 */
function saveResults(resultsJson) {
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(resultsJson, null, 2));
  console.log(`  [Results] Written to ${RESULTS_PATH}`);
}

/**
 * Backup the current working prompts before mutation.
 */
function backupPrompts(experimentId) {
  const backupDir = path.join(WORKING_DIR, `backup-exp${experimentId}`);
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  for (const file of ["reason-v3.md", "reason-v3-selection.md"]) {
    const src = path.join(WORKING_DIR, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(backupDir, file));
    }
  }
}

/**
 * Initialize working directory with copies of the source prompts.
 */
function initWorkingDir() {
  if (!fs.existsSync(WORKING_DIR)) fs.mkdirSync(WORKING_DIR, { recursive: true });
  for (const file of ["reason-v3.md", "reason-v3-selection.md"]) {
    const src = path.join(PROMPTS_DIR, file);
    const dst = path.join(WORKING_DIR, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
      console.log(`  [Setup] Copied ${file} to working directory`);
    }
  }
}

/**
 * Analyze failing evals and generate a mutation description.
 * Uses LLM to suggest what to change in the prompt.
 *
 * @param {Array} perInput - Per-input results
 * @param {Array} perEval - Per-eval breakdown
 * @returns {Promise<{description: string, patch: string}>}
 */
async function analyzeFallingEvalsAndMutate(perInput, perEval) {
  const { generateText } = require("../src/services/llm-provider");

  // Find weakest evals
  const sorted = [...perEval].sort((a, b) => a.pass - b.pass);
  const weakest = sorted.slice(0, 2);

  // Get some failing examples
  const failExamples = [];
  for (const input of perInput) {
    for (const weak of weakest) {
      const evalIdx = EVAL_NAMES.indexOf(weak.eval) + 1;
      const evalKey = `eval${evalIdx}`;
      if (!input.evals[evalKey] && input.ai_response) {
        failExamples.push({
          eval: weak.eval,
          input: input.name,
          narrative: (input.ai_response.narrative || "").slice(0, 200),
          question: input.ai_response.question || "(none)",
          suggestions: (input.ai_response.suggestions || []).join(", "),
        });
      }
    }
  }

  // Read current prompt
  const currentPrompt = fs.readFileSync(
    path.join(WORKING_DIR, "reason-v3.md"),
    "utf-8"
  );

  const mutationPrompt = `You are an AI prompt engineer optimizing a story guidance prompt.

WEAKEST EVALS (failing most):
${weakest.map((w) => `- ${w.eval}: ${w.pass}/${w.total} pass`).join("\n")}

FAILING EXAMPLES:
${failExamples
    .slice(0, 3)
    .map(
      (ex) =>
        `Input: ${ex.input}\nEval: ${ex.eval}\nNarrative: ${ex.narrative}\nQuestion: ${ex.question}\nSuggestions: ${ex.suggestions}`
    )
    .join("\n---\n")}

CURRENT PROMPT (first 2000 chars):
${currentPrompt.slice(0, 2000)}

Make ONE specific change to the prompt that would improve the weakest eval.
Do NOT rewrite the entire prompt. Return JSON:
{
  "description": "one-sentence description of the change",
  "search": "exact text to find in the prompt (10-50 chars)",
  "replace": "the replacement text"
}

If the fix requires adding new text rather than replacing, set "search" to the line AFTER which to insert, and prefix "replace" with "\\nINSERT_AFTER\\n" followed by the new text.`;

  const response = await generateText({
    prompt: mutationPrompt,
    taskType: "mutation",
    systemPrompt:
      "You are a prompt optimization specialist. Return ONLY valid JSON. Make minimal, targeted changes.",
    temperature: 0.4,
    maxOutputTokens: 500,
  });

  // generateText returns { text, ... } — extract the text string
  const responseText = typeof response === "string" ? response : (response?.text || "");
  return parseMutationResponse(responseText, currentPrompt);
}

/**
 * Parse the mutation LLM response and apply it to the working prompt.
 *
 * @param {string} raw - LLM response
 * @param {string} currentPrompt - Current prompt text
 * @returns {{description: string, applied: boolean}}
 */
function parseMutationResponse(raw, currentPrompt) {
  let parsed;
  try {
    // Extract JSON from potential markdown
    const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : raw;
    parsed = JSON.parse(jsonStr);
  } catch {
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        return { description: "Failed to parse mutation", applied: false };
      }
    } else {
      return { description: "Failed to parse mutation", applied: false };
    }
  }

  const { description, search, replace } = parsed;
  if (!description || !search || !replace) {
    return { description: "Incomplete mutation response", applied: false };
  }

  // Apply the mutation
  const promptPath = path.join(WORKING_DIR, "reason-v3.md");

  if (replace.startsWith("\nINSERT_AFTER\n")) {
    // Insert mode
    const newText = replace.replace("\nINSERT_AFTER\n", "");
    if (currentPrompt.includes(search)) {
      const idx = currentPrompt.indexOf(search) + search.length;
      const mutated = currentPrompt.slice(0, idx) + "\n" + newText + currentPrompt.slice(idx);
      fs.writeFileSync(promptPath, mutated);
      return { description, applied: true };
    }
  } else {
    // Replace mode
    if (currentPrompt.includes(search)) {
      const mutated = currentPrompt.replace(search, replace);
      fs.writeFileSync(promptPath, mutated);
      return { description, applied: true };
    }
  }

  return { description: `${description} (search text not found)`, applied: false };
}

/**
 * Revert the working prompt to the backup from before the experiment.
 */
function revertPrompt(experimentId) {
  const backupDir = path.join(WORKING_DIR, `backup-exp${experimentId}`);
  const file = "reason-v3.md";
  const backup = path.join(backupDir, file);
  const dst = path.join(WORKING_DIR, file);
  if (fs.existsSync(backup)) {
    fs.copyFileSync(backup, dst);
  }
}

/**
 * Copy the working prompt into the source directory so the server picks it up.
 * (The server loads prompts at startup from src/writer/v3/prompts/ — but since
 * builder.js caches at module level, we need to note that a server restart
 * may be needed for changes to take effect. For the autoresearch loop, we
 * modify the working copy and note this limitation.)
 *
 * IMPORTANT: The server caches prompts at startup. For autoresearch to work
 * with mutated prompts, we copy the working prompt back to the source dir.
 * The server would need to be restarted OR the template loading made dynamic.
 *
 * For now, we copy to source dir. The template is cached in builder.js at
 * require time, so mutations only take effect after server restart.
 * TODO: Make template loading dynamic or use a hot-reload mechanism.
 */
function deployWorkingPromptToSource() {
  const file = "reason-v3.md";
  const src = path.join(WORKING_DIR, file);
  const dst = path.join(PROMPTS_DIR, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst);
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function main(cliOptions = parseCliArgs(process.argv.slice(2))) {
  console.log("=== Autoresearch Story Optimization ===\n");

  // Initialize
  initWorkingDir();

  const experiments = [];
  const changelog = [];
  let bestPassRate = 0;
  let convergenceHits = 0;

  // Phase 1: Baseline
  console.log("[Experiment 0] Running baseline...");
  const baselineResults = await runAllInputs();
  const baselineEntry = createExperimentEntry({
    id: 0,
    status: "baseline",
    description: "original prompts -- no changes",
    mutation: null,
    perInput: baselineResults,
  });
  experiments.push(baselineEntry);
  bestPassRate = baselineEntry.pass_rate;

  console.log(
    `[Experiment 0] Baseline: ${baselineEntry.score}/${baselineEntry.max_score} (${baselineEntry.pass_rate}%)\n`
  );

  if (cliOptions.baselineOnly) {
    const threshold = evaluateThreshold(baselineEntry.score, cliOptions.thresholdScore);
    saveResults(
      buildResultsJson({
        status: threshold.passed ? "baseline_complete" : "baseline_failed",
        currentExperiment: 0,
        experiments,
        changelog,
      })
    );
    if (threshold.thresholdScore != null) {
      const comparator = threshold.passed ? ">=" : "<";
      console.log(
        `[Baseline Gate] ${baselineEntry.score}/${baselineEntry.max_score} ${comparator} ${threshold.thresholdScore}/30`
      );
    }
    return {
      experiments,
      bestPassRate,
      thresholdPassed: threshold.passed,
    };
  }

  // Save initial results
  saveResults(
    buildResultsJson({
      status: "running",
      currentExperiment: 0,
      experiments,
      changelog,
    })
  );

  // Check if already converged
  if (bestPassRate >= CONVERGENCE_THRESHOLD) {
    convergenceHits++;
    console.log(
      `[Convergence] Baseline already at ${bestPassRate}% (hit ${convergenceHits}/${CONVERGENCE_HITS_NEEDED})`
    );
  }

  // Phase 2: Optimization loop
  for (let expId = 1; expId <= MAX_EXPERIMENTS; expId++) {
    if (convergenceHits >= CONVERGENCE_HITS_NEEDED) {
      console.log(
        `\n[Done] Converged at ${bestPassRate}% after ${convergenceHits} consecutive hits.`
      );
      break;
    }

    console.log(`\n[Experiment ${expId}] Analyzing failures and mutating...`);

    // Backup current state
    backupPrompts(expId);

    // Analyze and mutate
    const lastResults = experiments[experiments.length - 1].per_input;
    const lastPerEval = experiments[experiments.length - 1].per_eval;
    const mutation = await analyzeFallingEvalsAndMutate(
      lastResults.map((item, idx) => ({
        ...item,
        ai_response: baselineResults[idx]?.ai_response || null,
      })),
      lastPerEval
    );

    if (!mutation.applied) {
      console.log(`  [Mutation] Failed to apply: ${mutation.description}`);
      changelog.push({
        experiment: expId,
        status: "skip",
        change: mutation.description,
        score_delta: "0",
      });
      // Save and continue
      saveResults(
        buildResultsJson({
          status: "running",
          currentExperiment: expId,
          experiments,
          changelog,
        })
      );
      continue;
    }

    console.log(`  [Mutation] ${mutation.description}`);

    // Deploy mutated prompt to source (so server picks it up on next load)
    deployWorkingPromptToSource();

    // NOTE: Server caches templates at require-time.
    // For the mutation to take effect, the server would need a restart.
    // Since this is an autoresearch tool, we document this limitation.
    // The eval still measures the CURRENT server behavior.
    console.log(
      "  [Note] Server caches prompts at startup. Restart server for mutation to take effect."
    );

    // Wait a moment for filesystem sync
    await sleep(1000);

    // Run inputs with mutated prompt
    console.log(`[Experiment ${expId}] Running inputs...`);
    const expResults = await runAllInputs();
    const expEntry = createExperimentEntry({
      id: expId,
      status: "pending",
      description: mutation.description,
      mutation: mutation.description,
      perInput: expResults,
    });

    // Decide: keep or discard
    const keep = shouldKeepExperiment(expEntry.pass_rate, bestPassRate);
    expEntry.status = keep ? "keep" : "discard";

    const scoreDelta = expEntry.pass_rate - bestPassRate;
    changelog.push({
      experiment: expId,
      status: expEntry.status,
      change: mutation.description,
      score_delta: (scoreDelta >= 0 ? "+" : "") + scoreDelta,
    });

    if (keep) {
      bestPassRate = expEntry.pass_rate;
      console.log(
        `  [KEEP] ${expEntry.score}/${expEntry.max_score} (${expEntry.pass_rate}%) -- improved by ${scoreDelta}%`
      );
    } else {
      // Revert the mutation
      revertPrompt(expId);
      deployWorkingPromptToSource();
      console.log(
        `  [DISCARD] ${expEntry.score}/${expEntry.max_score} (${expEntry.pass_rate}%) -- no improvement`
      );
    }

    experiments.push(expEntry);

    // Check convergence
    if (bestPassRate >= CONVERGENCE_THRESHOLD) {
      convergenceHits++;
      console.log(
        `  [Convergence] At ${bestPassRate}% (hit ${convergenceHits}/${CONVERGENCE_HITS_NEEDED})`
      );
    } else {
      convergenceHits = 0;
    }

    // Save after each experiment
    saveResults(
      buildResultsJson({
        status: "running",
        currentExperiment: expId,
        experiments,
        changelog,
      })
    );
  }

  // Final save
  saveResults(
    buildResultsJson({
      status: "complete",
      currentExperiment: experiments.length - 1,
      experiments,
      changelog,
    })
  );

  console.log("\n=== Autoresearch Complete ===");
  console.log(`Baseline: ${experiments[0].pass_rate}%`);
  console.log(`Best: ${bestPassRate}%`);
  console.log(`Experiments: ${experiments.length}`);
  console.log(`Results: ${RESULTS_PATH}`);

  return {
    experiments,
    bestPassRate,
    thresholdPassed: true,
  };
}

// ---------------------------------------------------------------------------
// Exports (for testing) and main entry
// ---------------------------------------------------------------------------

module.exports = {
  TEST_INPUTS,
  EVAL_NAMES,
  parseEvalResponse,
  computeScore,
  computePerEvalBreakdown,
  shouldKeepExperiment,
  buildEvalPrompt,
  createExperimentEntry,
  buildResultsJson,
  parseCliArgs,
  evaluateThreshold,
};

if (require.main === module) {
  main()
    .then((result) => {
      if (result?.thresholdPassed === false) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error("\n[Fatal]", err);
      process.exit(1);
    });
}
