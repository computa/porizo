/**
 * Question Generator
 *
 * Generates context-aware, dynamic questions to extract the story.
 * Each question is informed by:
 * - What gaps remain (from the story model)
 * - What the user has already shared (context)
 * - Anchors detected in previous answers (dig deeper)
 * - The arc's priorities (love vs gratitude vs celebration)
 */

const { generateText, isAvailable } = require("../services/llm-provider");

/**
 * Generate the next question based on current story context
 *
 * @param {Object} storyContext - Current story state
 * @param {Object} model - The story model (love, gratitude, celebration)
 * @returns {Promise<Object>} { question, elementTarget, reasoning }
 */
async function generateNextQuestion(storyContext, model) {
  // 1. Find what's missing
  const gaps = model.findGaps(storyContext);

  if (gaps.length === 0) {
    // No gaps - shouldn't happen if isStoryComplete is checked first
    return {
      question: `Is there anything else you'd like to add about ${storyContext.recipient_name}?`,
      elementTarget: "additional",
      reasoning: "All elements filled, asking for extras",
    };
  }

  // 2. Check for pending anchors that need follow-up
  // If user mentioned something specific (laugh, smile, eyes), dig deeper on THAT first
  // But only if the anchor has a meaningful follow-up
  // IMPORTANT: Peek first, only remove after successful use (not shift() which loses anchor on failure)
  const pendingAnchor = storyContext.pendingAnchors?.[0];
  if (pendingAnchor && !pendingAnchor.used && pendingAnchor.followUp) {
    const followUpQuestion = await generateAnchorFollowUp(
      pendingAnchor,
      storyContext,
      model
    );
    if (followUpQuestion && followUpQuestion.question) {
      // Only remove anchor after successfully generating follow-up
      storyContext.pendingAnchors.shift();
      return followUpQuestion;
    }
  }

  // 3. Get the highest priority gap
  const priorityGap = gaps[0];

  // 4. Generate a contextual question for this gap
  if (isAvailable()) {
    try {
      return await generateQuestionWithLLM(priorityGap, storyContext, model);
    } catch (err) {
      console.error("[Question Generator] LLM failed, using fallback:", err.message);
    }
  }

  // 5. Fallback to template question
  return generateFallbackQuestion(priorityGap, storyContext);
}

/**
 * Generate a follow-up question based on an anchor detected in previous answer
 */
async function generateAnchorFollowUp(anchor, storyContext, _model) {
  const recipientName = storyContext.recipient_name;

  // If we have LLM, generate a contextual follow-up
  if (isAvailable()) {
    try {
      const prompt = `You are helping someone tell their story about ${recipientName} for a ${storyContext.arcContext.arcDisplayName}.

They just mentioned: "${anchor.word}"

Their context so far: "${buildContextSummary(storyContext)}"

Generate ONE short, conversational follow-up question that digs deeper into what they mentioned about "${anchor.word}".

The question should:
- Be warm and curious, not interrogative
- Help them share more sensory or emotional details
- Be 10-15 words maximum
- Use ${recipientName}'s name naturally if appropriate

Return ONLY the question, no explanation.`;

      const response = await generateText({
        prompt,
        taskType: "simple",
        temperature: 0.7,
      });

      const question = response.text.trim().replace(/^["']|["']$/g, "");

      return {
        question,
        elementTarget: anchor.element || anchor.sourceElement || "sensory_anchor",
        reasoning: `Following up on anchor: ${anchor.word}`,
        isFollowUp: true,
      };
    } catch (err) {
      console.error("[Question Generator] Anchor follow-up failed:", err.message);
    }
  }

  // Fallback - make it specific to the anchor word
  const followUpText =
    typeof anchor.followUp === "string" && anchor.followUp.trim().length > 0
      ? anchor.followUp.trim()
      : null;
  const fallbackQuestion = followUpText ||
    `What was it about ${anchor.word === "laugh" ? "that laugh" :
      anchor.word === "smile" ? "that smile" :
      anchor.word === "eyes" ? "their eyes" :
      `that ${anchor.word}`} that stayed with you?`;

  return {
    question: fallbackQuestion,
    elementTarget: anchor.element || anchor.sourceElement || "sensory_anchor",
    reasoning: `Fallback follow-up for anchor: ${anchor.word}`,
    isFollowUp: true,
  };
}

/**
 * Generate a question using LLM for a specific gap
 */
async function generateQuestionWithLLM(gap, storyContext, _model) {
  const recipientName = storyContext.recipient_name;
  const element = gap.element;
  const arcContext = storyContext.arcContext;

  // Build context from what we already know
  const contextSummary = buildContextSummary(storyContext);

  const prompt = `You are a skilled interviewer helping someone craft a deeply personal story about ${recipientName} for a ${arcContext.arcDisplayName}.

## WHAT WE KNOW SO FAR
Initial prompt: "${storyContext.initial_prompt}"
${contextSummary ? `Details gathered: ${contextSummary}` : "No details yet."}

## WHAT WE NEED
We need to understand: "${element.name}" - ${element.description}

## ARC FOCUS
This is a ${arcContext.arcDisplayName}. ${arcContext.emotionalGoal}.
We're seeking: ${arcContext.seekPhrases.join(", ")}

## YOUR TASK
Generate ONE question that:
1. Builds naturally on what they've already shared
2. Helps them reveal ${element.description}
3. Is warm, conversational, curious - NOT interrogative
4. Uses ${recipientName}'s name where natural
5. Is 8-15 words (short and easy to answer)
6. Invites a specific, detailed response - not yes/no

Example style: "${element.exampleQuestion.replace("{recipient}", recipientName)}"

Return ONLY the question. No explanation, no quotes.`;

  const response = await generateText({
    prompt,
    taskType: "simple",
    temperature: 0.8,
  });

  const question = response.text.trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^\d+\.\s*/, ""); // Remove numbering if present

  return {
    question,
    elementTarget: gap.elementId,
    reasoning: `Filling gap: ${element.name}`,
  };
}

/**
 * Generate fallback question from template (no LLM)
 */
function generateFallbackQuestion(gap, storyContext) {
  const recipientName = storyContext.recipient_name;
  const element = gap.element;

  // Use the example question from the model, replacing placeholder
  let question = element.exampleQuestion || element.questionHints?.[0] || "Tell me more.";
  question = question.replace(/\{recipient\}/g, recipientName);

  // Make sure we have a good question, not just "Tell me more"
  if (question === "Tell me more." && element.questionHints?.length > 0) {
    // Try a random hint
    const hint = element.questionHints[Math.floor(Math.random() * element.questionHints.length)];
    question = hint.includes(recipientName) ? hint : hint;
  }

  return {
    question,
    elementTarget: gap.elementId,
    reasoning: `Fallback question for: ${element.name}`,
    isFallback: true,
  };
}

/**
 * Generate story summary for user confirmation
 *
 * @param {Object} storyContext - Current story state
 * @param {Object} model - The story model
 * @returns {Promise<Object>} { summary_text, soul }
 */
async function generateStorySummary(storyContext, model) {
  const recipientName = storyContext.recipient_name;
  const arcContext = model.getArcContext();

  // Build the raw story from elements
  const storyParts = [];

  // Start with initial prompt context
  if (storyContext.initial_prompt) {
    storyParts.push(`Initial: ${storyContext.initial_prompt}`);
  }

  // Add each element's content
  for (const [elementId, content] of Object.entries(storyContext.elements)) {
    if (content && content.trim()) {
      const elementName = model.STORY_ELEMENTS[elementId]?.name || elementId;
      storyParts.push(`${elementName}: ${content}`);
    }
  }

  const rawStory = storyParts.join("\n");

  if (isAvailable()) {
    try {
      const prompt = `You are summarizing a personal story about ${recipientName} for a ${arcContext.arcDisplayName}.

## RAW STORY DETAILS
${rawStory}

## YOUR TASK
1. Write a 3-5 sentence summary that flows naturally as a mini-narrative
2. Identify the "soul" of this story - the 1-2 most powerful, specific details that will make ${recipientName} feel truly seen

## FORMAT
Return JSON only:
{
  "summary_text": "A flowing narrative summary...",
  "soul": "The most powerful specific detail(s)"
}

Make the summary feel like you're telling a friend about this beautiful story. Be specific, not generic.`;

      const response = await generateText({
        prompt,
        taskType: "simple",
        temperature: 0.6,
      });

      try {
        const parsed = JSON.parse(response.text);
        return {
          summary_text: parsed.summary_text || buildFallbackSummary(storyContext, recipientName),
          soul: parsed.soul || "The specific details of your story",
        };
      } catch (parseErr) {
        // If JSON parse fails, use the text as summary
        return {
          summary_text: response.text.slice(0, 500),
          soul: "Your unique story",
        };
      }
    } catch (err) {
      console.error("[Question Generator] Summary generation failed:", err.message);
    }
  }

  // Fallback summary
  return {
    summary_text: buildFallbackSummary(storyContext, recipientName),
    soul: extractSoulFallback(storyContext),
  };
}

/**
 * Build context summary from story elements
 */
function buildContextSummary(storyContext) {
  const parts = [];

  for (const [, value] of Object.entries(storyContext.elements)) {
    if (value && value.trim()) {
      parts.push(value.trim());
    }
  }

  return parts.join(" ").slice(0, 300);
}

/**
 * Build fallback summary without LLM
 */
function buildFallbackSummary(storyContext, recipientName) {
  const parts = [`Here's your story about ${recipientName}:`];

  if (storyContext.initial_prompt) {
    parts.push(storyContext.initial_prompt);
  }

  const elementValues = Object.values(storyContext.elements).filter(Boolean);
  if (elementValues.length > 0) {
    parts.push(elementValues.join(" "));
  }

  return parts.join(" ").slice(0, 500);
}

/**
 * Extract "soul" without LLM - find most specific detail
 */
function extractSoulFallback(storyContext) {
  // Look for the most specific/unique content
  const candidates = [];

  for (const [key, value] of Object.entries(storyContext.elements)) {
    if (value && value.length > 20) {
      // Prefer sensory and emotional elements
      if (key.includes("sensory") || key.includes("emotional") || key.includes("special")) {
        candidates.unshift(value.slice(0, 100));
      } else {
        candidates.push(value.slice(0, 100));
      }
    }
  }

  return candidates[0] || "The details that make your story unique";
}

module.exports = {
  generateNextQuestion,
  generateStorySummary,
};
