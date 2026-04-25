/**
 * Song Readiness Assessment
 *
 * Pre-flight gate that runs at story confirmation when the user is heading
 * toward song creation. Evaluates the same canonical context that final
 * lyric generation will see, then returns blockers / warnings / a follow-up
 * question. The structural-only check is fully deterministic — no LLM call —
 * so confirmation latency stays inside the API p95 budget.
 *
 * Extracted from songwriter.js as Phase 3 of deferred /ce:review fixes.
 *
 * @module writer/song-readiness
 */

const {
  normalizeContext,
  buildStoryDetailLedger,
  buildSongwriterPrompt,
  validateSongContract,
  CANONICAL_REQUIRED_DETAIL_LIMIT,
} = require("./songwriter");

function buildSongReadinessFollowUp(blocker) {
  const detail = blocker?.detail || blocker?.message || "";
  if (blocker?.code === "missing_required_story_detail" && detail) {
    const cleanDetail = detail.replace(/^\[[^\]]+\]\s*/, "");
    return `Before I make this a song, give me one clear sentence about this part: ${cleanDetail}`;
  }
  if (blocker?.code === "too_many_required_details") {
    return "Before I make this a song, choose the few details that absolutely must be heard in the lyrics.";
  }
  if (blocker?.code === "missing_story") {
    return "Before I make this a song, give me one specific memory or moment you want the lyrics to carry.";
  }
  return "Before I make this a song, give me one more concrete detail that must not be lost.";
}

function assessSongReadiness(rawContext = {}) {
  const normalized = normalizeContext(rawContext);
  const blockers = [];
  const warnings = [];
  const checkedAt = new Date().toISOString();
  const hasStoryText = Boolean(
    normalized.completed_story_package?.prose ||
    normalized.narrative ||
    normalized.message ||
    normalized.specific_memory
  );

  if (!hasStoryText) {
    blockers.push({
      code: "missing_story",
      message: "No usable story text is available for lyric generation.",
    });
  }

  const requiredLedger = buildStoryDetailLedger(normalized, { maxEntries: "all" })
    .filter((entry) => entry.required);
  const totalRequired = requiredLedger.length;
  const canonicalRequired = buildStoryDetailLedger(normalized, { maxEntries: CANONICAL_REQUIRED_DETAIL_LIMIT })
    .filter((entry) => entry.required);

  if (totalRequired > CANONICAL_REQUIRED_DETAIL_LIMIT * 2) {
    warnings.push({
      code: "high_required_detail_pressure",
      message: `The story has ${totalRequired} required details; only the strongest details can fit cleanly in a short song.`,
      required_detail_count: totalRequired,
    });
  }

  if (canonicalRequired.length === 0 && hasStoryText) {
    warnings.push({
      code: "no_required_detail_ledger",
      message: "No required story-detail ledger entries were identified; final lyrics will rely on the narrative and song map.",
    });
  }

  const packageCoverage = normalized.completed_story_package?.detail_coverage_map ||
    normalized.completed_story_package?.coverage ||
    null;
  const missingRequiredFromPackage = Array.isArray(packageCoverage?.missingRequired)
    ? packageCoverage.missingRequired
    : [];
  const requiredMissingCount = Number(packageCoverage?.stats?.requiredMissing || 0);
  // Stats and the array can drift; trust whichever signal sees more missing.
  const effectiveMissingCount = Math.max(requiredMissingCount, missingRequiredFromPackage.length);
  if (effectiveMissingCount > 0) {
    for (const missing of missingRequiredFromPackage.slice(0, 3)) {
      blockers.push({
        code: "missing_required_story_detail",
        id: missing?.id || null,
        detail: missing?.text || String(missing || ""),
        message: "A required story detail is not present in the canonical story package.",
      });
    }
    if (missingRequiredFromPackage.length === 0) {
      blockers.push({
        code: "missing_required_story_detail",
        message: `${effectiveMissingCount} required story detail(s) are missing from the canonical story package.`,
      });
    }
  }

  const promptBuild = buildSongwriterPrompt(normalized, {
    returnMetadata: true,
    suppressLogs: true,
  });
  const promptBudget = {
    initialTokens: promptBuild.metadata.prompt_budget.initial_tokens,
    tokens: promptBuild.metadata.prompt_budget.final_tokens,
    tokenBudget: promptBuild.metadata.prompt_budget.token_budget,
    removedCharsTotal: promptBuild.metadata.prompt_budget.removed_chars_total,
    compactions: promptBuild.metadata.prompt_budget.compactions || [],
  };
  const hardCapCompaction = (promptBudget.compactions || [])
    .some((entry) => entry.stage === "song_brief_hard_cap");
  if (hardCapCompaction) {
    blockers.push({
      code: "prompt_budget_hard_cap",
      message: "The story contract is too large and would require hard prompt truncation before lyric generation.",
    });
  } else if ((promptBudget.compactions || []).length > 0) {
    warnings.push({
      code: "prompt_budget_compacted",
      message: "The story is large enough to require compact prompt evidence, but the required-detail ledger remains available.",
      compactions: promptBudget.compactions.map((entry) => entry.stage),
    });
  }

  const contract = validateSongContract(normalized);
  if (!contract.valid && (contract.missingSections || []).length > 0) {
    warnings.push({
      code: "song_contract_repair_needed",
      message: "The song map needs deterministic repair before lyric generation.",
      missing_sections: contract.missingSections,
    });
  }

  const ready = blockers.length === 0;
  const followUpQuestion = ready ? null : buildSongReadinessFollowUp(blockers[0]);
  return {
    ready,
    status: ready ? "ready" : "needs_input",
    checked_at: checkedAt,
    blockers,
    warnings,
    follow_up_question: followUpQuestion,
    suggestions: ready ? [] : [
      "Add the concrete moment in one sentence.",
      "Name what changed because of it.",
      "Say why this detail matters now.",
    ],
    required_detail_count: totalRequired,
    canonical_required_detail_count: canonicalRequired.length,
    prompt_budget: {
      initial_tokens: promptBudget.initialTokens,
      final_tokens: promptBudget.tokens,
      token_budget: promptBudget.tokenBudget,
      removed_chars_total: promptBudget.removedCharsTotal,
      compactions: (promptBudget.compactions || []).map((entry) => entry.stage),
    },
    contract: {
      valid: contract.valid,
      missing_sections: contract.missingSections || [],
      uncited_sections: contract.uncitedSections || [],
      broken_citations: contract.brokenCitations || [],
    },
  };
}

module.exports = {
  assessSongReadiness,
  buildSongReadinessFollowUp,
};
