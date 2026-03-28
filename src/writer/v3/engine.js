/**
 * V3 Engine Core
 *
 * Handles state integration, conversation tracking, and fallback heuristics.
 * This module connects the reasoner output to the state management layer.
 *
 * @module writer/v3/engine
 */

const { DEFAULT_BEATS, getStatusFromStrength } = require("./beats");
const {
  isAppendStyleNarrative,
  composeNarrativeFromFacts,
  getActiveFacts,
  hasRecipientAnchor,
  hasFirstPersonVoice,
  narrativeNeedsPovAlignment,
  resolveDesiredNarrativePov,
  rewriteNarrativeToRecipientFocus,
  selectAnchorFacts,
  narrativeCoversAnchors,
} = require("./narrative");
const { assessStateGrounding, createFactId } = require("./state");
const { normalizeOccasion, normalizeText } = require("./utils");

/**
 * Occasion-based suggestion chips for story questions.
 * These provide contextual prompts to help users articulate their stories.
 */
const OCCASION_SUGGESTIONS = {
  birthday: {
    default: [
      "A tradition we always have",
      "The gift that meant the most",
      "A birthday that didn't go as planned",
    ],
    who: ["My best friend", "My partner", "My parent"],
    moment: [
      "The surprise party we planned",
      "When they blew out the candles",
      "The look on their face when they saw the gift",
    ],
    feeling: [
      "So grateful for another year together",
      "Proud of who they've become",
      "Like time is flying by too fast",
    ],
    want: ["I wanted to make it unforgettable", "They just wanted everyone together", "We hoped to surprise them"],
    blocker: ["The plans almost fell apart", "Something unexpected came up", "We nearly didn't make it"],
    stakes: ["This was their milestone year", "We might not get another chance like this", "It would've meant starting over"],
    turn: ["Then they walked through the door", "That's when everything clicked", "The moment I saw their face"],
    ending_feel: ["It felt like everything came together", "I'll never forget that feeling", "That's when I knew it mattered"],
  },
  anniversary: {
    default: [
      "Our first date memory",
      "A challenge we overcame together",
      "The little things they do daily",
    ],
    moment: ["When I knew they were the one", "Our wedding day", "A trip we took together"],
    feeling: ["Deeply in love", "Grateful for our journey", "Excited for our future"],
    want: ["We both wanted the same thing", "I just wanted to be closer to them", "We dreamed of building something"],
    blocker: ["We almost didn't make it", "Distance kept pulling us apart", "We had to fight for it"],
    stakes: ["Everything we'd built was on the line", "It could've gone a different way", "This was the moment that mattered most"],
    turn: ["Then something shifted between us", "That one conversation changed everything", "The moment we chose each other again"],
    ending_feel: ["Like we'd found our way back", "Stronger than we started", "Grateful for every step"],
  },
  thank_you: {
    default: [
      "When they went out of their way",
      "A sacrifice they made for me",
      "How they showed up when it mattered",
    ],
    moment: ["The time they dropped everything to help", "A small gesture that meant everything", "When they believed in me"],
    feeling: ["Forever grateful", "Like I don't say it enough", "Overwhelmed by their kindness"],
    want: ["I needed someone in my corner", "I was searching for support", "I hoped someone would notice"],
    blocker: ["Things were falling apart around me", "I didn't think anyone would help", "I was too proud to ask"],
    stakes: ["I might not have made it through", "Everything was riding on that moment", "It could've ended differently"],
    turn: ["Then they showed up out of nowhere", "That one act changed my path", "When they said the words I needed"],
    ending_feel: ["Like I finally wasn't alone", "Grateful beyond what words can say", "Knowing they'd always be there"],
  },
  celebration: {
    default: [
      "What makes them special",
      "A proud moment we shared",
      "Why they deserve to be celebrated",
    ],
    moment: ["Their biggest achievement", "When everyone cheered for them", "A goal they finally reached"],
    feeling: ["So proud of them", "Inspired by their dedication", "Happy to witness their success"],
    want: ["They always dreamed of this", "It was all they worked toward", "We were rooting for them"],
    blocker: ["People doubted them along the way", "They almost gave up once", "The odds were stacked against them"],
    stakes: ["This was their one shot", "Years of effort on the line", "It meant everything to them"],
    turn: ["Then the moment finally came", "When they proved everyone wrong", "The day it all paid off"],
    ending_feel: ["Pure joy and relief", "Like watching a dream come true", "Proud doesn't even cover it"],
  },
  "mothers-day": {
    default: ["A sacrifice she made for us", "Her daily acts of love", "What I learned from her"],
    moment: ["When she comforted me", "The advice that changed everything", "A tradition we share"],
    feeling: ["Deeply grateful for everything", "Like I could never repay her", "Proud to be her child"],
    want: ["She just wanted us to be happy", "All she asked for was our time", "She gave up so we could have more"],
    blocker: ["She carried it all alone sometimes", "Life wasn't easy but she never showed it", "She faced things no one knew about"],
    stakes: ["Without her we wouldn't have made it", "She held the family together", "Everything we have is because of her"],
    turn: ["Then I realized what she'd done for us", "The moment I saw her differently", "When I finally understood"],
    ending_feel: ["Like no words could be enough", "Grateful for every single thing", "Wanting her to know she matters"],
  },
  "fathers-day": {
    default: ["A lesson he taught me", "How he shows his love", "What I admire most about him"],
    moment: ["When he was there for me", "A memory from my childhood", "Something we do together"],
    feeling: ["Grateful for his guidance", "Proud to be his child", "Like he's my role model"],
    want: ["He wanted us to be strong", "He worked so we wouldn't have to struggle", "All he hoped was that we'd be okay"],
    blocker: ["He never let us see him tired", "He put his own dreams aside", "He carried weight he never spoke about"],
    stakes: ["Everything he built was for us", "Without his sacrifice things would've been different", "He gave up his time so we'd have ours"],
    turn: ["The day I saw him as more than just dad", "When I understood what he'd been doing all along", "That moment everything made sense"],
    ending_feel: ["Like I finally see the full picture", "Proud and grateful beyond words", "Wanting him to know it mattered"],
  },
  graduation: {
    default: ["The journey to get here", "A challenge they overcame", "What this achievement means"],
    moment: ["Late nights studying together", "When they got the acceptance letter", "The moment they walked across the stage"],
    feeling: ["So proud of their hard work", "Excited for their future", "Amazed at how far they've come"],
    want: ["They always wanted to prove themselves", "This was the dream from the start", "They set out to make it happen"],
    blocker: ["There were times they wanted to quit", "Not everyone believed they could do it", "The pressure was overwhelming"],
    stakes: ["Years of sacrifice led to this", "So much was riding on this moment", "Failing would've meant starting over"],
    turn: ["Then they found their second wind", "The moment they realized they could do it", "When it all started falling into place"],
    ending_feel: ["Like watching them become who they're meant to be", "Relief mixed with pure pride", "Knowing the best is still ahead"],
  },
  advice: {
    default: ["The lesson I wish I learned sooner", "A fork in the road they're facing", "The value I hope they protect"],
    moment: ["A decision that changed my life", "When I had to choose courage over comfort", "The advice I once ignored"],
    feeling: ["Protective and hopeful", "Confident they'll make it through", "Like this next chapter matters deeply"],
    want: ["I want them to know it gets better", "I hope they hold onto this", "I want them to trust themselves"],
    blocker: ["The world will try to tell them otherwise", "Fear makes it hard to see clearly", "It's easy to lose your way"],
    stakes: ["These choices shape everything after", "This is the moment that defines the path", "What they do now matters more than they think"],
    turn: ["When I stopped listening to doubt", "The day I chose my own direction", "That one choice that changed everything"],
    ending_feel: ["Like passing a torch forward", "Hopeful for what they'll build", "Knowing they have what it takes"],
  },
  bereavement: {
    default: ["A memory that still makes me smile", "What we want to remember most", "How their presence changed us"],
    moment: ["A small ritual we'll always keep", "The last time we laughed together", "A detail that brings comfort"],
    feeling: ["Heartbroken but grateful", "Held by love despite the loss", "Comforted by what remains"],
    want: ["They wanted us to be happy", "All they ever asked for was love", "They lived for the people around them"],
    blocker: ["We never thought this day would come", "There was so much left unsaid", "Time moved too fast"],
    stakes: ["They were the heart of our family", "Without them everything feels different", "What they gave us can't be replaced"],
    turn: ["The last time I saw them clearly", "A quiet moment that stays with me", "When I felt their love most"],
    ending_feel: ["Like they're still with us somehow", "Grateful for the time we had", "Carrying them forward in everything"],
  },
  // --- Occasions from iOS enum not previously covered ---
  i_love_you: {
    default: ["The first time I knew", "What I love most about them", "A quiet moment between us"],
    moment: ["When they said something that stayed with me", "A night I'll never forget", "The time they surprised me"],
    feeling: ["Like I found where I belong", "Safe in a way I can't explain", "Completely seen by someone"],
    want: ["I just wanted to be near them", "I hoped this feeling would last", "I wanted them to know"],
    blocker: ["I was afraid to say it first", "Life kept getting in the way", "I didn't think I deserved this"],
    stakes: ["This love changed how I see everything", "Losing them would break something in me", "They became my whole world"],
    turn: ["Then one ordinary moment made it real", "When I stopped questioning it", "The day I knew for sure"],
    ending_feel: ["Like the best part is still unfolding", "Grateful every single day", "Knowing this is it"],
  },
  wedding: {
    default: ["The moment we said yes", "How we knew they were the one", "A promise we're making"],
    moment: ["The proposal story", "When we first met", "The day we chose each other"],
    feeling: ["Overwhelmed with joy", "Ready for forever", "Like everything led to this"],
    want: ["We wanted a love that lasts", "We chose to build this together", "We dreamed of this day"],
    blocker: ["The road here wasn't always smooth", "We had to fight for us", "Not everyone understood at first"],
    stakes: ["This is the beginning of everything", "Two lives becoming one", "A promise we won't break"],
    turn: ["Then I looked at them and just knew", "The moment I stopped imagining life alone", "When they said the words"],
    ending_feel: ["Like the world is full of possibility", "Complete in a way I can't describe", "Ready for whatever comes next"],
  },
  apology: {
    default: ["What I wish I'd said then", "The moment I realized I was wrong", "What they mean to me"],
    moment: ["When I saw how it affected them", "The silence that said everything", "A look I'll never forget"],
    feeling: ["Regret that I carry", "Desperate to make it right", "Hoping they can forgive me"],
    want: ["I wanted to take it back immediately", "I just want them to know I see it", "I hope they'll give me another chance"],
    blocker: ["My pride got in the way", "I didn't know how to say sorry", "I was too stubborn to admit it"],
    stakes: ["I could lose someone who matters deeply", "This mistake could define us", "What we have is worth saving"],
    turn: ["Then I realized what I'd done", "The moment it hit me", "When I finally saw their side"],
    ending_feel: ["Humble and hopeful", "Willing to do the work", "Knowing they deserve better from me"],
  },
  encouragement: {
    default: ["What I see in them", "A time they didn't give up", "Why I believe in them"],
    moment: ["When they showed their strength", "A small win that meant everything", "The day they surprised us all"],
    feeling: ["So proud of their courage", "Believing in them completely", "Inspired by who they're becoming"],
    want: ["I want them to keep going", "I hope they trust themselves", "I want them to see what I see"],
    blocker: ["The doubt that holds them back", "Voices telling them they can't", "The fear of not being good enough"],
    stakes: ["They're closer than they think", "Giving up now would mean losing it all", "This matters more than they realize"],
    turn: ["The moment I saw the fire in them", "When they took that first brave step", "Then something in them shifted"],
    ending_feel: ["Like they're about to amaze everyone", "Confident in their path", "Knowing they were made for this"],
  },
  // `custom` occasion intentionally falls through to `celebration` defaults via resolveOccasionSuggestions().
  // No dedicated entries — custom covers too wide a range for targeted suggestions.
};

const SLOT_SUGGESTION_KEY_ALIASES = {
  moment_destination: "moment",
};

const SHARED_SLOT_SUGGESTIONS = {
  tone: [
    "Warm and heartfelt",
    "Honest and a little raw",
    "Playful but still sincere",
  ],
};

const ELEMENT_SUGGESTIONS = {
  birthday: {
    feeling: [
      "Grateful beyond words",
      "Like time stopped for a moment",
      "I wanted them to feel seen",
    ],
    bond: [
      "How we became close",
      "The thing only we understand",
      "What they do that nobody else does",
    ],
  },
  anniversary: {
    feeling: [
      "Still feels unreal sometimes",
      "Like home every time",
      "Grateful we found each other",
    ],
    bond: [
      "What only we have together",
      "How we got through the hard parts",
      "Why being with them feels different",
    ],
  },
  thank_you: {
    feeling: [
      "Grateful in a way I can't explain",
      "Like they carried me through it",
      "I still feel that kindness now",
    ],
    bond: [
      "Why they showed up for me",
      "What kind of person they are",
      "How they always know what I need",
    ],
  },
  celebration: {
    feeling: [
      "Proud in a way that hits deep",
      "Like this moment was earned",
      "So happy to witness it",
    ],
    bond: [
      "Why I wanted this for them",
      "What makes them special to me",
      "Why their win feels personal too",
    ],
  },
  i_love_you: {
    feeling: [
      "Like I finally felt safe",
      "Like everything softened at once",
      "I knew it mattered right then",
    ],
    bond: [
      "What only they understand about me",
      "Why being with them feels easy",
      "How they changed my world quietly",
    ],
  },
  apology: {
    feeling: [
      "I still carry the regret",
      "I wish I could take it back",
      "I just want to make it right",
    ],
    bond: [
      "Why losing them would hurt",
      "What they mean to me now",
      "Why this relationship matters so much",
    ],
  },
  encouragement: {
    feeling: [
      "I know they have more in them",
      "I believe in them deeply",
      "I can feel the turning point coming",
    ],
    bond: [
      "Why I know what they're capable of",
      "What I've seen in them before",
      "How they've already shown their strength",
    ],
  },
};

const _occasionCache = new Map();
function resolveOccasionSuggestions(occasion) {
  const normalized = normalizeOccasion(occasion) || "celebration";
  if (_occasionCache.has(normalized)) return _occasionCache.get(normalized);

  const apostropheFolded = normalized.replace(/['’]/g, "");
  const result =
    OCCASION_SUGGESTIONS[normalized] ||
    OCCASION_SUGGESTIONS[apostropheFolded] ||
    OCCASION_SUGGESTIONS[normalized.replace(/-/g, "_")] ||
    OCCASION_SUGGESTIONS[normalized.replace(/_/g, "-")] ||
    OCCASION_SUGGESTIONS[apostropheFolded.replace(/-/g, "_")] ||
    OCCASION_SUGGESTIONS.celebration;
  _occasionCache.set(normalized, result);
  return result;
}

function getSlotSuggestions(occasion, targetSlot) {
  const occasionSugs = resolveOccasionSuggestions(occasion);
  const suggestionKey = SLOT_SUGGESTION_KEY_ALIASES[targetSlot] || targetSlot;
  const slotSugs = occasionSugs?.[suggestionKey];
  if (Array.isArray(slotSugs) && slotSugs.length > 0) {
    return slotSugs.slice(0, 3);
  }

  const sharedSlotSugs = SHARED_SLOT_SUGGESTIONS[suggestionKey];
  return Array.isArray(sharedSlotSugs) ? sharedSlotSugs.slice(0, 3) : [];
}

function getOccasionDefaultSuggestions(occasion) {
  const occasionSugs = resolveOccasionSuggestions(occasion);
  return occasionSugs?.default || OCCASION_SUGGESTIONS.celebration.default || [];
}

function getElementSuggestions(occasion, elementId) {
  if (!elementId) return [];
  const normalized = normalizeOccasion(occasion) || "celebration";
  const apostropheFolded = normalized.replace(/['’]/g, "");
  const elementSugs =
    ELEMENT_SUGGESTIONS[normalized] ||
    ELEMENT_SUGGESTIONS[apostropheFolded] ||
    ELEMENT_SUGGESTIONS[normalized.replace(/-/g, "_")] ||
    ELEMENT_SUGGESTIONS[normalized.replace(/_/g, "-")] ||
    ELEMENT_SUGGESTIONS[apostropheFolded.replace(/-/g, "_")] ||
    ELEMENT_SUGGESTIONS.celebration;

  const suggestions = elementSugs?.[elementId];
  return Array.isArray(suggestions) ? suggestions.slice(0, 3) : [];
}

const FALLBACK_RELATION_REGEX = /\bmy\s+(mom|mum|mother|dad|father|parent|sister|brother|friend|partner|wife|husband|son|daughter|child|mentor|teacher|grandma|grandpa|aunt|uncle|cousin|colleague|boss)\b/i;
const FALLBACK_PLACE_REGEX = /\b(?:at|in|inside|on|near|by)\s+([a-z0-9][a-z0-9' -]{2,64})/i;
const FALLBACK_TIME_REGEX = /\b(?:last|this|next)\s+(?:night|morning|afternoon|evening|week|month|year|winter|summer|spring|autumn)\b|\b(?:yesterday|today|tonight|recently)\b|\bin\s+\d{4}\b|\bwhen i was \d+\b/i;
const FALLBACK_WANT_REGEX = /\b(?:i|we|they)\s+(?:want(?:ed)?|hope(?:d)?|need(?:ed)?|dream(?:ed)?|tr(?:y|ied|ying))\b/i;
const FALLBACK_BLOCKER_REGEX = /\b(couldn't|could not|can't|cannot|afraid|fear|shame|pressure|blocked|stopped|prevented|barrier|obstacle|challenge|conflict)\b/i;
const FALLBACK_STAKES_REGEX = /\bif\b[^.?!]{0,120}\b(lose|lost|risk|cost|fail(?:ed)?)\b/i;
const FALLBACK_TURN_REGEX = /\b(then|suddenly|at that moment|everything changed|i decided|we decided|i realized|we realized)\b/i;
const FALLBACK_TURN_MEMORY_REGEX = /\b(i(?:'|’)ll never forget|i will never forget|i(?:'|’)ll always remember|i will always remember)\b/i;
const FALLBACK_TURN_EVENT_REGEX = /\b(high[- ]risk|bleeding|hospital|pregnan(?:cy|t)|twins?|accident|diagnosis|funeral|graduation|wedding|birth|delivery|labou?r)\b/i;
const FALLBACK_AFTER_REGEX = /\b(after that|since then|in the end|eventually|from then on|now)\b/i;
const FALLBACK_GROWTH_REGEX = /\b(watched\s+you\s+become|watched\s+him\s+become|watched\s+her\s+become|grow(?:n)?\s+into|became|become|turned\s+into|made\s+me\s+(?:love|respect|admire)|love\s+and\s+respect|proud\s+of)\b/i;
const FALLBACK_MEANING_REGEX = /\b(i\s+want\s+you\s+to\s+know|i(?:'m| am)\s+grateful|thank\s+you|this\s+means|because\s+of\s+you|you\s+are\s+the\s+heart|you\s+made\s+.*\s+feel\s+like\s+home)\b/i;
const FALLBACK_TONE_TERMS = ["cinematic", "realistic", "playful", "gentle", "dramatic", "comedic", "romantic", "raw", "poetic", "upbeat", "melancholic"];
const MAX_EXTRACTED_FACT_LENGTH = 220;
const MAX_FALLBACK_SENTENCES = 16;
const FACT_NEGATION_REGEX = /\b(?:not|never|no longer|didn't|couldn't|cannot|can't|wasn't|weren't|without)\b/i;

function splitSentences(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  return normalized
    .split(/(?<=[.!?])\s+/)
    .map(part => normalizeText(part))
    .filter(Boolean)
    .slice(0, MAX_FALLBACK_SENTENCES);
}

function findTurningPointSentence(sentences) {
  for (const sentence of sentences) {
    if (FALLBACK_TURN_REGEX.test(sentence)) return sentence;
  }

  for (const sentence of sentences) {
    if (FALLBACK_TURN_MEMORY_REGEX.test(sentence) && FALLBACK_TURN_EVENT_REGEX.test(sentence)) {
      return sentence;
    }
  }

  return "";
}

function truncateFactText(text) {
  const normalized = normalizeText(text);
  if (!normalized) return "";
  if (normalized.length <= MAX_EXTRACTED_FACT_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_EXTRACTED_FACT_LENGTH - 1)}…`;
}

function findSentenceByRegex(sentences, regex) {
  return sentences.find(sentence => regex.test(sentence)) || "";
}

function extractPlace(sentences) {
  for (const sentence of sentences) {
    const match = sentence.match(FALLBACK_PLACE_REGEX);
    if (!match || !match[1]) continue;
    const place = normalizeText(match[1].replace(/[.,!?;:]+$/, ""));
    if (!place) continue;
    if (/^(this|that|it|me|him|her|them|us)$/i.test(place)) continue;
    return place;
  }
  return "";
}

function extractWho(text, recipientName = "") {
  const relationMatch = text.match(FALLBACK_RELATION_REGEX);
  if (relationMatch && relationMatch[0]) {
    return normalizeText(relationMatch[0]);
  }
  const recipient = normalizeText(recipientName);
  if (recipient && text.toLowerCase().includes(recipient.toLowerCase())) {
    return recipient;
  }
  return "";
}

function extractTone(text) {
  const lower = text.toLowerCase();
  const tone = FALLBACK_TONE_TERMS.find(term => lower.includes(term));
  return tone || "";
}

function upsertTextField(target, key, value) {
  const nextValue = normalizeText(value);
  if (!nextValue) return target;
  const currentValue = normalizeText(target[key]);
  if (!currentValue || nextValue.length > currentValue.length + 4) {
    target[key] = nextValue;
  }
  return target;
}

function upsertFact(facts, factText, beat, sourceTurn, seen) {
  const text = truncateFactText(factText);
  if (!text) return;
  const normalized = normalizeEvidenceText(text);
  if (!normalized || seen.has(normalized)) return;
  facts.push({
    id: createFactId(text),
    text,
    beat,
    source_turn: sourceTurn,
    status: "active",
    superseded_by: "",
    superseded_at: "",
    supersedes_fact_id: "",
    confidence: 0.75,
  });
  seen.add(normalized);
}

function deriveFallbackPatch(state, userInput) {
  const text = normalizeText(userInput);
  if (!text) return null;

  const sentences = splitSentences(text);
  const who = extractWho(text, state?.recipient_name);
  const where = extractPlace(sentences);
  const when = findSentenceByRegex(sentences, FALLBACK_TIME_REGEX) || "";
  const want = findSentenceByRegex(sentences, FALLBACK_WANT_REGEX) || "";
  const blocker = findSentenceByRegex(sentences, FALLBACK_BLOCKER_REGEX) || "";
  const stakes = findSentenceByRegex(sentences, FALLBACK_STAKES_REGEX) || "";
  const turn = findTurningPointSentence(sentences);
  const after = findSentenceByRegex(sentences, FALLBACK_AFTER_REGEX) || "";
  const growth = findSentenceByRegex(sentences, FALLBACK_GROWTH_REGEX) || "";
  const meaning = findSentenceByRegex(sentences, FALLBACK_MEANING_REGEX) || "";
  const action = sentences[0] || "";
  const dialogueMatch = text.match(/["']([^"']{3,140})["']/);
  const dialogue = dialogueMatch?.[1] ? normalizeText(dialogueMatch[1]) : "";
  const tone = extractTone(text);
  const resolution = after || meaning || growth;
  const theme = meaning || growth;
  const shouldStoreRawContext = text.length <= 260 && sentences.length <= 2;

  return {
    atoms: {
      who,
      where,
      when,
      action,
      stakes,
      turn,
      secret: blocker.toLowerCase().includes("secret") ? blocker : "",
      after,
      dialogue,
    },
    primitives: {
      setting: {
        place: where,
        time: when,
      },
      conflict: {
        internal: /\b(fear|afraid|shame|anxious)\b/i.test(blocker) ? blocker : "",
        external: blocker,
      },
      turning_point: turn,
      resolution,
      inciting_incident: action,
      theme,
    },
    tone,
    context: {
      want,
      blocker,
      stakes,
      turn,
      action,
      meaning,
      growth,
      resolution,
    },
    rawText: text,
    shouldStoreRawContext,
  };
}

/**
 * Apply deterministic extraction on fallback turns where no LLM structure is available.
 *
 * This keeps state moving by patching atoms/primitives/facts from raw user input.
 *
 * @param {Object} state - Current state
 * @param {string} userInput - User-provided text
 * @returns {Object} Updated state
 */
function applyDeterministicFallbackExtraction(state, userInput) {
  const patch = deriveFallbackPatch(state, userInput);
  if (!patch) return state;

  const nextAtoms = { ...(state.atoms || {}) };
  upsertTextField(nextAtoms, "who", patch.atoms.who);
  upsertTextField(nextAtoms, "where", patch.atoms.where);
  upsertTextField(nextAtoms, "when", patch.atoms.when);
  upsertTextField(nextAtoms, "action", patch.atoms.action);
  upsertTextField(nextAtoms, "stakes", patch.atoms.stakes);
  upsertTextField(nextAtoms, "turn", patch.atoms.turn);
  upsertTextField(nextAtoms, "secret", patch.atoms.secret);
  upsertTextField(nextAtoms, "after", patch.atoms.after);
  upsertTextField(nextAtoms, "dialogue", patch.atoms.dialogue);

  const nextPrimitives = JSON.parse(JSON.stringify(state.primitives || {}));
  nextPrimitives.setting = nextPrimitives.setting || {};
  nextPrimitives.conflict = nextPrimitives.conflict || {};

  upsertTextField(nextPrimitives.setting, "place", patch.primitives.setting.place);
  upsertTextField(nextPrimitives.setting, "time", patch.primitives.setting.time);
  upsertTextField(nextPrimitives.conflict, "internal", patch.primitives.conflict.internal);
  upsertTextField(nextPrimitives.conflict, "external", patch.primitives.conflict.external);
  upsertTextField(nextPrimitives, "turning_point", patch.primitives.turning_point);
  upsertTextField(nextPrimitives, "resolution", patch.primitives.resolution);
  upsertTextField(nextPrimitives, "inciting_incident", patch.primitives.inciting_incident);
  upsertTextField(nextPrimitives, "theme", patch.primitives.theme);

  const recipient = normalizeText(state.recipient_name);
  const characters = Array.isArray(nextPrimitives.characters) ? [...nextPrimitives.characters] : [];
  if (recipient && !characters.some(character => normalizeText(character?.name).toLowerCase() === recipient.toLowerCase())) {
    characters.push({
      name: recipient,
      role: normalizeText(nextAtoms.who) || "recipient",
      desire: normalizeText(patch.context.want),
      fear: "",
      flaw: "",
    });
  } else if (recipient) {
    for (const character of characters) {
      if (normalizeText(character?.name).toLowerCase() !== recipient.toLowerCase()) continue;
      if (!normalizeText(character.role) && normalizeText(nextAtoms.who)) {
        character.role = normalizeText(nextAtoms.who);
      }
      if (!normalizeText(character.desire) && normalizeText(patch.context.want)) {
        character.desire = normalizeText(patch.context.want);
      }
    }
  }
  nextPrimitives.characters = characters;

  const nextDials = { ...(state.dials || {}) };
  if (!normalizeText(nextDials.tone) && patch.tone) {
    nextDials.tone = patch.tone;
  }

  const facts = Array.isArray(state.facts) ? [...state.facts] : [];
  const seenFacts = new Set(facts.map(fact => normalizeEvidenceText(fact?.text || "")));
  const sourceTurn = state.turn_count || 1;

  if (patch.shouldStoreRawContext) {
    upsertFact(facts, patch.rawText, "context", sourceTurn, seenFacts);
  }
  upsertFact(facts, patch.atoms.action, "moment", sourceTurn, seenFacts);
  upsertFact(facts, patch.context.want, "meaning", sourceTurn, seenFacts);
  upsertFact(facts, patch.context.blocker, "struggle", sourceTurn, seenFacts);
  upsertFact(facts, patch.context.stakes, "stakes", sourceTurn, seenFacts);
  upsertFact(facts, patch.context.turn, "turning_point", sourceTurn, seenFacts);
  upsertFact(facts, patch.atoms.after, "impact", sourceTurn, seenFacts);
  upsertFact(facts, patch.context.growth, "impact", sourceTurn, seenFacts);
  upsertFact(facts, patch.context.meaning, "meaning", sourceTurn, seenFacts);

  return {
    ...state,
    atoms: nextAtoms,
    primitives: nextPrimitives,
    dials: nextDials,
    facts,
    fallback_extraction: {
      applied: true,
      source: "deterministic_regex",
      turn: sourceTurn,
      updated_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  };
}


function tokenizeSignificant(text) {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[.,!?;:'"]/g, "")
    .split(/\s+/)
    .filter(token => token.length >= 4);
}

function uniqueStringArray(values) {
  const seen = new Set();
  const output = [];
  for (const value of values || []) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    const lower = normalized.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    output.push(normalized);
  }
  return output;
}

function normalizeFactRecord(fact, sourceTurn = 0) {
  if (!fact || typeof fact !== "object") return null;
  const text = normalizeText(fact.text);
  if (!text) return null;
  return {
    id: typeof fact.id === "string" && fact.id.trim() ? fact.id.trim() : createFactId(text),
    text,
    beat: normalizeText(fact.beat) || "detail",
    source_turn: Number.isFinite(Number(fact.source_turn)) ? Number(fact.source_turn) : sourceTurn,
    status: normalizeText(fact.status) || "active",
    superseded_by: normalizeText(fact.superseded_by) || "",
    superseded_at: normalizeText(fact.superseded_at) || "",
    supersedes_fact_id: normalizeText(fact.supersedes_fact_id) || "",
    confidence: typeof fact.confidence === "number" ? Math.max(0, Math.min(1, fact.confidence)) : 0.8,
    evidence: Array.isArray(fact.evidence) ? fact.evidence.filter((id) => typeof id === "string" && id.trim()) : [],
  };
}

function tokenizeFactLedgerText(text) {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4);
}

function scoreTokenSimilarity(a, b) {
  const tokensA = new Set(tokenizeFactLedgerText(a));
  const tokensB = new Set(tokenizeFactLedgerText(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap += 1;
  }
  return overlap / Math.max(tokensA.size, tokensB.size);
}

function shouldSupersedeActiveFact(existingFact, incomingFact) {
  if (!existingFact || !incomingFact) return false;
  if ((existingFact.status || "active") !== "active") return false;
  const existingText = normalizeText(existingFact.text);
  const incomingText = normalizeText(incomingFact.text);
  if (!existingText || !incomingText) return false;

  const existingLower = existingText.toLowerCase();
  const incomingLower = incomingText.toLowerCase();
  if (existingLower === incomingLower) return false;

  const similarity = scoreTokenSimilarity(existingText, incomingText);
  const sameBeat = normalizeText(existingFact.beat).toLowerCase() === normalizeText(incomingFact.beat).toLowerCase();

  if (incomingLower.includes(existingLower) && incomingText.length >= existingText.length + 12) return true;
  if (similarity >= 0.75 && incomingText.length > existingText.length + 6) return true;
  if (sameBeat && similarity >= 0.68 && incomingText.length > existingText.length + 6) return true;

  // Forward coverage: when all existing tokens appear in the incoming text (enrichment pattern)
  if (sameBeat && incomingText.length > existingText.length + 6) {
    const existingTokens = new Set(tokenizeFactLedgerText(existingText));
    const incomingTokens = new Set(tokenizeFactLedgerText(incomingText));
    if (existingTokens.size > 0) {
      let covered = 0;
      for (const t of existingTokens) { if (incomingTokens.has(t)) covered++; }
      if (covered / existingTokens.size >= 0.8) return true;
    }
  }

  return false;
}

function detectPotentialFactConflict(existingFact, incomingFact) {
  if (!existingFact || !incomingFact) return false;
  const existingText = normalizeText(existingFact.text);
  const incomingText = normalizeText(incomingFact.text);
  if (!existingText || !incomingText) return false;
  const similarity = scoreTokenSimilarity(existingText, incomingText);
  if (similarity < 0.6) return false;
  const existingNegation = FACT_NEGATION_REGEX.test(existingText);
  const incomingNegation = FACT_NEGATION_REGEX.test(incomingText);
  return existingNegation !== incomingNegation;
}

function hasSubstantialUserDetail(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (normalized.length < 24) return false;
  return tokenizeFactLedgerText(normalized).length >= 4;
}

function upsertFactsWithLedger(existingFacts, incomingFacts, options = {}) {
  const sourceTurn = Number.isFinite(Number(options.sourceTurn)) ? Number(options.sourceTurn) : 0;
  const nowIso = options.nowIso || new Date().toISOString();
  const normalizedFacts = (Array.isArray(existingFacts) ? existingFacts : [])
    .map((fact) => normalizeFactRecord(fact, sourceTurn))
    .filter(Boolean);

  const integrationDelta = {
    turn: sourceTurn,
    added_facts: [],
    updated_facts: [],
    superseded_facts: [],
    conflicts_detected: [],
    conflicts_resolved: [],
    narrative_rewritten: false,
    timestamp: nowIso,
  };

  const conflicts = Array.isArray(options.openConflicts) ? [...options.openConflicts] : [];
  const addedFacts = [];
  const touchedFacts = new Set();

  const upsertOne = (rawFact) => {
    const incoming = normalizeFactRecord(rawFact, sourceTurn);
    if (!incoming) return;

    const exactActive = normalizedFacts.find((fact) => {
      if ((fact.status || "active") !== "active") return false;
      return normalizeEvidenceText(fact.text) === normalizeEvidenceText(incoming.text);
    });
    if (exactActive) {
      if (incoming.beat && exactActive.beat !== incoming.beat) {
        exactActive.beat = incoming.beat;
        integrationDelta.updated_facts.push(exactActive.id);
        touchedFacts.add(exactActive.id);
      }
      return;
    }

    const supersedeCandidate = normalizedFacts.find((fact) =>
      shouldSupersedeActiveFact(fact, incoming)
    );
    if (supersedeCandidate) {
      supersedeCandidate.status = "superseded";
      supersedeCandidate.superseded_by = incoming.id;
      supersedeCandidate.superseded_at = nowIso;
      integrationDelta.superseded_facts.push(supersedeCandidate.id);
      touchedFacts.add(supersedeCandidate.id);
      incoming.supersedes_fact_id = supersedeCandidate.id;
    }

    const conflictCandidate = normalizedFacts.find((fact) =>
      detectPotentialFactConflict(fact, incoming)
    );
    if (conflictCandidate) {
      const conflictNote = `${conflictCandidate.id} conflicts with ${incoming.id}`;
      integrationDelta.conflicts_detected.push(conflictNote);
      conflicts.push({
        id: createFactId(`${conflictCandidate.id}-${incoming.id}-${sourceTurn}`),
        type: "fact_conflict",
        source_turn: sourceTurn,
        first_fact_id: conflictCandidate.id,
        second_fact_id: incoming.id,
        status: "open",
        detected_at: nowIso,
      });
    }

    normalizedFacts.push({
      ...incoming,
      status: "active",
      source_turn: sourceTurn,
      updated_at: nowIso,
    });
    integrationDelta.added_facts.push(incoming.id);
    touchedFacts.add(incoming.id);
    addedFacts.push(incoming);
  };

  for (const fact of Array.isArray(incomingFacts) ? incomingFacts : []) {
    upsertOne(fact);
  }

  integrationDelta.added_facts = uniqueStringArray(integrationDelta.added_facts);
  integrationDelta.updated_facts = uniqueStringArray(integrationDelta.updated_facts);
  integrationDelta.superseded_facts = uniqueStringArray(integrationDelta.superseded_facts);
  integrationDelta.conflicts_detected = uniqueStringArray(integrationDelta.conflicts_detected);
  integrationDelta.conflicts_resolved = uniqueStringArray(integrationDelta.conflicts_resolved);

  const nextFacts = normalizedFacts.map((fact) => ({
    ...fact,
    status: normalizeText(fact.status) || "active",
    superseded_by: normalizeText(fact.superseded_by) || "",
    superseded_at: normalizeText(fact.superseded_at) || "",
    supersedes_fact_id: normalizeText(fact.supersedes_fact_id) || "",
  }));

  return {
    facts: nextFacts,
    addedFacts,
    touchedFactIds: [...touchedFacts],
    integrationDelta,
    openConflicts: conflicts,
  };
}

function narrativeIntegratesTurnFacts(narrative, turnFacts, userInput) {
  const narrativeText = normalizeText(narrative).toLowerCase();
  if (!narrativeText) return false;

  const candidateTexts = [
    ...(Array.isArray(turnFacts) ? turnFacts : []),
  ]
    .map((text) => normalizeText(text))
    .filter(Boolean);

  if (candidateTexts.length === 0 && hasSubstantialUserDetail(userInput)) {
    candidateTexts.push(normalizeText(userInput));
  }

  if (candidateTexts.length === 0) return true;

  const hasCoverage = candidateTexts.some((text) => {
    const normalized = text.toLowerCase();
    if (normalized.length >= 12 && narrativeText.includes(normalized)) return true;
    const tokens = tokenizeFactLedgerText(text);
    if (tokens.length === 0) return false;
    const overlap = tokens.filter((token) => narrativeText.includes(token)).length;
    return overlap >= Math.min(2, tokens.length);
  });

  return hasCoverage;
}

function buildSupportTexts(state, userInput) {
  const supportTexts = [];
  if (typeof userInput === "string" && userInput.trim()) {
    supportTexts.push(userInput);
  }
  for (const fact of getActiveFacts(state.facts || [])) {
    if (fact && typeof fact.text === "string") {
      supportTexts.push(fact.text);
    }
  }
  return supportTexts;
}

function isSupportedValue(value, supportTexts) {
  const candidate = normalizeText(value);
  if (!candidate) return false;

  const lower = candidate.toLowerCase();
  if (supportTexts.some(text => text.toLowerCase().includes(lower))) {
    return true;
  }

  const tokens = tokenizeSignificant(candidate);
  if (tokens.length === 0) return false;

  const supportTokenSet = new Set();
  for (const text of supportTexts) {
    for (const token of tokenizeSignificant(text)) {
      supportTokenSet.add(token);
    }
  }

  const overlap = tokens.filter(token => supportTokenSet.has(token)).length;
  const requiredOverlap = tokens.length <= 2 ? 1 : 2;
  return overlap >= requiredOverlap;
}

function mergeAtoms(existing, incoming, supportTexts) {
  if (!incoming || typeof incoming !== "object") return existing;
  const next = { ...(existing || {}) };

  for (const [key, value] of Object.entries(incoming)) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    if (!isSupportedValue(normalized, supportTexts)) continue;
    next[key] = normalized;
  }

  return next;
}

function mergeMotifs(existing, incoming, supportTexts) {
  const next = Array.isArray(existing) ? [...existing] : [];
  if (!Array.isArray(incoming)) return next;

  for (const motif of incoming) {
    const normalized = normalizeText(motif);
    if (!normalized) continue;
    if (!isSupportedValue(normalized, supportTexts)) continue;
    if (!next.some(item => item.toLowerCase() === normalized.toLowerCase())) {
      next.push(normalized);
    }
  }
  return next;
}

function mergeDials(existing, incoming) {
  if (!incoming || typeof incoming !== "object") return existing;
  const next = { ...(existing || {}) };
  for (const [key, value] of Object.entries(incoming)) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    next[key] = normalized;
  }
  return next;
}

function mergePrimitives(existing, incoming, supportTexts) {
  if (!incoming || typeof incoming !== "object") return existing;
  const next = JSON.parse(JSON.stringify(existing || {}));

  if (Array.isArray(incoming.characters)) {
    const existingChars = Array.isArray(next.characters) ? next.characters : [];
    const merged = [...existingChars];
    for (const character of incoming.characters) {
      if (!character || typeof character !== "object") continue;
      const name = normalizeText(character.name || character.role || "");
      if (!name) continue;
      if (!isSupportedValue(name, supportTexts)) continue;
      const entry = {
        name: normalizeText(character.name || ""),
        role: normalizeText(character.role || ""),
        desire: normalizeText(character.desire || ""),
        fear: normalizeText(character.fear || ""),
        flaw: normalizeText(character.flaw || ""),
      };
      const already = merged.some(item =>
        (item.name && entry.name && item.name.toLowerCase() === entry.name.toLowerCase()) ||
        (item.role && entry.role && item.role.toLowerCase() === entry.role.toLowerCase())
      );
      if (!already) merged.push(entry);
    }
    next.characters = merged;
  }

  if (incoming.setting && typeof incoming.setting === "object") {
    next.setting = next.setting || {};
    const place = normalizeText(incoming.setting.place);
    if (place && isSupportedValue(place, supportTexts)) next.setting.place = place;
    const time = normalizeText(incoming.setting.time);
    if (time && isSupportedValue(time, supportTexts)) next.setting.time = time;
    const atmosphere = normalizeText(incoming.setting.atmosphere);
    if (atmosphere && isSupportedValue(atmosphere, supportTexts)) next.setting.atmosphere = atmosphere;
    const tags = Array.isArray(incoming.setting.sensory_tags) ? incoming.setting.sensory_tags : [];
    const mergedTags = Array.isArray(next.setting.sensory_tags) ? [...next.setting.sensory_tags] : [];
    for (const tag of tags) {
      const normalized = normalizeText(tag);
      if (!normalized) continue;
      if (!isSupportedValue(normalized, supportTexts)) continue;
      if (!mergedTags.some(item => item.toLowerCase() === normalized.toLowerCase())) {
        mergedTags.push(normalized);
      }
    }
    next.setting.sensory_tags = mergedTags;
  }

  const mergeDerivedField = (key, value) => {
    const normalized = normalizeText(value);
    if (!normalized) return;
    if (!isSupportedValue(normalized, supportTexts)) return;
    next[key] = normalized;
  };

  mergeDerivedField("inciting_incident", incoming.inciting_incident);
  if (incoming.conflict && typeof incoming.conflict === "object") {
    next.conflict = next.conflict || {};
    const internal = normalizeText(incoming.conflict.internal);
    if (internal && isSupportedValue(internal, supportTexts)) next.conflict.internal = internal;
    const external = normalizeText(incoming.conflict.external);
    if (external && isSupportedValue(external, supportTexts)) next.conflict.external = external;
  }
  mergeDerivedField("turning_point", incoming.turning_point);
  mergeDerivedField("resolution", incoming.resolution);
  mergeDerivedField("theme", incoming.theme);

  if (Array.isArray(incoming.motifs)) {
    next.motifs = mergeMotifs(next.motifs, incoming.motifs, supportTexts);
  }

  return next;
}

function sanitizeSongMap(songMap, supportTexts) {
  if (!songMap || typeof songMap !== "object") return null;

  const sanitized = {};
  const handleString = (value) => {
    const normalized = normalizeText(value);
    if (!normalized) return "";
    if (!isSupportedValue(normalized, supportTexts)) return "";
    return normalized;
  };
  const handleArray = (value) => {
    if (!Array.isArray(value)) return [];
    return value
      .map(handleString)
      .filter(Boolean);
  };

  if (songMap.hook !== undefined) sanitized.hook = handleString(songMap.hook);
  if (songMap.verse1 !== undefined) sanitized.verse1 = handleArray(songMap.verse1);
  if (songMap.verse2 !== undefined) sanitized.verse2 = handleArray(songMap.verse2);
  if (songMap.pre !== undefined) sanitized.pre = handleArray(songMap.pre);
  if (songMap.chorus !== undefined) sanitized.chorus = handleArray(songMap.chorus);
  if (songMap.bridge !== undefined) sanitized.bridge = handleArray(songMap.bridge);
  if (songMap.key_lines !== undefined) sanitized.key_lines = handleArray(songMap.key_lines);
  if (songMap.motifs !== undefined) sanitized.motifs = handleArray(songMap.motifs);

  const hasContent = Object.values(sanitized).some(value =>
    (typeof value === "string" && value) || (Array.isArray(value) && value.length > 0)
  );

  return hasContent ? sanitized : null;
}

function ensureAtomFacts(state, atoms) {
  if (!atoms || typeof atoms !== "object") return state;

  const beatMap = {
    who: "who",
    where: "scene",
    when: "scene",
    turn: "turning_point",
    object: "sensory",
    sound: "sensory",
    smell: "sensory",
    physical: "sensory",
    action: "moment",
    stakes: "stakes",
    secret: "stakes",
    after: "impact",
    dialogue: "moment",
  };

  const existingFacts = (state.facts || []).filter(f => f && typeof f.text === "string");
  const existingSet = new Set(existingFacts.map(f => f.text.toLowerCase().trim()));
  const nextFacts = [...existingFacts];

  for (const [key, value] of Object.entries(atoms)) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    const lower = normalized.toLowerCase();
    if (existingSet.has(lower)) continue;

    nextFacts.push({
      id: createFactId(normalized),
      text: normalized,
      beat: beatMap[key] || "detail",
      source_turn: state.turn_count + 1,
      status: "active",
      superseded_by: "",
      superseded_at: "",
      supersedes_fact_id: "",
      confidence: 0.7,
    });
    existingSet.add(lower);
  }

  if (nextFacts.length === existingFacts.length) {
    return state;
  }

  return {
    ...state,
    facts: nextFacts,
  };
}

function getMissingCoreAtoms(state) {
  const actionableBeatExists = (state.beats || []).some((beat) =>
    beat && beat.required !== false && (
      (typeof beat.strength === "number" && beat.strength < 0.5) ||
      (typeof beat.strength !== "number" && beat.status !== "covered")
    )
  );
  if (actionableBeatExists) {
    return [];
  }

  const narrativeLength = normalizeText(state.narrative_current || state.narrative || "").length;
  const factCount = getActiveFacts(state.facts || []).length;
  if (narrativeLength >= 30 || factCount >= 2 || (state.turn_count || 0) >= 2) {
    return [];
  }

  const atoms = state.atoms || {};
  const missing = [];
  if (!normalizeText(atoms.who) && !normalizeText(state.recipient_name || "")) missing.push("who");
  if (!normalizeText(atoms.where)) missing.push("where");
  if (!normalizeText(atoms.when)) missing.push("when");
  if (!normalizeText(atoms.turn)) missing.push("turn");
  return missing;
}

function buildAtomQuestion(atomKey, state, userStyle) {
  const recipient = state.recipient_name || "them";
  switch (atomKey) {
    case "who":
      return userStyle === "brief"
        ? `Who is this about?`
        : `Who is this really about — and what role do they play in your life?`;
    case "where":
      return userStyle === "brief"
        ? `Where did it happen?`
        : `Where were you when this happened? A place or setting helps me picture it.`;
    case "when":
      return userStyle === "brief"
        ? `When did it happen?`
        : `When was this — even roughly (like “last winter” or “in 2019”)?`;
    case "turn":
      return userStyle === "brief"
        ? `What changed?`
        : `What was the turning point — the moment things shifted for you and ${recipient}?`;
    default:
      return `Tell me one concrete detail that brings this to life.`;
  }
}

/**
 * Apply reasoning result to state (immutable)
 *
 * Takes the LLM reasoning output and updates state accordingly:
 * - Updates narrative
 * - Adds new facts with audit trail
 * - Updates beat statuses
 * - Updates user model
 * - Stores reasoning trace
 *
 * @param {Object} state - Current V3 state
 * @param {Object} reasoningResult - Parsed reasoning response from LLM
 * @param {string} userInput - Original user input (for source tracking)
 * @returns {Object} Updated state (new object, original unchanged)
 */
function applyReasoningResult(state, reasoningResult, userInput) {
  let newState = { ...state };
  const updates = reasoningResult.updates || {};
  const nowIso = new Date().toISOString();
  const sourceTurn = (state.turn_count || 0) + 1;
  const integrationInput = (updates.integration && typeof updates.integration === "object")
    ? updates.integration
    : ((reasoningResult.integration && typeof reasoningResult.integration === "object") ? reasoningResult.integration : {});
  const integrationDelta = {
    turn: sourceTurn,
    added_facts: [],
    updated_facts: [],
    superseded_facts: [],
    conflicts_detected: [],
    conflicts_resolved: [],
    narrative_rewritten: false,
    timestamp: nowIso,
  };

  const modelAddedFacts = Array.isArray(updates.new_facts)
    ? updates.new_facts
    : (Array.isArray(reasoningResult.reasoning?.new_facts) ? reasoningResult.reasoning.new_facts : []);
  const candidateFacts = [...modelAddedFacts];
  if (hasSubstantialUserDetail(userInput)) {
    candidateFacts.push({ text: normalizeText(userInput), beat: "context" });
  }

  const factMerge = upsertFactsWithLedger(state.facts || [], candidateFacts, {
    sourceTurn,
    nowIso,
    openConflicts: state.open_conflicts || [],
  });
  integrationDelta.added_facts.push(...factMerge.integrationDelta.added_facts);
  integrationDelta.updated_facts.push(...factMerge.integrationDelta.updated_facts);
  integrationDelta.superseded_facts.push(...factMerge.integrationDelta.superseded_facts);
  integrationDelta.conflicts_detected.push(...factMerge.integrationDelta.conflicts_detected);
  newState = {
    ...newState,
    facts: factMerge.facts,
    open_conflicts: factMerge.openConflicts,
  };

  for (const key of ["added_facts", "updated_facts", "superseded_facts", "conflicts_detected", "conflicts_resolved"]) {
    if (Array.isArray(integrationInput[key])) {
      integrationDelta[key].push(...integrationInput[key]);
    }
  }

  // Build support corpus for grounding checks (user input + active facts)
  const supportTexts = buildSupportTexts(newState, userInput);

  // 2b. Merge story atoms (grounded only)
  const atomsInput = updates.atoms || reasoningResult.atoms;
  if (atomsInput) {
    newState = {
      ...newState,
      atoms: mergeAtoms(newState.atoms || {}, atomsInput, supportTexts),
    };
    newState = ensureAtomFacts(newState, newState.atoms);
  }

  // 2c. Merge narrative primitives (grounded where possible)
  const primitivesInput = updates.primitives || reasoningResult.primitives;
  if (primitivesInput) {
    newState = {
      ...newState,
      primitives: mergePrimitives(newState.primitives || {}, primitivesInput, supportTexts),
    };
  }

  // 2d. Merge motifs (grounded only)
  const motifsInput = updates.motifs || reasoningResult.motifs;
  if (motifsInput) {
    newState = {
      ...newState,
      motifs: mergeMotifs(newState.motifs || [], motifsInput, supportTexts),
    };
  }

  // 2e. Merge dials (inferred)
  const dialsInput = updates.dials || reasoningResult.dials;
  if (dialsInput) {
    newState = {
      ...newState,
      dials: mergeDials(newState.dials || {}, dialsInput),
    };
  }

  // 2f. Song map (sanitized for grounding)
  const songMapInput = updates.song_map || reasoningResult.song_map;
  if (songMapInput) {
    newState = {
      ...newState,
      song_map: sanitizeSongMap(songMapInput, supportTexts),
    };
  }

  // 2g. Store evaluation (rubric scores) if provided
  const evaluationInput = reasoningResult.reasoning?.evaluation || updates.evaluation;
  if (evaluationInput && typeof evaluationInput === "object") {
    newState = {
      ...newState,
      evaluation: evaluationInput,
    };
  }

  // 3. Update narrative (enforce rewrite, reject append-only updates)
  const nextNarrative = updates.narrative || reasoningResult.narrative;
  let shouldRecompose = false;
  if (nextNarrative) {
    const previousNarrative = state.narrative_current || state.narrative || "";
    const isAppendStyle = isAppendStyleNarrative(previousNarrative, nextNarrative);

    if (!isAppendStyle) {
      newState = {
        ...newState,
        narrative: normalizeText(nextNarrative),
      };
    } else {
      const existingFeedback = newState._reasoning_feedback || [];
      newState._reasoning_feedback = [
        ...existingFeedback,
        {
          type: "append_style_narrative",
          turn: state.turn_count,
          timestamp: nowIso,
        },
      ];
      console.warn("[V3 Engine] Rejecting append-style narrative update");
      shouldRecompose = true;
    }

    const narrativeMode = updates.narrative_mode || reasoningResult.narrative_mode;
    if (narrativeMode && narrativeMode !== "rewritten") {
      const existingFeedback = newState._reasoning_feedback || [];
      newState._reasoning_feedback = [
        ...existingFeedback,
        {
          type: "narrative_mode_mismatch",
          mode: narrativeMode,
          turn: state.turn_count,
          timestamp: nowIso,
        },
      ];
      shouldRecompose = true;
    }

    if (
      !narrativeIntegratesTurnFacts(
        nextNarrative,
        factMerge.addedFacts.map((fact) => fact.text),
        userInput
      )
    ) {
      const existingFeedback = newState._reasoning_feedback || [];
      newState._reasoning_feedback = [
        ...existingFeedback,
        {
          type: "turn_detail_not_integrated",
          turn: state.turn_count,
          timestamp: nowIso,
        },
      ];
      shouldRecompose = true;
    }
  } else if (factMerge.addedFacts.length > 0) {
    shouldRecompose = true;
  }

  if (shouldRecompose) {
    const recomposed = composeNarrativeFromFacts(newState, {
      maxFacts: 9,
      maxSentences: 9,
      maxFactWords: 30,
    });
    if (recomposed) {
      newState = {
        ...newState,
        narrative: recomposed,
      };
    }
  }

  // If no narrative provided but we have active facts, compose a narrative
  if (!newState.narrative && getActiveFacts(newState.facts || []).length > 0) {
    const recomposed = composeNarrativeFromFacts(newState, {
      maxFacts: 9,
      maxSentences: 9,
      maxFactWords: 30,
    });
    if (recomposed) {
      newState = {
        ...newState,
        narrative: recomposed,
      };
    }
  }

  if (newState.narrative && !hasRecipientAnchor(newState.narrative, newState.recipient_name)) {
    const existingFeedback = newState._reasoning_feedback || [];
    newState._reasoning_feedback = [
      ...existingFeedback,
      {
        type: "missing_recipient_anchor",
        turn: state.turn_count,
        timestamp: nowIso,
      },
    ];
    const recomposed = composeNarrativeFromFacts(newState, {
      maxFacts: 9,
      maxSentences: 9,
      maxFactWords: 30,
    });
    if (recomposed) {
      newState = {
        ...newState,
        narrative: recomposed,
      };
    }
  }

  if (newState.narrative) {
    const anchors = selectAnchorFacts(getActiveFacts(newState.facts || []), 3);
    const minCoverage = Math.min(2, anchors.length);
    if (anchors.length > 0 && !narrativeCoversAnchors(newState.narrative, anchors, minCoverage)) {
      const existingFeedback = newState._reasoning_feedback || [];
      newState._reasoning_feedback = [
        ...existingFeedback,
        {
          type: "missing_anchor_facts",
          anchors,
          turn: state.turn_count,
          timestamp: nowIso,
        },
      ];
      const recomposed = composeNarrativeFromFacts(newState, {
        maxFacts: 9,
        maxSentences: 9,
        maxFactWords: 30,
      });
      if (recomposed) {
        newState = {
          ...newState,
          narrative: recomposed,
        };
      }
    }
  }

  if (newState.narrative) {
    const desiredPov = resolveDesiredNarrativePov(newState);
    if (narrativeNeedsPovAlignment(newState.narrative, newState.recipient_name, desiredPov)) {
      const existingFeedback = newState._reasoning_feedback || [];
      newState._reasoning_feedback = [
        ...existingFeedback,
        {
          type: "pov_misalignment",
          expected: desiredPov,
          turn: state.turn_count,
          timestamp: nowIso,
        },
      ];

      // Guardrail: if we default to recipient-focused but still got "I/my",
      // rewrite deterministically so the story stays about the recipient.
      if (desiredPov === "recipient" && hasFirstPersonVoice(newState.narrative)) {
        const corrected = rewriteNarrativeToRecipientFocus(newState.narrative, newState.recipient_name);
        if (corrected && corrected !== newState.narrative) {
          newState = {
            ...newState,
            narrative: corrected,
          };
          newState._reasoning_feedback = [
            ...(newState._reasoning_feedback || []),
            {
              type: "recipient_voice_rewrite",
              turn: state.turn_count,
              timestamp: nowIso,
            },
          ];
        }
      }
    }
  }

  // 4. Update beats from reasoning result (LLM-provided full schema)
  const beatsInput = updates.beats || reasoningResult.beats;
  if (beatsInput && Array.isArray(beatsInput)) {
    const { beats: reconciledBeats, invalidEvidence } = reconcileBeats(state.beats || [], beatsInput, newState.facts);
    newState = {
      ...newState,
      beats: reconciledBeats,
    };

    // Track invalid evidence for monitoring (feedback loop)
    if (invalidEvidence && invalidEvidence.length > 0) {
      const existingFeedback = newState._reasoning_feedback || [];
      newState._reasoning_feedback = [
        ...existingFeedback,
        {
          type: "invalid_evidence",
          items: invalidEvidence,
          turn: state.turn_count,
          timestamp: nowIso,
        },
      ];
      console.warn(`[V3 Engine] Filtered ${invalidEvidence.length} invalid evidence IDs:`,
        invalidEvidence.map(e => `${e.beat}:${e.evidence_id}`).join(", "));
    }
  } else if (!newState.beats || newState.beats.length === 0) {
    // Emergency fallback if no beats exist
    const fallbackResult = normalizeBeatsFromLLM(null, state.beats || [], newState.facts);
    newState = {
      ...newState,
      beats: fallbackResult.beats,
    };
  }

  // 5. Update user model from LLM's user_state assessment
  const userState = reasoningResult.reasoning?.user_state;
  if (userState) {
    const currentUserModel = state.user_model || {};
    const updatedUserModel = { ...currentUserModel };

    // Extract style from LLM reasoning (brief|verbose|emotional|analytical|unknown)
    const validStyles = ["brief", "verbose", "emotional", "analytical", "unknown"];
    if (userState.style && validStyles.includes(userState.style)) {
      updatedUserModel.style = userState.style;
    }

    // Map tone to tone_preference if provided
    if (userState.tone && typeof userState.tone === "string") {
      updatedUserModel.tone_preference = userState.tone;
    }

    // Increment fatigue_signals for low engagement or brief style with short answers
    if (userState.engagement === "low" ||
        (userState.style === "brief" && userState.seems_done)) {
      updatedUserModel.fatigue_signals = (currentUserModel.fatigue_signals || 0) + 1;
    }

    newState = {
      ...newState,
      user_model: updatedUserModel,
    };
  }

  // 6. Store reasoning trace for debugging
  if (reasoningResult.reasoning) {
    newState = {
      ...newState,
      last_reasoning: reasoningResult.reasoning,
    };
  }

  // 7. Update status based on action
  if (reasoningResult.action === "CONFIRM") {
    newState = { ...newState, status: "ready_for_confirm" };
  } else if (reasoningResult.action === "STOP") {
    newState = { ...newState, status: "abandoned" };
  }

  // 8. Apply inferred event if confidence exceeds threshold
  // This allows the LLM to correct/refine the event type based on story content
  const EVENT_CONFIDENCE_THRESHOLD = 0.7;
  const eventUpdate = updates.event || reasoningResult.event;
  if (eventUpdate &&
      typeof eventUpdate.confidence === "number" &&
      eventUpdate.confidence >= EVENT_CONFIDENCE_THRESHOLD) {
    newState = {
      ...newState,
      event: {
        ...newState.event,
        type: eventUpdate.type,
        title: eventUpdate.title,
        inferred_confidence: eventUpdate.confidence,
        // Preserve original occasion - this is user intent
      },
    };
  }

  const finalNarrative = normalizeText(newState.narrative || newState.narrative_current || "");
  const previousNarrative = normalizeText(state.narrative_current || state.narrative || "");
  let nextNarrativeVersion = Number(state.narrative_version || 0);
  let narrativeRevisions = Array.isArray(state.narrative_revisions)
    ? [...state.narrative_revisions]
    : [];

  if (finalNarrative && finalNarrative !== previousNarrative) {
    nextNarrativeVersion += 1;
    integrationDelta.narrative_rewritten = true;
    narrativeRevisions.push({
      version: nextNarrativeVersion,
      turn: sourceTurn,
      narrative: finalNarrative,
      timestamp: nowIso,
      integration: {
        added_facts: uniqueStringArray(integrationDelta.added_facts),
        updated_facts: uniqueStringArray(integrationDelta.updated_facts),
        superseded_facts: uniqueStringArray(integrationDelta.superseded_facts),
        conflicts_detected: uniqueStringArray(integrationDelta.conflicts_detected),
        conflicts_resolved: uniqueStringArray(integrationDelta.conflicts_resolved),
        narrative_rewritten: !!integrationDelta.narrative_rewritten,
      },
    });
    if (narrativeRevisions.length > 30) {
      narrativeRevisions = narrativeRevisions.slice(-30);
    }
  }

  integrationDelta.added_facts = uniqueStringArray(integrationDelta.added_facts);
  integrationDelta.updated_facts = uniqueStringArray(integrationDelta.updated_facts);
  integrationDelta.superseded_facts = uniqueStringArray(integrationDelta.superseded_facts);
  integrationDelta.conflicts_detected = uniqueStringArray(integrationDelta.conflicts_detected);
  integrationDelta.conflicts_resolved = uniqueStringArray(integrationDelta.conflicts_resolved);

  const nextIntegrationHistory = [
    ...(Array.isArray(state.integration_history) ? state.integration_history : []),
    integrationDelta,
  ].slice(-120);

  // 9. Update timestamp and canonical narrative aliases
  newState = {
    ...newState,
    narrative: finalNarrative,
    narrative_current: finalNarrative,
    narrative_version: nextNarrativeVersion || (finalNarrative ? 1 : 0),
    narrative_revisions: narrativeRevisions,
    integration_history: nextIntegrationHistory,
    last_integration_delta: integrationDelta,
    updated_at: nowIso,
  };

  return newState;
}

/**
 * Add a conversation turn to state (immutable)
 *
 * Tracks conversation history for context in future reasoning.
 * Only increments turn_count for user messages.
 *
 * @param {Object} state - Current V3 state
 * @param {string} role - "user" or "assistant"
 * @param {string} content - Message content
 * @returns {Object} Updated state
 * @throws {Error} If role is not "user" or "assistant"
 */
function addTurnToState(state, role, content, metadata = null) {
  if (!["user", "assistant"].includes(role)) {
    throw new Error(`[V3 Engine] Invalid conversation role: ${role} - must be 'user' or 'assistant'`);
  }

  const newTurn = {
    role,
    content,
    timestamp: new Date().toISOString(),
  };
  if (metadata && typeof metadata === "object") {
    if (typeof metadata.kind === "string" && metadata.kind.trim()) {
      newTurn.kind = metadata.kind.trim();
    }
    if (typeof metadata.source === "string" && metadata.source.trim()) {
      newTurn.source = metadata.source.trim();
    }
  }

  return {
    ...state,
    conversation: [...(state.conversation || []), newTurn],
    turn_count: role === "user" ? (state.turn_count || 0) + 1 : (state.turn_count || 0),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Generate fallback response when LLM is unavailable
 *
 * Delegates to generateSmartHeuristicFallback with llm_unavailable marker.
 *
 * @param {Object} state - Current V3 state
 * @returns {Object} Fallback response with action and question/confirmation
 */
function generateFallbackResponse(state) {
  return {
    ...generateSmartHeuristicFallback(state, null),
    fallback_reason: "llm_unavailable",
  };
}

/**
 * Build a confirmation message that references collected content
 *
 * @param {Object} state - V3 state
 * @returns {string} Confirmation message
 */
function buildConfirmationMessage(state) {
  const factCount = state.facts?.length || 0;
  if (factCount === 0) {
    return "I have a basic sense of your story. Should I work with what we have?";
  }
  return `I've captured ${factCount} details about your story. Does this feel complete, or is there more you'd like to add?`;
}

/**
 * Extract keywords from text for context
 *
 * @param {string} text - Text to extract keywords from
 * @returns {string[]} List of significant keywords
 */
function extractKeywords(text) {
  // Defensive: handle non-string input
  if (!text || typeof text !== "string") {
    return [];
  }

  // Common stop words to filter out
  const stopWords = new Set([
    "the", "a", "an", "is", "was", "were", "been", "be", "have", "has", "had",
    "do", "does", "did", "will", "would", "could", "should", "may", "might",
    "must", "shall", "can", "to", "of", "in", "for", "on", "with", "at", "by",
    "from", "as", "into", "through", "during", "before", "after", "above",
    "below", "between", "under", "again", "further", "then", "once", "here",
    "there", "when", "where", "why", "how", "all", "each", "few", "more",
    "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same",
    "so", "than", "too", "very", "just", "and", "but", "if", "or", "because",
    "until", "while", "that", "which", "who", "whom", "this", "these", "those",
    "am", "are", "it", "its", "he", "she", "they", "them", "his", "her",
    "their", "my", "me", "i", "you", "your", "we", "us", "our",
  ]);

  const words = text.toLowerCase()
    .replace(/[.,!?;:'"]/g, "")
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));

  return [...new Set(words)].slice(0, 3);
}

/**
 * Find a relevant fact for contextual question generation
 *
 * Looks for a fact that relates to the target beat, prioritizing
 * shorter facts that work well in conversational framing.
 *
 * @param {Array} facts - Array of fact objects
 * @param {string|null} beatId - Target beat ID to find relevant facts for
 * @returns {Object|null} Relevant fact or null if none found
 */
function findRelevantFact(facts, beatId) {
  if (!facts || facts.length === 0) return null;

  // If we have a target beat, look for facts associated with it
  if (beatId) {
    const beatFacts = facts.filter(f => f.beat === beatId);
    if (beatFacts.length > 0) {
      // Prefer shorter facts (easier to quote in a question)
      beatFacts.sort((a, b) => (a.text?.length || 0) - (b.text?.length || 0));
      // Return shortest fact if it's reasonable length (< 100 chars)
      if (beatFacts[0].text?.length < 100) {
        return beatFacts[0];
      }
    }
  }

  // Fallback: find any short, quotable fact
  const shortFacts = facts
    .filter(f => f.text && f.text.length > 10 && f.text.length < 60)
    .slice(-3); // Get most recent short facts

  if (shortFacts.length > 0) {
    return shortFacts[shortFacts.length - 1]; // Return most recent
  }

  return null;
}

/**
 * Generate smart heuristic fallback response
 *
 * Uses graduated richness scoring and LLM's user_state.seems_done when available.
 *
 * @param {Object} state - V3 story state
 * @param {Object|null} llmReasoning - Optional LLM reasoning with user_state.seems_done
 * @returns {Object} Response with action, question/confirmation, heuristic_score, and metadata
 */
function generateSmartHeuristicFallback(state, llmReasoning = null) {
  const factCount = state.facts?.length || 0;
  const narrativeLength = state.narrative?.length || 0;
  const turnCount = state.turn_count || 0;
  const fallbackNarrative = state.narrative || composeNarrativeFromFacts(state) || "";
  // Backward compatible: check both strength (v3) and status (v2)
  const beatsCovered = (state.beats || []).filter(b =>
    (typeof b.strength === "number" ? b.strength >= 0.5 : false) || b.status === "covered"
  ).length;
  const beatsTotal = (state.beats || []).length;

  // Calculate graduated richness score (0-1 scale, transparent)
  // This replaces magic number thresholds with a visible gradient
  const richnessScore = calculateRichnessScore({
    facts: factCount,
    narrativeChars: narrativeLength,
    beatsCovered,
    beatsTotal,
  });

  // Log fallback activation for monitoring
  console.warn("[V3 Engine] SMART HEURISTIC TRIGGERED");
  console.warn(`[V3 Engine] State: turns=${turnCount}, facts=${factCount}, narrative_len=${narrativeLength}, richness_score=${richnessScore.toFixed(2)}`);

  // Decision 1: LLM explicitly says user is done AND we have content → CONFIRM
  // This trusts the LLM's semantic understanding over keyword matching
  if (llmReasoning?.user_state?.seems_done === true && factCount >= 2) {
    return {
      action: "CONFIRM",
      confirmation: `I've captured ${factCount} details about ${state.recipient_name || "your story"}. Ready to create your song?`,
      narrative: fallbackNarrative,
      fallback: true,
      tier: "heuristic",
      reason: "LLM detected user is done",
      heuristic_score: richnessScore,
    };
  }

  // Decision 2: High richness score OR high turns → CONFIRM
  // This is content-based, not keyword-based
  if (richnessScore >= 0.6 || turnCount >= 10) {
    return {
      action: "CONFIRM",
      confirmation: buildConfirmationMessage(state),
      narrative: fallbackNarrative,
      fallback: true,
      tier: "heuristic",
      reason: richnessScore >= 0.6 ? "high_richness_score" : "high_turn_count",
      heuristic_score: richnessScore,
    };
  }

  // Otherwise: ASK a contextual question
  const keywords = extractKeywords(state.narrative || "");
  const weakBeat = (state.beats || [])
    .filter(b => (typeof b.strength === "number" ? b.strength < 0.5 : b.status !== "covered"))
    .filter(b => b.required !== false)[0];

  // Get user style for question adaptation
  const userStyle = state.user_model?.style || "unknown";

  // Find relevant fact for richer context
  const relevantFact = findRelevantFact(state.facts, weakBeat?.id);

  let question;

  // Priority: fill missing core atoms first (who/where/when/turn)
  const missingCoreAtoms = getMissingCoreAtoms(state);
  if (missingCoreAtoms.length > 0) {
    question = buildAtomQuestion(missingCoreAtoms[0], state, userStyle);
    return {
      action: "ASK",
      question,
      targetAtom: missingCoreAtoms[0],
      narrative: fallbackNarrative,
      fallback: true,
      tier: "heuristic",
      reason: "missing_core_atoms",
      heuristic_score: richnessScore,
    };
  }

  // Build contextual question - adapted to user style
  // Phase 3: Enhanced contextuality with "I noticed you mentioned..." framing
  if (weakBeat && keywords.length > 0) {
    // Reference both narrative content and weak beat purpose
    if (userStyle === "brief") {
      // Shorter question for brief users
      question = `More about ${keywords[0]}?`;
    } else if (userStyle === "emotional") {
      // Emotion-focused for emotional users
      question = `What does ${keywords[0]} make you feel, especially about ${weakBeat.purpose || "this"}?`;
    } else if (userStyle === "analytical") {
      // Fact-focused for analytical users
      question = `I noticed you mentioned ${keywords[0]}. Can you walk me through how that connects to ${weakBeat.purpose || "the story"}?`;
    } else {
      // Standard question with contextual framing
      if (relevantFact) {
        // Reference a specific fact for richer context
        question = `You mentioned that ${relevantFact.text}. Can you tell me more about ${weakBeat.purpose || keywords[0]}?`;
      } else if (keywords.length >= 2) {
        // Use multiple keywords for richer reference
        question = `I noticed you mentioned ${keywords[0]} and ${keywords[1]}. What does ${weakBeat.purpose || "this"} mean to you?`;
      } else {
        question = `I noticed you mentioned ${keywords[0]}. What does that mean to you, especially regarding ${weakBeat.purpose || "this"}?`;
      }
    }
  } else if (weakBeat && weakBeat.purpose) {
    // Reference beat purpose with recipient
    if (userStyle === "brief") {
      question = `About ${weakBeat.purpose}?`;
    } else if (userStyle === "emotional") {
      question = `How does ${weakBeat.purpose} with ${state.recipient_name || "them"} make you feel?`;
    } else if (userStyle === "analytical") {
      question = `Can you describe ${weakBeat.purpose} with ${state.recipient_name || "them"} in more detail?`;
    } else {
      question = `Tell me about ${weakBeat.purpose} with ${state.recipient_name || "them"}.`;
    }
  } else if (keywords.length > 0) {
    // Reference narrative content with enhanced framing
    if (userStyle === "brief") {
      question = `More about ${keywords[0]}?`;
    } else if (keywords.length >= 2) {
      question = `I noticed you mentioned ${keywords[0]} and ${keywords[1]}. Can you tell me more about that?`;
    } else {
      question = `I noticed you mentioned ${keywords[0]}. Can you tell me more about that?`;
    }
  } else if (state.recipient_name) {
    // Fallback to recipient-based question
    if (userStyle === "emotional") {
      question = `What feelings come up when you think of ${state.recipient_name}?`;
    } else {
      question = `What makes ${state.recipient_name} special to you?`;
    }
  } else {
    // Generic fallback
    question = "Tell me more about what makes this story special.";
  }

  return {
    action: "ASK",
    question,
    targetBeat: weakBeat?.id,
    narrative: fallbackNarrative,
    fallback: true,
    tier: "heuristic",
    reason: "need_more_content",
    heuristic_score: richnessScore,
  };
}

/**
 * Calculate graduated richness score
 *
 * Transparent scoring that replaces magic number thresholds.
 * Each component contributes to a 0-1 scale.
 *
 * @param {Object} metrics - Content metrics
 * @returns {number} Score from 0 to 1
 */
function calculateRichnessScore(metrics) {
  const { facts, narrativeChars, beatsCovered, beatsTotal } = metrics;

  // Component contributions (weights sum to ~1.0)
  // - Facts: 5 facts = full contribution (0.3)
  // - Narrative: 200 chars = full contribution (0.3)
  // - Beats: all covered = full contribution (0.4)
  const factContribution = Math.min(facts / 5, 1) * 0.3;
  const narrativeContribution = Math.min(narrativeChars / 200, 1) * 0.3;
  const beatContribution = beatsTotal > 0
    ? (beatsCovered / beatsTotal) * 0.4
    : 0;

  const raw = factContribution + narrativeContribution + beatContribution;

  // Clamp to 0-1
  return Math.min(1, Math.max(0, raw));
}

/**
 * Serialize state for database storage
 *
 * @param {Object} state - V3 state to serialize
 * @returns {string} JSON string
 */
function saveStateToSession(state) {
  return JSON.stringify(state);
}

/**
 * Deserialize state from database storage
 *
 * @param {string} json - JSON string from database
 * @returns {Object|null} V3 state object, or null if invalid
 */
function loadStateFromSession(json) {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch (err) {
    console.error("[V3 Engine] Failed to parse session state:", err.message);
    console.error("[V3 Engine] Corrupted JSON (first 200 chars):", json.substring(0, 200));
    return null;
  }
}

/**
 * Enforce that narrative is grounded in facts
 *
 * If narrative contains ungrounded content, rebuild from facts.
 * This prevents LLM hallucination from leaking into the story.
 *
 * @param {Object} state - V3 state
 * @returns {Object} State with grounded narrative
 */
function enforceGrounding(state) {
  const assessment = assessStateGrounding(state);

  // If already grounded, return unchanged
  if (assessment.grounded) {
    return state;
  }

  const turnCount = Number(state?.turn_count || 0);
  const activeFactCount = getActiveFacts(state?.facts || []).length;
  const shouldSoftAcceptEarlyTurn = (
    turnCount <= 1 &&
    activeFactCount >= 1 &&
    assessment.reason === "coverage_low"
  );

  const shouldSoftAcceptSecondTurn = (
    turnCount === 2 &&
    activeFactCount >= 1 &&
    assessment.reason === "coverage_low" &&
    assessment.coverage >= 0.3 &&
    assessment.matched >= 3 &&
    assessment.unmatched <= 12
  );

  if (shouldSoftAcceptEarlyTurn || shouldSoftAcceptSecondTurn) {
    const mode = shouldSoftAcceptEarlyTurn ? "soft_accept_turn1" : "soft_accept_turn2";
    console.warn(
      `[V3 Engine] Soft-accepting narrative grounding (${mode}, coverage=${assessment.coverage.toFixed(2)}, matched=${assessment.matched}, unmatched=${assessment.unmatched})`
    );
    return {
      ...state,
      grounding_assessment: {
        ...assessment,
        mode,
        turn: turnCount,
        timestamp: new Date().toISOString(),
      },
    };
  }

  console.warn(
    `[V3 Engine] Narrative contains ungrounded content, rebuilding from facts (reason=${assessment.reason}, coverage=${assessment.coverage.toFixed(2)})`
  );

  // Rebuild narrative from facts only (filter invalid facts defensively)
  const groundedNarrative = composeNarrativeFromFacts(state);
  const now = new Date().toISOString();

  return {
    ...state,
    narrative: groundedNarrative,
    narrative_current: groundedNarrative,
    grounding_enforced: true,
    grounding_issue: groundedNarrative ? "ungrounded_narrative" : "no_facts",
    grounding_assessment: {
      ...assessment,
      mode: "rebuilt_from_facts",
      turn: turnCount,
      timestamp: now,
    },
    updated_at: now,
  };
}

/**
 * Reconcile LLM's beat assessment with actual facts
 *
 * Validates that beat evidence references exist in the facts list.
 * Tracks invalid evidence IDs for monitoring and feedback.
 *
 * @param {Array} existingBeats - Current beats with metadata
 * @param {Array} llmBeats - LLM's updated beat assessments
 * @param {Array} facts - Collected facts
 * @returns {{beats: Array, invalidEvidence: Array}} Reconciled beats and invalid evidence
 */
function reconcileBeats(existingBeats, llmBeats, facts) {
  return normalizeBeatsFromLLM(llmBeats, existingBeats, facts);
}

function normalizeBeatId(id) {
  if (!id || typeof id !== "string") return "";
  return id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeEvidenceText(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findBestFactMatch(normalizedEvidence, factTokensIndex) {
  const evidenceTokens = normalizedEvidence.split(" ").filter(Boolean);
  if (evidenceTokens.length === 0) return null;

  let bestId = null;
  let bestScore = 0;

  for (const [factId, tokens] of factTokensIndex.entries()) {
    if (!tokens || tokens.length === 0) continue;
    let overlap = 0;
    for (const token of evidenceTokens) {
      if (tokens.includes(token)) overlap += 1;
    }
    const score = overlap / Math.max(tokens.length, evidenceTokens.length);
    if (score > bestScore) {
      bestScore = score;
      bestId = factId;
    }
  }

  if (bestScore >= 0.55) {
    return bestId;
  }

  return null;
}

function normalizeBeatsFromLLM(llmBeats, existingBeats, facts) {
  const fallbackBeats = buildFallbackBeats(existingBeats);
  const activeFacts = getActiveFacts(facts || []);

  if (!llmBeats || !Array.isArray(llmBeats) || llmBeats.length === 0) {
    return { beats: fallbackBeats, invalidEvidence: [] };
  }

  const factIds = new Set(activeFacts.map(f => f.id));
  const factTextIndex = new Map();
  const factTokensIndex = new Map();
  for (const fact of activeFacts) {
    if (!fact || typeof fact.text !== "string") continue;
    const normalized = normalizeEvidenceText(fact.text);
    if (!normalized || factTextIndex.has(normalized)) continue;
    factTextIndex.set(normalized, fact.id);
    factTokensIndex.set(fact.id, normalized.split(" ").filter(Boolean));
  }
  const normalized = [];
  const invalidEvidence = [];
  const seen = new Set();

  for (const beat of llmBeats) {
    if (!beat || typeof beat !== "object") continue;

    const id = normalizeBeatId(beat.id);
    const purpose = typeof beat.purpose === "string" ? beat.purpose.trim() : "";

    if (!id || !purpose || seen.has(id)) {
      continue;
    }

    const required = typeof beat.required === "boolean" ? beat.required : true;
    const strength = typeof beat.strength === "number"
      ? Math.max(0, Math.min(1, beat.strength))
      : (beat.status ? strengthFromStatus(beat.status) : 0);

    // Track valid and invalid evidence separately
    const validEvidence = [];
    if (Array.isArray(beat.evidence)) {
      for (const factId of beat.evidence) {
        if (typeof factId !== "string") {
          invalidEvidence.push({ beat: id, evidence_id: String(factId) });
          continue;
        }
        const trimmed = factId.trim();
        if (factIds.has(trimmed)) {
          validEvidence.push(trimmed);
        } else {
          const normalizedText = normalizeEvidenceText(trimmed);
          const remappedId = normalizedText ? factTextIndex.get(normalizedText) : null;
          if (remappedId) {
            validEvidence.push(remappedId);
          } else {
            const fuzzyMatch = normalizedText
              ? findBestFactMatch(normalizedText, factTokensIndex)
              : null;
            if (fuzzyMatch) {
              validEvidence.push(fuzzyMatch);
            } else {
              invalidEvidence.push({ beat: id, evidence_id: trimmed });
            }
          }
        }
      }
    }
    const evidence = validEvidence;

    normalized.push({
      id,
      purpose,
      required,
      strength,
      status: getStatusFromStrength(strength),
      evidence,
    });
    seen.add(id);
  }

  return {
    beats: normalized.length > 0 ? normalized : fallbackBeats,
    invalidEvidence,
  };
}

function buildFallbackBeats(existingBeats) {
  if (existingBeats && existingBeats.length > 0) {
    return existingBeats;
  }

  return DEFAULT_BEATS.map(beat => ({
    ...beat,
    strength: 0,
    status: "missing",
    evidence: [],
  }));
}

function strengthFromStatus(status) {
  if (status === "covered") return 1;
  if (status === "weak") return 0.5;
  return 0;
}

module.exports = {
  applyReasoningResult,
  addTurnToState,
  generateFallbackResponse,
  generateSmartHeuristicFallback,
  applyDeterministicFallbackExtraction,
  enforceGrounding,
  reconcileBeats,
  saveStateToSession,
  loadStateFromSession,
  getSlotSuggestions,
  getElementSuggestions,
  getOccasionDefaultSuggestions,
};
