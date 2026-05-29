/**
 * LLM narrative layer. Takes the deterministic evaluation and asks Claude for a
 * plain-English diagnosis + ranked, actionable recommendations. The rules
 * already did the math; the LLM only explains and prioritizes — it is told not
 * to invent numbers.
 *
 * Two backends, tried in order:
 *   1. Anthropic API (ANTHROPIC_API_KEY) — pay-per-token.
 *   2. `claude -p` headless CLI — uses the local Claude Code subscription (no API credits).
 * If both are unavailable/fail, returns null and the report falls back to rules-only.
 */
import { spawn } from 'node:child_process';

const MODEL = 'claude-sonnet-4-6';
const API = 'https://api.anthropic.com/v1/messages';

const SYSTEM = `You are a senior performance-marketing analyst reviewing Meta (Facebook/Instagram) app-install ads for Porizo, an iOS app that makes personalized gift songs.

You are given a DETERMINISTIC evaluation (health flags, A/B/C significance, trends) already computed by rules. Your job:
1. Write a tight diagnosis (3-6 sentences) of how the campaign is doing.
2. Give a RANKED list of recommended actions. Each: the action, the specific ad/campaign, the reason, and the exact change (e.g. "raise daily budget to A$40", "pause ad B").
3. Respect the significance gate: if the evaluation says A/B/C is inconclusive or ads are still in learning phase, DO NOT crown a winner or tell them to pause — say "keep running, gather data" and give an ETA.

Rules:
- Recommend-only. Never imply you changed anything.
- Do NOT invent metrics. Use only the numbers in the evaluation.
- Currency is AUD. Be concrete and brief. No preamble, no fluff.`;

function userPrompt(evaluation) {
  return `Here is the evaluation JSON for the latest pull. Produce the diagnosis + ranked recommendations.\n\n\`\`\`json\n${JSON.stringify(evaluation, null, 2)}\n\`\`\``;
}

async function viaApi(evaluation, apiKey) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt(evaluation) }],
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`Anthropic API: ${json.error.message}`);
  return (json.content || []).map((b) => b.text || '').join('').trim() || null;
}

/** Headless `claude -p` — uses the local Claude Code subscription, no API credits. */
function viaClaudeCli(evaluation) {
  return new Promise((resolve, reject) => {
    const prompt = `${SYSTEM}\n\n---\n\n${userPrompt(evaluation)}`;
    const child = spawn('claude', ['-p', prompt], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(out.trim() || null) : reject(new Error(`claude -p exit ${code}: ${err.slice(0, 200)}`)),
    );
  });
}

/**
 * @param {object} evaluation  output of run.mjs assembly (campaign, entities, abc, trends)
 * @returns {Promise<string|null>} markdown narrative, or null if both backends fail
 */
export async function narrate(evaluation, { apiKey = process.env.ANTHROPIC_API_KEY } = {}) {
  if (apiKey) {
    try {
      return await viaApi(evaluation, apiKey);
    } catch (e) {
      console.warn(`narrate: API failed (${e.message}) — falling back to claude CLI`);
    }
  }
  try {
    return await viaClaudeCli(evaluation);
  } catch (e) {
    console.warn(`narrate: claude CLI failed (${e.message})`);
    return null;
  }
}
