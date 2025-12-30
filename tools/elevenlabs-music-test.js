'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : null;
};

const inputPath = getArg('--input');
const outPath = getArg('--out');
const apiKey = process.env.ELEVENLABS_API_KEY;

if (!apiKey) {
  console.error('Missing ELEVENLABS_API_KEY.');
  process.exit(1);
}

let payload = null;
if (inputPath) {
  const raw = fs.readFileSync(path.resolve(inputPath), 'utf8');
  payload = JSON.parse(raw);
} else {
  const prompt = getArg('--prompt') || 'Upbeat birthday song for Sarah';
  const style = getArg('--style') || 'pop';
  const duration = Number(getArg('--duration') || '60');
  const lyrics = getArg('--lyrics') || 'Happy birthday to you, Sarah...';
  payload = { prompt, style, duration, lyrics };
}

async function generateMusic() {
  const res = await fetch('https://api.elevenlabs.io/v1/music/generate', {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`ElevenLabs request failed: ${res.status} ${bodyText}`);
  }

  let data = null;
  try {
    data = JSON.parse(bodyText);
  } catch (err) {
    data = { raw: bodyText };
  }

  return data;
}

(async () => {
  if (typeof fetch !== 'function') {
    console.error('Node 18+ is required (global fetch).');
    process.exit(1);
  }

  const result = await generateMusic();
  if (outPath) {
    fs.writeFileSync(path.resolve(outPath), JSON.stringify(result, null, 2));
  }

  console.log('Response keys:', Object.keys(result));
  if (result.stems || result.guide_vocal_url || result.instrumental_url) {
    console.log('Possible artifacts:', {
      stems: result.stems,
      guide_vocal_url: result.guide_vocal_url,
      instrumental_url: result.instrumental_url,
    });
  }

  console.log(JSON.stringify(result, null, 2));
})();
