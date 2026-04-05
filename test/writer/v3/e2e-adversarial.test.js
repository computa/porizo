/**
 * Adversarial Multi-Turn E2E Story Tests
 *
 * Attempts to break the story engine with:
 * - 4+ turn conversations
 * - Concurrent requests (race conditions)
 * - Rapid-fire inputs
 * - Empty/whitespace inputs
 * - Version conflicts (stale session)
 * - Mid-conversation style changes
 * - Confirm then continue (backtrack)
 * - Very short followed by very long inputs
 *
 * Prerequisites: npm run db:up && npm run dev
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";
const TEST_USER = "adversarial-test-" + Date.now();
const TURN_TIMEOUT = 60_000;

async function storyRound({ message, recipientName, occasion, sessionId }) {
  const body = { message, recipient_name: recipientName, occasion };
  if (sessionId) body.session_id = sessionId;
  const res = await fetch(`${BASE_URL}/debug/story/full-round`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user-id": TEST_USER },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function continueStory(storyId, answer) {
  const res = await fetch(`${BASE_URL}/story/${storyId}/continue`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user-id": TEST_USER },
    body: JSON.stringify({ answer }),
  });
  return { status: res.status, body: await res.json() };
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

function assertNoServerError(result, context) {
  assert.ok(result.status < 500,
    `${context}: Server error ${result.status}: ${JSON.stringify(result.body).slice(0, 300)}`);
}

function assertNarrativeClean(narrative, context) {
  if (!narrative) return;
  assert.ok(!narrative.match(/^This\s+\w+\s+story\s+is\s+about/i),
    `${context}: formulaic opener in narrative`);
  assert.ok(!narrative.includes("thank_you") && !narrative.includes("mothers_day"),
    `${context}: raw occasion label in narrative`);
}

// ---------------------------------------------------------------------------
// Test 1: 5-turn deep conversation with full lifecycle
// ---------------------------------------------------------------------------
test("Adversarial: 5-turn deep conversation through confirm + lyrics", { timeout: 8 * TURN_TIMEOUT }, async () => {
  console.log("  Turn 1: Initial story...");
  const t1 = await storyRound({
    message: "My wife Chy carried our family through the hardest year of our lives. The twins were high-risk and every week was a battle.",
    recipientName: "Chioma",
    occasion: "thank you",
  });
  assertNoServerError(t1, "Turn 1");
  const sid = t1.body.session_id;
  assert.ok(sid, "Turn 1 must return session_id");
  assertNarrativeClean(t1.body.ai_response?.narrative, "Turn 1");

  console.log("  Turn 2: Add detail...");
  const t2 = await storyRound({
    message: "The weekly checkups, managing two older kids, working full time. She never missed a single appointment.",
    recipientName: "Chioma",
    occasion: "thank you",
    sessionId: sid,
  });
  assertNoServerError(t2, "Turn 2");
  assertNarrativeClean(t2.body.ai_response?.narrative, "Turn 2");

  console.log("  Turn 3: Emotional depth...");
  const t3 = await storyRound({
    message: "The fear of losing them kept us up at night. But she held it together for everyone. Her strength changed how I see love.",
    recipientName: "Chioma",
    occasion: "thank you",
    sessionId: sid,
  });
  assertNoServerError(t3, "Turn 3");
  assertNarrativeClean(t3.body.ai_response?.narrative, "Turn 3");

  console.log("  Turn 4: Resolution...");
  const t4 = await storyRound({
    message: "When the twins were born healthy, I cried. She just smiled and said we did it together. That moment stays with me.",
    recipientName: "Chioma",
    occasion: "thank you",
    sessionId: sid,
  });
  assertNoServerError(t4, "Turn 4");
  assertNarrativeClean(t4.body.ai_response?.narrative, "Turn 4");

  console.log("  Turn 5: Closing...");
  const t5 = await storyRound({
    message: "She is the heart of our home. Everything she does is for the family. This song is to say thank you for all of it.",
    recipientName: "Chioma",
    occasion: "thank you",
    sessionId: sid,
  });
  assertNoServerError(t5, "Turn 5");
  assertNarrativeClean(t5.body.ai_response?.narrative, "Turn 5");

  // Narrative should have grown — turn 5 narrative should be longer than turn 1
  const n1 = (t1.body.ai_response?.narrative || "").length;
  const n5 = (t5.body.ai_response?.narrative || "").length;
  assert.ok(n5 >= n1, `Narrative should grow: turn1=${n1}, turn5=${n5}`);

  // Confirm
  console.log("  Confirming story...");
  const conf = await confirmStory(sid);
  // 200 = confirmed, 422 = needs more input (both acceptable)
  assert.ok(conf.status === 200 || conf.status === 422,
    `Confirm unexpected status: ${conf.status}`);

  if (conf.status === 200) {
    console.log("  Generating lyrics...");
    const lyrics = await generateLyrics(sid);
    assertNoServerError(lyrics, "Lyrics");
    assert.ok(lyrics.body.lyrics?.sections?.length >= 2,
      `Lyrics should have sections: ${JSON.stringify(lyrics.body.lyrics?.sections?.map(s => s.name))}`);
    console.log(`  ✓ Full lifecycle complete: "${lyrics.body.lyrics?.title}"`);
  } else {
    console.log("  ⚠ Story wanted more input (422) — acceptable for 5 turns");
  }
});

// ---------------------------------------------------------------------------
// Test 2: Concurrent requests (race condition)
// ---------------------------------------------------------------------------
test("Adversarial: concurrent continue requests don't crash", { timeout: 3 * TURN_TIMEOUT }, async () => {
  // Start a story
  const t1 = await storyRound({
    message: "Dad taught me everything about fishing. Saturday mornings at the lake.",
    recipientName: "Dad",
    occasion: "birthday",
  });
  assertNoServerError(t1, "Start");
  const sid = t1.body.session_id;

  // Fire 3 continue requests simultaneously
  console.log("  Firing 3 concurrent continues...");
  const results = await Promise.allSettled([
    continueStory(sid, "He always brought black coffee and told me stories about grandpa"),
    continueStory(sid, "The time he caught a 20-pound bass and almost fell in"),
    continueStory(sid, "He taught me patience more than fishing really"),
  ]);

  // At least one should succeed, others may get version conflicts (409) or succeed
  const statuses = results.map(r => r.status === "fulfilled" ? r.value.status : "rejected");
  console.log(`  Concurrent statuses: ${statuses.join(", ")}`);

  const successCount = statuses.filter(s => s === 200).length;
  const conflictCount = statuses.filter(s => s === 409 || s === 429).length;
  const serverErrorCount = statuses.filter(s => s >= 500).length;

  assert.equal(serverErrorCount, 0,
    `No server errors on concurrent requests. Statuses: ${statuses.join(", ")}`);
  assert.ok(successCount >= 1,
    `At least 1 concurrent request should succeed. Statuses: ${statuses.join(", ")}`);
});

// ---------------------------------------------------------------------------
// Test 3: Rapid-fire short inputs
// ---------------------------------------------------------------------------
test("Adversarial: rapid-fire 4 short inputs in sequence", { timeout: 5 * TURN_TIMEOUT }, async () => {
  const t1 = await storyRound({
    message: "Song for my sister who moved away",
    recipientName: "Amara",
    occasion: "farewell",
  });
  assertNoServerError(t1, "Start");
  const sid = t1.body.session_id;

  const shortInputs = [
    "She left last month",
    "Lagos to London",
    "I miss cooking together",
    "She calls every Sunday",
  ];

  for (let i = 0; i < shortInputs.length; i++) {
    console.log(`  Turn ${i + 2}: "${shortInputs[i]}"...`);
    const r = await storyRound({
      message: shortInputs[i],
      recipientName: "Amara",
      occasion: "farewell",
      sessionId: sid,
    });
    assertNoServerError(r, `Turn ${i + 2}`);
    assertNarrativeClean(r.body.ai_response?.narrative, `Turn ${i + 2}`);

    // Should still be asking (short inputs = not enough for confirm)
    if (i < 2) {
      assert.ok(
        r.body.ai_response?.action === "ASK" || r.body.ai_response?.action === "CLARIFY",
        `Turn ${i + 2}: short input should not confirm, got ${r.body.ai_response?.action}`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Test 4: Confirm, then try to continue (backtrack)
// ---------------------------------------------------------------------------
test("Adversarial: continue after confirm is handled gracefully", { timeout: 4 * TURN_TIMEOUT }, async () => {
  // Build up a story quickly
  const t1 = await storyRound({
    message: "Jake and I have been best friends since primary school. He convinced me to enter a hot dog eating contest and I threw up on the judges table. We still laugh about it ten years later. He's the funniest person I know and always makes me feel better.",
    recipientName: "Jake",
    occasion: "birthday",
  });
  assertNoServerError(t1, "Start");
  const sid = t1.body.session_id;

  const t2 = await storyRound({
    message: "He showed up at the hospital when my daughter was born with a stuffed hot dog toy. That's Jake — always turning everything into a laugh.",
    recipientName: "Jake",
    occasion: "birthday",
    sessionId: sid,
  });
  assertNoServerError(t2, "Turn 2");

  const t3 = await storyRound({
    message: "That's everything — he's simply the best mate anyone could ask for, through thick and thin.",
    recipientName: "Jake",
    occasion: "birthday",
    sessionId: sid,
  });
  assertNoServerError(t3, "Turn 3");

  // Try to confirm
  const conf = await confirmStory(sid);
  console.log(`  Confirm status: ${conf.status}`);

  if (conf.status === 200) {
    // Now try to continue AFTER confirming — should not crash
    const backtrack = await continueStory(sid, "Actually I forgot to mention the road trip!");
    console.log(`  Backtrack status: ${backtrack.status}`);
    // Should get a graceful error (400/422), not a 500
    assert.ok(backtrack.status < 500,
      `Backtrack after confirm should not 500: ${backtrack.status}`);
  }
});

// ---------------------------------------------------------------------------
// Test 5: Empty and whitespace-only inputs
// ---------------------------------------------------------------------------
test("Adversarial: empty and whitespace inputs rejected gracefully", { timeout: 2 * TURN_TIMEOUT }, async () => {
  // Empty message on start
  const empty = await storyRound({
    message: "",
    recipientName: "Test",
    occasion: "birthday",
  });
  assert.ok(empty.status === 400, `Empty message should be 400, got ${empty.status}`);

  // Start a real session
  const t1 = await storyRound({
    message: "A birthday song for my mum who loves gardening",
    recipientName: "Mum",
    occasion: "birthday",
  });
  assertNoServerError(t1, "Start");

  // Try whitespace-only continue
  const ws = await continueStory(t1.body.session_id, "   ");
  // Should be rejected (400) or handled gracefully
  assert.ok(ws.status < 500, `Whitespace input should not 500: ${ws.status}`);
});

// ---------------------------------------------------------------------------
// Test 6: Lyrics on unconfirmed story
// ---------------------------------------------------------------------------
test("Adversarial: lyrics on unconfirmed story rejected gracefully", { timeout: 2 * TURN_TIMEOUT }, async () => {
  const t1 = await storyRound({
    message: "My brother always protected me growing up in Lagos",
    recipientName: "Emeka",
    occasion: "birthday",
  });
  assertNoServerError(t1, "Start");

  // Try lyrics before confirming
  const lyrics = await generateLyrics(t1.body.session_id);
  assert.ok(lyrics.status === 400 || lyrics.status === 422,
    `Lyrics before confirm should be 400/422, got ${lyrics.status}`);
  console.log(`  ✓ Unconfirmed lyrics rejected: ${lyrics.status}`);
});

// ---------------------------------------------------------------------------
// Test 7: Massive input followed by tiny input
// ---------------------------------------------------------------------------
test("Adversarial: massive then tiny input sizes", { timeout: 4 * TURN_TIMEOUT }, async () => {
  // Start with massive input
  const massive = "My grandmother Rose lived through sixty years of raising this family. " +
    "She worked three jobs, nursed grandpa through cancer, raised two grandchildren, " +
    "cooked every holiday meal herself, sang in the church choir for forty years, " +
    "taught me to read with the family Bible, and still insists on making sweet potato pie at ninety-two. " +
    "Her secret ingredient was love and stubbornness in equal measure. " +
    "She grew up the youngest of nine on a farm with no running water. " +
    "She met grandpa James at a church social and married within a year. " +
    "When he got sick she never missed a day of work. After he passed she kept the family together. " +
    "Every Sunday the blue hat with the white ribbon. Every dollar stretched further than should be possible. " +
    "Last Christmas she still cooked turkey, ham, collards, mac and cheese, cornbread, and her famous pie.";

  const t1 = await storyRound({
    message: massive,
    recipientName: "Grandma Rose",
    occasion: "birthday",
  });
  assertNoServerError(t1, "Massive input");
  assertNarrativeClean(t1.body.ai_response?.narrative, "Massive input");

  // Follow with tiny input
  const t2 = await storyRound({
    message: "Yes",
    recipientName: "Grandma Rose",
    occasion: "birthday",
    sessionId: t1.body.session_id,
  });
  assertNoServerError(t2, "Tiny input");
  // Narrative should not shrink dramatically after tiny input
  const n1 = (t1.body.ai_response?.narrative || "").length;
  const n2 = (t2.body.ai_response?.narrative || "").length;
  assert.ok(n2 >= n1 * 0.5,
    `Narrative should not collapse after tiny input: ${n1} → ${n2}`);
});
