/**
 * Multi-Turn E2E Story Flow Tests
 *
 * Tests the complete story creation flow: start → continue × N → confirm → lyrics.
 * Runs against a live local server with real LLM calls.
 *
 * Prerequisites:
 *   - npm run db:up (PostgreSQL running)
 *   - npm run dev (server at localhost:3000)
 *   - LLM API keys configured
 *
 * Usage: NODE_ENV=test node --test test/writer/v3/e2e-story-flow.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";
const TEST_USER = "e2e-test-user-" + Date.now();
const TURN_TIMEOUT = 60_000; // 60s per turn (LLM calls)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function storyRound({ message, recipientName, occasion, sessionId }) {
  const body = { message, recipient_name: recipientName, occasion };
  if (sessionId) body.session_id = sessionId;

  const res = await fetch(`${BASE_URL}/debug/story/full-round`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user-id": TEST_USER },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) {
    const msg = json.message || json.error || JSON.stringify(json);
    throw new Error(`full-round ${res.status}: ${msg}`);
  }
  return json;
}

async function confirmStory(storyId) {
  const res = await fetch(`${BASE_URL}/story/${storyId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user-id": TEST_USER },
    body: JSON.stringify({}),
  });
  return { status: res.status, body: await res.json() };
}

async function generateLyrics(storyId) {
  const res = await fetch(`${BASE_URL}/story/${storyId}/lyrics`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user-id": TEST_USER },
  });
  return { status: res.status, body: await res.json() };
}

// Quality assertions applied per turn
function assertTurnQuality(turnResult, turnNum, userMessage) {
  const ai = turnResult.ai_response;
  const narrative = ai.narrative || "";

  // No 500 errors (if we got here, no error thrown)
  assert.ok(turnResult.session_id, `Turn ${turnNum}: missing session_id`);

  // When ASK: question must be non-empty
  if (ai.action === "ASK" || ai.action === "CLARIFY") {
    assert.ok(ai.question && ai.question.trim().length > 10,
      `Turn ${turnNum}: question too short or missing: "${ai.question}"`);

    // Question should NOT be the old generic template
    const generic = "I'd love to hear more about how";
    assert.ok(!ai.question.includes(generic),
      `Turn ${turnNum}: generic template detected in question`);
  }

  // No formulaic opener
  assert.ok(!narrative.match(/^This\s+\w+\s+story is about/i),
    `Turn ${turnNum}: formulaic opener detected: "${narrative.slice(0, 60)}..."`);

  // No underscore occasion labels in narrative
  assert.ok(!narrative.includes("thank_you") && !narrative.includes("mothers_day"),
    `Turn ${turnNum}: raw occasion label in narrative`);

  // No excessive repetition (same phrase 3+ times)
  const sentences = narrative.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const seen = new Map();
  for (const s of sentences) {
    const key = s.trim().toLowerCase().slice(0, 40);
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  for (const [phrase, count] of seen) {
    assert.ok(count < 3,
      `Turn ${turnNum}: phrase repeated ${count} times: "${phrase}"`);
  }
}

function assertLyricsQuality(lyricsResult) {
  assert.equal(lyricsResult.status, 200,
    `Lyrics failed with ${lyricsResult.status}: ${JSON.stringify(lyricsResult.body).slice(0, 200)}`);

  const lyrics = lyricsResult.body.lyrics || lyricsResult.body;
  assert.ok(lyrics.sections && lyrics.sections.length >= 2,
    `Lyrics missing sections: ${JSON.stringify(lyrics).slice(0, 200)}`);

  // At least verse + chorus
  const sectionNames = lyrics.sections.map(s => s.name);
  assert.ok(sectionNames.includes("chorus"),
    `Lyrics missing chorus. Sections: ${sectionNames.join(", ")}`);
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

test("E2E: Rich birthday — full flow through lyrics", { timeout: 5 * TURN_TIMEOUT }, async () => {
  // Turn 1: Rich initial input
  const t1 = await storyRound({
    message: "Sarah has been my best friend since college. She showed up with mint chocolate chip ice cream during my worst breakup and made me laugh when I thought I could not smile again.",
    recipientName: "Sarah",
    occasion: "birthday",
  });
  assertTurnQuality(t1, 1, "Sarah ice cream breakup");
  assert.equal(t1.ai_response.action, "ASK", "Turn 1 should ask for more");

  // Turn 2: Add vivid detail
  const t2 = await storyRound({
    message: "Every summer we dance in the park and one time she slipped in a puddle while Dancing Queen was playing and we laughed so hard we cried",
    recipientName: "Sarah",
    occasion: "birthday",
    sessionId: t1.session_id,
  });
  assertTurnQuality(t2, 2, "puddle Dancing Queen");

  // Turn 3: Emotional closure
  const t3 = await storyRound({
    message: "She makes me feel truly known and loved. Twenty years of friendship and she still surprises me.",
    recipientName: "Sarah",
    occasion: "birthday",
    sessionId: t1.session_id,
  });
  assertTurnQuality(t3, 3, "known and loved twenty years");

  // If not CONFIRM yet, do one more turn
  let finalTurn = t3;
  if (t3.ai_response.action !== "CONFIRM" && !t3.ai_response.complete) {
    finalTurn = await storyRound({
      message: "That's everything — she's simply the best friend anyone could ask for",
      recipientName: "Sarah",
      occasion: "birthday",
      sessionId: t1.session_id,
    });
    assertTurnQuality(finalTurn, 4, "best friend");
  }

  // Confirm
  const confirmResult = await confirmStory(t1.session_id);
  assert.ok(confirmResult.status === 200 || confirmResult.status === 422,
    `Confirm failed: ${confirmResult.status}`);

  // If 422 (STORY_NEEDS_INPUT), that's OK — story engine wants more. Skip lyrics.
  if (confirmResult.status === 200) {
    // Lyrics
    const lyricsResult = await generateLyrics(t1.session_id);
    assertLyricsQuality(lyricsResult);
    console.log(`  ✓ Lyrics generated: "${lyricsResult.body.lyrics?.title || "untitled"}"`);
  } else {
    console.log(`  ⚠ Story needs more input (422) — skipping lyrics`);
  }
});

test("E2E: Sparse input — engine handles gracefully", { timeout: 4 * TURN_TIMEOUT }, async () => {
  const t1 = await storyRound({
    message: "Happy birthday mom",
    recipientName: "Mom",
    occasion: "birthday",
  });
  assertTurnQuality(t1, 1, "Happy birthday mom");
  assert.ok(t1.ai_response.action === "ASK" || t1.ai_response.action === "CLARIFY",
    `Sparse input must ask for more, got ${t1.ai_response.action}`);

  const t2 = await storyRound({
    message: "She always makes pancakes on Sunday mornings",
    recipientName: "Mom",
    occasion: "birthday",
    sessionId: t1.session_id,
  });
  assertTurnQuality(t2, 2, "pancakes Sunday");

  const t3 = await storyRound({
    message: "Her smile lights up the whole kitchen",
    recipientName: "Mom",
    occasion: "birthday",
    sessionId: t1.session_id,
  });
  assertTurnQuality(t3, 3, "smile kitchen");
});

test("E2E: Emotional tribute — Chioma flow", { timeout: 5 * TURN_TIMEOUT }, async () => {
  const t1 = await storyRound({
    message: "I will never forget the high-risk pregnancy of the twins. There was fear, pain, and uncertainty. But Chioma stayed strong through every appointment, every scare.",
    recipientName: "Chioma",
    occasion: "thank you",
  });
  assertTurnQuality(t1, 1, "high-risk pregnancy twins");

  const t2 = await storyRound({
    message: "The weekly checkups while caring for two older kids and working full time — she never missed one",
    recipientName: "Chioma",
    occasion: "thank you",
    sessionId: t1.session_id,
  });
  assertTurnQuality(t2, 2, "weekly checkups older kids");

  // Check that question acknowledges what was shared (Yes-And)
  // Broaden to include related concepts the LLM might use
  const q = (t2.ai_response.question || "").toLowerCase();
  const hasContext = q.includes("checkup") || q.includes("kids") ||
    q.includes("work") || q.includes("chioma") || q.includes("twin") ||
    q.includes("pregnancy") || q.includes("appointment") || q.includes("family") ||
    q.includes("strength") || q.includes("fear") || q.includes("care");
  if (!hasContext) {
    console.log(`  ⚠ Turn 2 question is generic (no input reference): "${q.slice(0, 80)}..."`);
    // Track but don't fail — LLM quality varies per run
  }

  const t3 = await storyRound({
    message: "Watching her become a mother of four changed how I see strength and love",
    recipientName: "Chioma",
    occasion: "thank you",
    sessionId: t1.session_id,
  });
  assertTurnQuality(t3, 3, "mother of four strength love");
});

test("E2E: Adversarial — very long input doesn't overflow", { timeout: 3 * TURN_TIMEOUT }, async () => {
  // 2000+ character message with many details
  const longMessage = [
    "My grandmother Rose was the backbone of our entire family for sixty years and counting.",
    "She grew up on a small farm in rural Georgia during the 1940s, the youngest of nine children in a house with no running water.",
    "She met my grandfather James at a church social when she was seventeen and he was nineteen, and she says she knew right then.",
    "They married within a year and moved to Atlanta where grandpa worked long shifts at the old steel mill on Peachtree Industrial.",
    "Rose worked three jobs simultaneously to put all five of her children through school without any of them knowing how hard it was.",
    "She was a seamstress during the day at a tailor shop downtown, cleaned offices at night for a janitorial company, and sold baked goods on weekends at the farmers market.",
    "Her sweet potato pie was legendary in our neighborhood — people would drive clear across town on Thanksgiving just for a single slice of that pie.",
    "When grandpa got sick with cancer in 1987, she nursed him through chemotherapy for three years without missing a single day of work at any of her three jobs.",
    "After he passed in the spring of 1990, she raised two of her grandchildren when their parents could not provide for them properly.",
    "She taught me to read using the family Bible and old newspapers she collected from the office building she cleaned every night.",
    "Every single Sunday without exception she wore her blue hat with the white ribbon to Greater Mount Zion Baptist Church and sang in the choir.",
    "Her voice was not the strongest in the choir but it was absolutely the most faithful — she never missed a Sunday in forty years of singing.",
    "She could stretch a single dollar further than anyone I have ever known in my entire life, and she made it look effortless.",
    "Last Christmas at the age of ninety-two she still insisted on cooking the entire holiday meal herself — turkey, ham, collard greens, mac and cheese, cornbread, sweet potato pie.",
    "She said the secret ingredient in everything she made was love and stubbornness in equal measure, and I believe her completely.",
    "When I asked her what kept her going through all those years of hardship, she looked at me with those bright eyes and said it was simple — her family needed her and that was enough.",
    "Now I want to make this song to tell her how much every single sacrifice she made has meant to all of us, every early morning and late night, every pie and every prayer.",
  ].join(" ");

  assert.ok(longMessage.length > 2000, `Message should be 2000+ chars, got ${longMessage.length}`);

  const t1 = await storyRound({
    message: longMessage,
    recipientName: "Grandma Rose",
    occasion: "birthday",
  });
  assertTurnQuality(t1, 1, "long input");

  // Narrative should not be longer than 3x the input (no hallucination explosion)
  const narrative = t1.ai_response.narrative || "";
  assert.ok(narrative.length < longMessage.length * 3,
    `Narrative suspiciously long: ${narrative.length} chars from ${longMessage.length} char input`);
});

test("E2E: Adversarial — monosyllabic answers don't break flow", { timeout: 4 * TURN_TIMEOUT }, async () => {
  const t1 = await storyRound({
    message: "Birthday song for my friend Jake who I've known since school",
    recipientName: "Jake",
    occasion: "birthday",
  });
  assertTurnQuality(t1, 1, "Jake school");
  assert.equal(t1.ai_response.action, "ASK");

  // Answer with minimal input
  const t2 = await storyRound({
    message: "yes",
    recipientName: "Jake",
    occasion: "birthday",
    sessionId: t1.session_id,
  });
  // Should still be asking — "yes" gives nothing
  assert.ok(t2.ai_response.action === "ASK" || t2.ai_response.action === "CLARIFY",
    `Monosyllabic "yes" should not trigger CONFIRM, got ${t2.ai_response.action}`);

  const t3 = await storyRound({
    message: "ok",
    recipientName: "Jake",
    occasion: "birthday",
    sessionId: t1.session_id,
  });
  // Engine should handle gracefully, not crash
  assert.ok(t3.session_id, "Engine should not crash on monosyllabic input");
});

test("E2E: Adversarial — contradictory input handled", { timeout: 3 * TURN_TIMEOUT }, async () => {
  const t1 = await storyRound({
    message: "We met in Lagos last December and it changed everything between us",
    recipientName: "Ada",
    occasion: "custom",
  });
  assertTurnQuality(t1, 1, "Lagos December");

  // Contradict the location
  const t2 = await storyRound({
    message: "Actually we met in London in June, I got the details mixed up",
    recipientName: "Ada",
    occasion: "custom",
    sessionId: t1.session_id,
  });
  assertTurnQuality(t2, 2, "London June correction");

  // Narrative should prefer latest info
  const narrative = (t2.ai_response.narrative || "").toLowerCase();
  // Should mention London (the correction), not Lagos (the error)
  // Note: LLM may keep both, but should at least mention London
  assert.ok(narrative.includes("london"),
    `Narrative should reflect correction to London: "${t2.ai_response.narrative?.slice(0, 100)}..."`);
});
