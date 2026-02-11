'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_BASE_URL = process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io';
const DEFAULT_PLAN_ENDPOINT =
  process.env.ELEVENLABS_COMPOSITION_PLAN_ENDPOINT || '/v1/music/plan';
const DEFAULT_COMPOSE_ENDPOINT = process.env.ELEVENLABS_MUSIC_ENDPOINT || '/v1/music';
const DEFAULT_MODEL_ID = 'music_v1';

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : null;
};

const inputPath = getArg('--input');
const outPath = getArg('--out') || path.resolve(process.cwd(), 'tools', 'elevenlabs-output.mp3');
const apiKey = process.env.ELEVENLABS_API_KEY;

if (!apiKey) {
  console.error('Missing ELEVENLABS_API_KEY.');
  process.exit(1);
}

function loadInput() {
  if (inputPath) {
    const raw = fs.readFileSync(path.resolve(inputPath), 'utf8');
    return JSON.parse(raw);
  }

  const prompt = getArg('--prompt') || 'High-fidelity afrobeat instrumental with dynamic percussion.';
  const durationSec = Number(getArg('--duration') || '60');
  const modelId = getArg('--model') || DEFAULT_MODEL_ID;
  return { prompt, durationSec, modelId };
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ElevenLabs request failed (${response.status}): ${body}`);
  }

  return response.json();
}

async function postBinary(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'content-type': 'application/json',
      accept: 'audio/mpeg',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ElevenLabs compose failed (${response.status}): ${body}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer;
}

function resolveCompositionPlan(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.composition_plan && typeof data.composition_plan === 'object') {
    return data.composition_plan;
  }
  if (Array.isArray(data.sections)) {
    return data;
  }
  return null;
}

function makeInstrumental(plan) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.sections)) {
    return plan;
  }
  const cloned = JSON.parse(JSON.stringify(plan));
  cloned.sections = cloned.sections.map((section) => ({ ...section, lines: [] }));
  return cloned;
}

async function run() {
  if (typeof fetch !== 'function') {
    throw new Error('Node 18+ is required (global fetch).');
  }

  const input = loadInput();
  const prompt = String(input.prompt || '').trim();
  if (!prompt) {
    throw new Error('Input prompt is required.');
  }

  const durationSec = Number(input.durationSec || input.duration || 60);
  const modelId = input.modelId || input.model_id || DEFAULT_MODEL_ID;

  const planUrl = `${DEFAULT_BASE_URL}${DEFAULT_PLAN_ENDPOINT}`;
  const composeUrl = `${DEFAULT_BASE_URL}${DEFAULT_COMPOSE_ENDPOINT}`;

  const planResponse = await postJson(planUrl, {
    prompt,
    music_length_ms: durationSec * 1000,
    model_id: modelId,
  });

  const compositionPlan = resolveCompositionPlan(planResponse);
  if (!compositionPlan) {
    throw new Error('Composition plan not found in response.');
  }

  const audioBuffer = await postBinary(composeUrl, {
    composition_plan: makeInstrumental(compositionPlan),
    model_id: modelId,
    music_length_ms: durationSec * 1000,
    respect_sections_durations: false,
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, audioBuffer);

  console.log('Generated file:', outPath);
  console.log('Bytes:', audioBuffer.length);
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
