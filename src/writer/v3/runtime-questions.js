const {
  generateTargetedFallbackQuestion,
  validateQuestionRelevance,
} = require("./quality");

const LABOV_QUESTION_ELEMENTS = ["orientation", "complicating_action", "evaluation", "resolution"];
const QUESTION_DETAIL_STOP_WORDS = new Set([
  "about", "after", "again", "always", "because", "before", "being", "between",
  "could", "every", "first", "from", "have", "into", "just", "made", "make",
  "more", "really", "should", "something", "still", "that", "their", "them",
  "there", "they", "this", "what", "when", "where", "which", "while", "with",
  "would", "your", "you", "were", "then", "than", "like", "felt", "feel",
]);
const GENERIC_LLM_QUESTION_REGEX = /\b(tell me more|can you tell me more|share more|say more|what else|anything else|more about|what's something|could you tell me a bit more)\b/i;

function tokenizeQuestionKeywords(text) {
  if (typeof text !== "string") return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !QUESTION_DETAIL_STOP_WORDS.has(token));
}

function inferAskedQuestionElement(question) {
  for (const element of LABOV_QUESTION_ELEMENTS) {
    if (validateQuestionRelevance(question, element)) return element;
  }
  return null;
}

function getQuestionDetailSignal(question, state, userMessage) {
  const questionKeywords = new Set(tokenizeQuestionKeywords(question));
  if (questionKeywords.size === 0) {
    return { hasRecipientMatch: false, hasStoryDetailMatch: false };
  }

  const recipientKeywords = new Set(
    String(state?.recipient_name || state?.atoms?.who || "")
      .split(/\s+/)
      .map((token) => token.toLowerCase().replace(/[^a-z0-9']/g, ""))
      .filter((token) => token.length >= 3),
  );

  const detailKeywords = new Set();
  for (const token of tokenizeQuestionKeywords(userMessage || "")) detailKeywords.add(token);
  const activeFacts = Array.isArray(state?.facts)
    ? state.facts.filter((fact) => (fact?.status || "active") === "active").slice(-6)
    : [];
  for (const fact of activeFacts) {
    for (const token of tokenizeQuestionKeywords(fact?.text || "")) {
      detailKeywords.add(token);
    }
  }
  for (const detail of Array.isArray(state?.story_state?.sensoryDetails) ? state.story_state.sensoryDetails : []) {
    for (const token of tokenizeQuestionKeywords(detail)) {
      detailKeywords.add(token);
    }
  }

  let hasRecipientMatch = false;
  let hasStoryDetailMatch = false;
  for (const token of questionKeywords) {
    if (recipientKeywords.has(token)) hasRecipientMatch = true;
    if (detailKeywords.has(token)) hasStoryDetailMatch = true;
  }

  return { hasRecipientMatch, hasStoryDetailMatch };
}

function isSubstantiveQuestion(question) {
  const words = String(question || "").trim().split(/\s+/).filter(Boolean);
  return words.length >= 6 || String(question || "").trim().length >= 32;
}

function shouldSoftPassQuestion(question, state, userMessage) {
  const detailSignal = getQuestionDetailSignal(question, state, userMessage);
  return isSubstantiveQuestion(question)
    && !GENERIC_LLM_QUESTION_REGEX.test(question)
    && (detailSignal.hasStoryDetailMatch || detailSignal.hasRecipientMatch);
}

function chooseRuntimeFallbackQuestion(targetElement, state, userMessage, gapQuestion) {
  const recipientFirst = (state?.recipient_name || "them").split(/\s/)[0];
  return generateTargetedFallbackQuestion(targetElement, state, userMessage)
    || gapQuestion?.prompt
    || `What's something about ${recipientFirst} that always stays with you?`;
}

module.exports = {
  LABOV_QUESTION_ELEMENTS,
  QUESTION_DETAIL_STOP_WORDS,
  GENERIC_LLM_QUESTION_REGEX,
  tokenizeQuestionKeywords,
  inferAskedQuestionElement,
  getQuestionDetailSignal,
  isSubstantiveQuestion,
  shouldSoftPassQuestion,
  chooseRuntimeFallbackQuestion,
};
