'use strict';

const fs = require('fs');
const path = require('path');
const { setTimeout: sleep } = require('timers/promises');

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : null;
};

const inputPath = getArg('--input');
const outPath = getArg('--out');
const intervalSec = Number(getArg('--interval') || '2');
const noPoll = args.includes('--no-poll');
const version = getArg('--version') || process.env.REPLICATE_VERSION;
const token = process.env.REPLICATE_API_TOKEN;

if (!token) {
  console.error('Missing REPLICATE_API_TOKEN.');
  process.exit(1);
}
if (!version) {
  console.error('Missing REPLICATE_VERSION or --version.');
  process.exit(1);
}

let input = null;
if (inputPath) {
  const raw = fs.readFileSync(path.resolve(inputPath), 'utf8');
  input = JSON.parse(raw);
} else {
  const guideAudioUrl = process.env.GUIDE_AUDIO_URL;
  const voiceModelUrl = process.env.VOICE_MODEL_URL;
  if (!guideAudioUrl || !voiceModelUrl) {
    console.error('Provide --input JSON or set GUIDE_AUDIO_URL and VOICE_MODEL_URL.');
    process.exit(1);
  }
  input = {
    audio: guideAudioUrl,
    model: voiceModelUrl,
  };
}

async function requestPrediction() {
  const res = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ version, input }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Replicate create failed: ${res.status} ${body}`);
  }
  return res.json();
}

async function getPrediction(url, id) {
  const res = await fetch(url || `https://api.replicate.com/v1/predictions/${id}`, {
    headers: { Authorization: `Token ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Replicate poll failed: ${res.status} ${body}`);
  }
  return res.json();
}

(async () => {
  if (typeof fetch !== 'function') {
    console.error('Node 18+ is required (global fetch).');
    process.exit(1);
  }

  const created = await requestPrediction();
  console.log(`Created prediction: ${created.id} (${created.status})`);

  let current = created;
  if (!noPoll) {
    while (!['succeeded', 'failed', 'canceled'].includes(current.status)) {
      await sleep(intervalSec * 1000);
      current = await getPrediction(current.urls?.get, current.id);
      console.log(`Status: ${current.status}`);
    }
  }

  if (outPath) {
    fs.writeFileSync(path.resolve(outPath), JSON.stringify(current, null, 2));
  }

  if (current.status === 'succeeded') {
    console.log('Output:', current.output);
  } else {
    console.error('Final status:', current.status);
    console.error(current.error || 'No error message provided.');
    process.exit(1);
  }
})();
