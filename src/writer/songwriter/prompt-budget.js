"use strict";

function summarizePromptCompactionText(text, maxLen = 160) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= maxLen) {
    return value;
  }
  return `${value.slice(0, maxLen - 1)}…`;
}

function roughTokenEstimate(text) {
  return Math.ceil((text || "").length / 4);
}

function applySongwriterPromptBudget(prompt, {
  narrativeText = "",
  tokenBudget = 5500,
} = {}) {
  const compactions = [];
  let finalPrompt = String(prompt || "").trim();
  const initialChars = finalPrompt.length;
  const initialTokens = roughTokenEstimate(finalPrompt);
  let tokens = initialTokens;

  if (tokens > tokenBudget) {
    const overBy = tokens - tokenBudget;
    const charsToRemove = overBy * 4;
    if (narrativeText && narrativeText.length > charsToRemove + 100) {
      const targetLength = Math.max(900, narrativeText.length - charsToRemove - 50);
      const headLength = Math.ceil(targetLength * 0.55);
      const tailLength = Math.max(250, Math.floor(targetLength * 0.35));
      const head = narrativeText.slice(0, headLength);
      const tail = narrativeText.slice(Math.max(headLength, narrativeText.length - tailLength));
      const cleanNarrative = `${head.trim()}\n[Story prose compacted. Required details are preserved in the binding detail ledger.]\n${tail.trim()}`;
      finalPrompt = finalPrompt.replace(narrativeText, cleanNarrative);
      const nextTokens = roughTokenEstimate(finalPrompt);
      compactions.push({
        stage: "narrative_trim",
        removedChars: Math.max(0, narrativeText.length - cleanNarrative.length),
        removedPreview: summarizePromptCompactionText(narrativeText.slice(head.length, Math.max(head.length, narrativeText.length - tail.length))),
        beforeTokens: tokens,
        afterTokens: nextTokens,
      });
      tokens = nextTokens;
    }
  }

  if (tokens > tokenBudget) {
    const supportIdx = finalPrompt.indexOf("SUPPORTING STORY CONTEXT:");
    const altIdx = finalPrompt.indexOf("STORY-GROUNDED DETAILS:");
    const removeIdx = supportIdx !== -1 ? supportIdx : altIdx;
    if (removeIdx !== -1) {
      const nextSection = finalPrompt.indexOf("\n## ", removeIdx + 1);
      if (nextSection !== -1) {
        const removedSection = finalPrompt.slice(removeIdx, nextSection);
        finalPrompt = finalPrompt.slice(0, removeIdx) + finalPrompt.slice(nextSection);
        const nextTokens = roughTokenEstimate(finalPrompt);
        compactions.push({
          stage: "supporting_context_removed",
          removedSection: removedSection.split("\n")[0].replace(/:$/, ""),
          removedPreview: summarizePromptCompactionText(removedSection),
          beforeTokens: tokens,
          afterTokens: nextTokens,
        });
        tokens = nextTokens;
      }
    }
  }

  if (tokens > tokenBudget) {
    const detailsIdx = finalPrompt.indexOf("KEY DETAILS:");
    if (detailsIdx !== -1) {
      const detailsEnd = finalPrompt.indexOf("\n", detailsIdx + 200);
      const detailsSection = finalPrompt.slice(detailsIdx, detailsEnd !== -1 ? detailsEnd : undefined);
      const lines = detailsSection.split("\n").filter(l => l.startsWith("- "));
      if (lines.length > 5) {
        const droppedLines = lines.slice(5);
        const truncated = `KEY DETAILS:\n${lines.slice(0, 5).join("\n")}`;
        finalPrompt = finalPrompt.replace(detailsSection, truncated);
        const nextTokens = roughTokenEstimate(finalPrompt);
        compactions.push({
          stage: "key_details_trimmed",
          keptCount: 5,
          droppedCount: droppedLines.length,
          droppedPreview: summarizePromptCompactionText(droppedLines.join(" | ")),
          beforeTokens: tokens,
          afterTokens: nextTokens,
        });
        tokens = nextTokens;
      }
    }
  }

  if (tokens > tokenBudget && narrativeText) {
    const proseOmission = "[Full story prose omitted after extracting the binding detail ledger and song map. Use the ledger as the source of truth.]";
    const beforeChars = finalPrompt.length;
    if (finalPrompt.includes(narrativeText)) {
      finalPrompt = finalPrompt.replace(narrativeText, proseOmission);
    } else {
      finalPrompt = finalPrompt.replace(/\[Story prose compacted\. Required details are preserved in the binding detail ledger\.\][\s\S]*?(?=\n[A-Z][A-Z\s()/-]+:|\n## |\n$)/, proseOmission);
    }
    const nextTokens = roughTokenEstimate(finalPrompt);
    if (nextTokens < tokens) {
      compactions.push({
        stage: "story_prose_replaced_by_ledger",
        removedChars: Math.max(0, beforeChars - finalPrompt.length),
        removedPreview: "Full prose removed after ledger extraction",
        beforeTokens: tokens,
        afterTokens: nextTokens,
      });
      tokens = nextTokens;
    }
  }

  if (tokens > tokenBudget) {
    const briefIdx = finalPrompt.indexOf("## SONG BRIEF");
    const taskIdx = finalPrompt.indexOf("## YOUR TASK");
    if (briefIdx !== -1 && taskIdx !== -1 && taskIdx > briefIdx) {
      const header = finalPrompt.slice(0, briefIdx);
      const brief = finalPrompt.slice(briefIdx, taskIdx);
      const tail = finalPrompt.slice(taskIdx);
      const headerTokens = roughTokenEstimate(header);
      const tailTokens = roughTokenEstimate(tail);
      const briefBudget = (tokenBudget - headerTokens - tailTokens) * 4;
      if (briefBudget > 200) {
        const truncatedBrief = brief.slice(0, briefBudget);
        const lastNewline = truncatedBrief.lastIndexOf("\n");
        const cleanBrief = lastNewline > 100 ? truncatedBrief.slice(0, lastNewline + 1) : truncatedBrief;
        const removedBriefTail = brief.slice(cleanBrief.length);
        finalPrompt = `${header}${cleanBrief}\n\n${tail}`;
        const nextTokens = roughTokenEstimate(finalPrompt);
        compactions.push({
          stage: "song_brief_hard_cap",
          removedChars: Math.max(0, removedBriefTail.length),
          removedPreview: summarizePromptCompactionText(removedBriefTail),
          beforeTokens: tokens,
          afterTokens: nextTokens,
        });
        tokens = nextTokens;
      }
    }
  }

  return {
    prompt: finalPrompt,
    tokens,
    tokenBudget,
    initialTokens,
    initialChars,
    finalChars: finalPrompt.length,
    removedCharsTotal: Math.max(0, initialChars - finalPrompt.length),
    compactions,
  };
}

module.exports = {
  applySongwriterPromptBudget,
  roughTokenEstimate,
  summarizePromptCompactionText,
};
