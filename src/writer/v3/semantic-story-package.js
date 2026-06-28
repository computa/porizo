const { isDeepStrictEqual } = require("node:util");

const {
  deriveStoryBlockProfile,
  evaluateNarrativeBlockCoverage,
  repairNarrativeFromBlockProfile,
  repairSongMapWithProfile,
  extractRetainedDetails,
  computeDetailCoverage,
  detailId,
  normalizeKey,
} = require("../story-semantics");
const { validateSongContract } = require("../song-contract");

const MAX_REPEAT_SEMANTIC_ASKS = 1;
const COMPLETED_STORY_SCHEMA_VERSION = 2;

function getCanonicalNarrative(state) {
  if (!state || typeof state !== "object") return "";
  if (typeof state.narrative_current === "string" && state.narrative_current.trim()) {
    return state.narrative_current;
  }
  if (typeof state.narrative === "string") {
    return state.narrative;
  }
  return "";
}

function buildSemanticBlockSignature(semanticStory = {}) {
  const missing = Array.isArray(semanticStory?.missing_narrative_blocks)
    ? [...semanticStory.missing_narrative_blocks].sort()
    : [];
  const weak = Array.isArray(semanticStory?.weak_contract_sections)
    ? [...semanticStory.weak_contract_sections].sort()
    : [];
  return JSON.stringify({
    missing,
    weak,
    duplicated: Boolean(semanticStory?.duplicated_thesis),
  });
}

function applySemanticNarrativeRepair(state, narrative, missingBlocks = []) {
  const nextNarrative = typeof narrative === "string" ? narrative.trim() : "";
  if (!nextNarrative || nextNarrative === getCanonicalNarrative(state)) {
    return state;
  }

  const now = new Date().toISOString();
  const nextVersion = Math.max(Number(state?.narrative_version || 0), 0) + 1;
  const revisionEntry = {
    version: nextVersion,
    turn: state?.turn_count || 0,
    narrative: nextNarrative,
    timestamp: now,
    integration: {
      added_facts: [],
      updated_facts: [],
      superseded_facts: [],
      semantic_repair: true,
      repaired_blocks: [...missingBlocks],
    },
  };
  const integrationDelta = {
    turn: state?.turn_count || 0,
    timestamp: now,
    added_facts: [],
    updated_facts: [],
    superseded_facts: [],
    conflicts_detected: [],
    conflicts_resolved: [],
    narrative_rewritten: true,
    semantic_repair: true,
    repaired_blocks: [...missingBlocks],
  };

  return {
    ...state,
    narrative: nextNarrative,
    narrative_current: nextNarrative,
    narrative_version: nextVersion,
    narrative_revisions: [...(Array.isArray(state?.narrative_revisions) ? state.narrative_revisions : []), revisionEntry].slice(-40),
    integration_history: [...(Array.isArray(state?.integration_history) ? state.integration_history : []), integrationDelta].slice(-40),
    last_integration_delta: integrationDelta,
    updated_at: now,
  };
}

function ensureSemanticStoryIntegrity(state) {
  if (!state || typeof state !== "object") return state;

  const blockProfile = deriveStoryBlockProfile(state);
  let nextState = state;
  let repairedNarrative = false;
  let repairedSongMap = false;
  let narrativeCoverage = evaluateNarrativeBlockCoverage(getCanonicalNarrative(nextState), blockProfile);

  if ((blockProfile.enforcedNarrativeBlocks || []).length > 0 && narrativeCoverage.missingBlocks.length > 0) {
    const repaired = repairNarrativeFromBlockProfile(getCanonicalNarrative(nextState), blockProfile);
    if (repaired.repaired && repaired.narrative) {
      nextState = applySemanticNarrativeRepair(nextState, repaired.narrative, repaired.addedBlocks);
      repairedNarrative = true;
      narrativeCoverage = repaired.coverage;
    }
  }

  const songMapRepair = repairSongMapWithProfile(nextState.song_map, nextState, { blockProfile });
  if (songMapRepair.repaired) {
    nextState = {
      ...nextState,
      song_map: songMapRepair.song_map,
      updated_at: new Date().toISOString(),
    };
    repairedSongMap = true;
  }

  const baseSemanticValidity = {
    rich_story: blockProfile.richStory,
    required_blocks: blockProfile.requiredBlocks,
    enforced_narrative_blocks: blockProfile.enforcedNarrativeBlocks || [],
    missing_narrative_blocks: narrativeCoverage.missingBlocks,
    contract_valid: songMapRepair.report.valid,
    weak_contract_sections: songMapRepair.report.weakSections,
    duplicated_thesis: songMapRepair.report.duplicatedThesis,
    repaired_narrative: repairedNarrative,
    repaired_song_map: repairedSongMap,
  };
  const semanticSignature = buildSemanticBlockSignature(baseSemanticValidity);
  const overrideActive = state?.semantic_override?.signature === semanticSignature
    && Number(state?.semantic_override?.count || 0) >= MAX_REPEAT_SEMANTIC_ASKS;
  const nextSemanticValidity = {
    ...baseSemanticValidity,
    can_confirm: overrideActive || (narrativeCoverage.missingBlocks.length === 0 && songMapRepair.report.valid),
    exhaustion_override: overrideActive,
  };
  const previousSemanticValidity = nextState.semantic_story && typeof nextState.semantic_story === "object"
    ? { ...nextState.semantic_story }
    : null;
  if (previousSemanticValidity && typeof previousSemanticValidity === "object") {
    delete previousSemanticValidity.updated_at;
  }
  const semanticValidity = previousSemanticValidity && isDeepStrictEqual(previousSemanticValidity, nextSemanticValidity)
    ? nextState.semantic_story
    : {
      ...nextSemanticValidity,
      updated_at: new Date().toISOString(),
    };

  return {
    ...nextState,
    semantic_story: semanticValidity,
  };
}

function ensureCompletedStoryPackage(state, context) {
  if (!state || typeof state !== "object") {
    return { state, repaired: false, coverage: null };
  }

  const narrative = getCanonicalNarrative(state);
  if (!narrative) {
    return { state, repaired: false, coverage: null };
  }

  const existing = state.completed_story_package;
  if (
    existing &&
    typeof existing === "object" &&
    existing.prose === narrative &&
    existing.schema_version === COMPLETED_STORY_SCHEMA_VERSION &&
    Array.isArray(existing.retained_details) &&
    existing.retained_details.length > 0
  ) {
    if (existing.retained_details.some((d) => !d.id)) {
      existing.retained_details.forEach((d) => {
        if (!d.id) d.id = detailId(d.category, normalizeKey(d.text));
      });
    }
    return { state, repaired: false, coverage: existing.detail_coverage_map };
  }

  const retainedDetails = extractRetainedDetails(context || state);
  if (!retainedDetails.length) {
    return { state, repaired: false, coverage: null };
  }

  let coverage = computeDetailCoverage(retainedDetails, narrative);
  let repairedNarrative = narrative;
  let repaired = false;

  if (coverage.stats.requiredMissing > 0) {
    const missingSentences = coverage.missingRequired
      .map((entry) => entry.text)
      .filter((text) => typeof text === "string" && text.trim().length > 0);

    if (missingSentences.length > 0) {
      const suffix = missingSentences.join(" ");
      repairedNarrative = `${narrative.trimEnd()} ${suffix}`;
      coverage = computeDetailCoverage(retainedDetails, repairedNarrative);
      repaired = true;
    }
  }

  const blockProfile = deriveStoryBlockProfile(context || state);
  const detailBudgetWarning =
    repairedNarrative.length > 3000 && coverage.stats.coverageRate < 0.8
      ? `Story is ${repairedNarrative.length} characters with ${coverage.stats.missing} details below coverage threshold. Consider focusing on the most important moments.`
      : null;

  const completedStoryPackage = {
    prose: repairedNarrative,
    retained_details: retainedDetails,
    detail_coverage_map: coverage,
    semantic_block_profile: blockProfile,
    detail_budget_warning: detailBudgetWarning,
    schema_version: COMPLETED_STORY_SCHEMA_VERSION,
    built_at: new Date().toISOString(),
  };

  let nextState = state;

  if (repaired && repairedNarrative !== narrative) {
    nextState = applySemanticNarrativeRepair(nextState, repairedNarrative, ["detail_coverage_repair"]);
  }

  if (repaired && nextState.song_map) {
    const freshProfile = deriveStoryBlockProfile(nextState);
    const reDerived = repairSongMapWithProfile(nextState.song_map, nextState, { blockProfile: freshProfile });
    const oldValid = validateSongContract?.(nextState)?.valid;
    const newState = { ...nextState, song_map: reDerived.song_map };
    const newValid = validateSongContract?.(newState)?.valid;

    if (newValid || !oldValid) {
      nextState = newState;
    }
  }

  nextState = {
    ...nextState,
    completed_story_package: completedStoryPackage,
  };

  console.log(
    `[V3] Completed story package: ${coverage.stats.preserved}/${coverage.stats.total} preserved, ` +
    `${coverage.stats.paraphrased} paraphrased, ${coverage.stats.requiredMissing} required missing` +
    (repaired ? " (repaired)" : "") +
    `${detailBudgetWarning ? ` warning=${detailBudgetWarning}` : ""}` +
    `${coverage.missingRequired?.length ? ` missingPreview=${JSON.stringify(coverage.missingRequired.slice(0, 3))}` : ""}`,
  );

  return { state: nextState, repaired, coverage };
}

module.exports = {
  MAX_REPEAT_SEMANTIC_ASKS,
  COMPLETED_STORY_SCHEMA_VERSION,
  getCanonicalNarrative,
  buildSemanticBlockSignature,
  applySemanticNarrativeRepair,
  ensureSemanticStoryIntegrity,
  ensureCompletedStoryPackage,
};
